import { expect, test } from '@playwright/test'
import { E2E_OPERATOR } from './global-setup'

/**
 * Le parcours passkey, dans un vrai navigateur.
 *
 * ## Ce que ce test apporte que les autres ne peuvent pas
 *
 * Les tests serveur s'appuient sur un authentificateur **logiciel** aux signatures réelles
 * (`src/test/webauthn-authenticator.ts`). Il prouve beaucoup — une origine falsifiée est refusée, un
 * défi rejoué ne passe pas, un compteur qui stagne est vu — mais il ne prouve pas ce qui compte ici :
 * que **le navigateur soit d'accord**. C'est lui qui décide de signer ou non, en comparant l'origine de
 * la page au `rpID` demandé, et aucun code Node ne peut établir ce verdict à sa place.
 *
 * Une erreur de déploiement sur `AUTH_WEBAUTHN_RP_ID` ou `AUTH_WEBAUTHN_ORIGIN` ne se voit **que** là.
 * C'est la raison d'être de ce fichier.
 *
 * ## Pourquoi il n'y a pas d'écran
 *
 * Les écrans de connexion et de second facteur arrivent en step-026. Le parcours appelle donc les
 * routes du BFF depuis le contexte de la page — ce qui suffit : le navigateur applique la même règle
 * d'origine, qu'un formulaire ou un `fetch` déclenche la cérémonie. Quand les écrans existeront, ce
 * parcours se réécrira en cliquant, et c'est bien.
 *
 * ## L'authentificateur virtuel
 *
 * Piloté par CDP, sans aucun appareil réel. `isUserVerified` répond automatiquement à la demande de
 * vérification d'utilisateur : sans cela, la cérémonie attendrait un geste que personne ne fera.
 */

/** Le nom que l'opérateur donne à son appareil, tel qu'il doit revenir dans la liste. */
const DEVICE_NAME = 'Poste de test'

test('un opérateur enregistre une passkey, puis entre avec elle', async ({ page }) => {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      // L'authentificateur consent de lui-même : il n'y a ni doigt ni visage derrière ce navigateur.
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  // La page doit être sur l'origine attendue **avant** toute cérémonie : c'est cette origine que le
  // navigateur comparera au `rpID`, et c'est elle qui porte le cookie de session.
  await page.goto('/')

  await expect(page).toHaveURL(/localhost:3100/)

  // ─── Connexion par mot de passe : la session est partielle, le second facteur reste à passer ───
  const login = await callApi(page, '/api/auth/login', {
    identifier: E2E_OPERATOR.email,
    password: E2E_OPERATOR.password,
  })
  expect(login.status, JSON.stringify(login.body)).toBe(200)
  expect(login.body).toEqual({ mfa_required: true })

  // ─── Enregistrement de la passkey ───
  const registrationOptions = await callApi(page, '/api/auth/mfa/passkey/register', {})
  expect(registrationOptions.status, JSON.stringify(registrationOptions.body)).toBe(200)

  const registration = await createCredential(page, registrationOptions.body.options)
  const registered = await callApi(page, '/api/auth/mfa/passkey/register', {
    response: registration,
    name: DEVICE_NAME,
  })
  expect(registered.status, JSON.stringify(registered.body)).toBe(200)
  expect(registered.body.mfa_completed).toBe(true)
  expect(registered.body.passkeys).toHaveLength(1)
  expect(registered.body.passkeys[0].name).toBe(DEVICE_NAME)

  // La confirmation vaut second facteur : la session est complète, `/auth/me` le dit.
  const me = await callApi(page, '/api/auth/me')
  expect(me.body.mfaCompleted).toBe(true)
  expect(me.body.email).toBe(E2E_OPERATOR.email)

  // ─── Nouvelle connexion, et cette fois c'est la passkey qui ouvre ───
  await callApi(page, '/api/auth/logout', {})
  const secondLogin = await callApi(page, '/api/auth/login', {
    identifier: E2E_OPERATOR.email,
    password: E2E_OPERATOR.password,
  })
  expect(secondLogin.body).toEqual({ mfa_required: true })

  const pending = await callApi(page, '/api/auth/me')
  expect(pending.body.mfaCompleted, 'la session doit être partielle avant la cérémonie').toBe(false)
  expect(pending.body.permissions, 'une session partielle ne porte aucune permission').toEqual([])

  const authenticationOptions = await callApi(page, '/api/auth/mfa/passkey/verify', {})
  expect(authenticationOptions.status, JSON.stringify(authenticationOptions.body)).toBe(200)

  const assertion = await getCredential(page, authenticationOptions.body.options)
  const verified = await callApi(page, '/api/auth/mfa/passkey/verify', { response: assertion })
  expect(verified.status, JSON.stringify(verified.body)).toBe(200)
  expect(verified.body).toEqual({ mfa_completed: true })

  // Le bout du fil : la session est complète et porte les permissions du rôle.
  const promoted = await callApi(page, '/api/auth/me')
  expect(promoted.body.mfaCompleted).toBe(true)
  expect(promoted.body.permissions.length).toBeGreaterThan(0)
})

test('le navigateur refuse de signer pour un autre domaine', async ({ page }) => {
  // **Le test que seul un vrai navigateur peut porter.** On demande une cérémonie pour un `rpID` qui
  // n'est pas l'origine de la page : c'est la résistance au hameçonnage, et elle vit dans le
  // navigateur, pas dans notre code. Un déploiement mal configuré échouerait exactement ainsi.
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  await page.goto('/')

  const refused = await page.evaluate(async () => {
    try {
      await navigator.credentials.create({
        publicKey: {
          challenge: new Uint8Array(32),
          rp: { id: 'hameconnage.test', name: 'Hameçonnage' },
          user: { id: new Uint8Array(16), name: 'a@b.test', displayName: 'a' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        },
      })
      return 'signé'
    } catch (error) {
      return error instanceof Error ? error.name : 'erreur inconnue'
    }
  })

  expect(refused, 'le navigateur ne doit jamais signer pour une autre origine').not.toBe('signé')
})

/**
 * Appelle une route du BFF **depuis la page**, et non par `page.request`.
 *
 * La distinction compte : le cookie de session doit vivre dans le même bocal que celui qui portera les
 * cérémonies, et l'origine annoncée doit être celle de la page. `page.request` a son propre contexte.
 */
async function callApi(
  page: import('@playwright/test').Page,
  path: string,
  body?: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: le corps des réponses du BFF varie selon la route.
): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : {} }
    },
    { path, body },
  )
}

/**
 * Joue `navigator.credentials.create()` et rend la réponse au format que le serveur attend.
 *
 * Les conversions base64url ↔ octets sont faites à la main : `@simplewebauthn/browser` les ferait, mais
 * l'importer ici demanderait de le faire entrer dans le bundle de la page, ce qu'aucun écran ne
 * justifie encore. Elles sont mécaniques, et les écrire ici garde ce parcours indépendant de la
 * bibliothèque qu'il doit précisément confronter au navigateur.
 */
async function createCredential(
  page: import('@playwright/test').Page,
  // biome-ignore lint/suspicious/noExplicitAny: les options viennent du serveur, déjà typées là-bas.
  options: any,
  // biome-ignore lint/suspicious/noExplicitAny: la réponse repart telle quelle vers le serveur.
): Promise<any> {
  return page.evaluate(async (options) => {
    const fromBase64Url = (value: string) =>
      Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const toBase64Url = (buffer: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

    const credential = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: fromBase64Url(options.challenge),
        user: { ...options.user, id: fromBase64Url(options.user.id) },
        excludeCredentials: (options.excludeCredentials ?? []).map(
          (entry: { id: string; transports?: AuthenticatorTransport[] }) => ({
            ...entry,
            id: fromBase64Url(entry.id),
          }),
        ),
      },
    })) as PublicKeyCredential

    const response = credential.response as AuthenticatorAttestationResponse

    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        attestationObject: toBase64Url(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
    }
  }, options)
}

/** Joue `navigator.credentials.get()` et rend l'assertion au format attendu par le serveur. */
async function getCredential(
  page: import('@playwright/test').Page,
  // biome-ignore lint/suspicious/noExplicitAny: les options viennent du serveur, déjà typées là-bas.
  options: any,
  // biome-ignore lint/suspicious/noExplicitAny: l'assertion repart telle quelle vers le serveur.
): Promise<any> {
  return page.evaluate(async (options) => {
    const fromBase64Url = (value: string) =>
      Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const toBase64Url = (buffer: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

    const credential = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: fromBase64Url(options.challenge),
        allowCredentials: (options.allowCredentials ?? []).map(
          (entry: { id: string; transports?: AuthenticatorTransport[] }) => ({
            ...entry,
            id: fromBase64Url(entry.id),
          }),
        ),
      },
    })) as PublicKeyCredential

    const response = credential.response as AuthenticatorAssertionResponse

    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(response.authenticatorData),
        signature: toBase64Url(response.signature),
        userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
      },
    }
  }, options)
}

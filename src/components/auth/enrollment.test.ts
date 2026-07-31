/**
 * Les appels d'enrôlement du second facteur.
 *
 * Même règle que le reste du client (`api.ts`) : **aucun refus n'est rédigé ici**, et rien ne lève —
 * un enrôlement qui échoue est une réponse, pas une panne, et une exception laisserait l'écran figé
 * sur « Enregistrement en cours » avec un secret affiché qu'on ne pourra plus jamais revoir.
 *
 * Ce fichier vérifie **l'enchaînement et la traduction**, pas la cryptographie : celle-ci est prouvée
 * côté serveur, et dans un vrai navigateur par les parcours Playwright.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmTotpEnrollment,
  listPasskeys,
  registerPasskey,
  renamePasskey,
  revokePasskey,
  startTotpEnrollment,
} from './enrollment'

const { startRegistration } = vi.hoisted(() => ({ startRegistration: vi.fn() }))
vi.mock('@simplewebauthn/browser', () => ({ startRegistration }))

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  startRegistration.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startTotpEnrollment', () => {
  it('rend le secret et son URI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(200, { secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/x?secret=y' }),
      ),
    )

    await expect(startTotpEnrollment()).resolves.toEqual({
      outcome: 'started',
      secret: 'JBSWY3DPEHPK3PXP',
      uri: 'otpauth://totp/x?secret=y',
    })
  })

  it('distingue « déjà enrôlé » d’un refus ordinaire', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(409, { error: 'Un second facteur est déjà actif sur ce compte.' })),
    )

    // **Ce n'est pas un échec.** L'écran doit alors proposer d'ajouter un appareil, pas de
    // recommencer un enrôlement que le serveur refusera toujours.
    expect((await startTotpEnrollment()).outcome).toBe('already_enrolled')
  })

  it('n’appelle pas une panne du serveur un refus', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>502</html>', { status: 502 })),
    )

    expect((await startTotpEnrollment()).outcome).toBe('unreachable')
  })

  it('rend une issue plutôt que de lever quand le corps n’est pas exploitable', async () => {
    // Un 200 avec du HTML : sans ce cas, l'écran resterait figé sur « Préparation en cours ».
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>bonjour</html>', { status: 200 })),
    )

    expect((await startTotpEnrollment()).outcome).toBe('unreachable')
  })
})

describe('confirmTotpEnrollment', () => {
  it('rend les codes de récupération, une fois', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(200, { mfa_completed: true, recovery_codes: ['ABCD-EFGH-1', 'ABCD-EFGH-2'] }),
      ),
    )

    await expect(confirmTotpEnrollment('123456')).resolves.toEqual({
      outcome: 'activated',
      recoveryCodes: ['ABCD-EFGH-1', 'ABCD-EFGH-2'],
    })
  })

  it('rend le refus du serveur mot pour mot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(401, { error: 'Vérification refusée : code incorrect ou expiré.' }),
      ),
    )

    await expect(confirmTotpEnrollment('000000')).resolves.toEqual({
      outcome: 'refused',
      message: 'Vérification refusée : code incorrect ou expiré.',
    })
  })

  it('distingue un enrôlement expiré d’un code faux', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(409, {
          error:
            'Aucun enrôlement en cours : relancez l’enrôlement pour obtenir un nouveau QR code.',
        }),
      ),
    )

    // L'écran doit relancer l'enrôlement, pas inviter à retaper un code : le secret affiché ne vaut
    // plus rien.
    expect((await confirmTotpEnrollment('123456')).outcome).toBe('expired')
  })
})

describe('registerPasskey', () => {
  it('enchaîne options, signature, enregistrement nommé', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, { options: { challenge: 'abc' } }))
      .mockResolvedValueOnce(
        respond(200, {
          mfa_completed: true,
          passkeys: [{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    startRegistration.mockResolvedValueOnce({ id: 'c1' })

    const result = await registerPasskey('Poste')

    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: { challenge: 'abc' } })
    expect(result).toEqual({
      outcome: 'registered',
      passkeys: [{ id: 'c1', name: 'Poste', createdAt: '2026-07-31T00:00:00Z' }],
    })

    // Le nom accompagne la réponse signée, dans le même appel : deux allers-retours de plus pour un
    // libellé n'apporteraient qu'une fenêtre où l'appareil existe sans nom.
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ response: { id: 'c1' }, name: 'Poste' })
  })

  it('traite l’abandon comme un abandon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { options: { challenge: 'abc' } })),
    )
    startRegistration.mockRejectedValueOnce(
      Object.assign(new Error('annulé'), { name: 'NotAllowedError' }),
    )

    expect((await registerPasskey('Poste')).outcome).toBe('cancelled')
  })

  it('distingue une erreur de déploiement d’un abandon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { options: { challenge: 'abc' } })),
    )
    startRegistration.mockRejectedValueOnce(
      Object.assign(new Error('origine'), { name: 'SecurityError' }),
    )

    const result = await registerPasskey('Poste')

    expect(result.outcome).toBe('refused')
    expect(result.outcome === 'refused' && result.message).toContain('SecurityError')
  })

  it('signale le refus d’ajout depuis une session non vérifiée', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(403, {
          error:
            'Ajout refusé : franchissez d’abord votre second facteur actuel pour enregistrer un nouvel appareil.',
        }),
      ),
    )

    const result = await registerPasskey('Poste')

    expect(result).toEqual({
      outcome: 'refused',
      message:
        'Ajout refusé : franchissez d’abord votre second facteur actuel pour enregistrer un nouvel appareil.',
    })
  })
})

describe('la liste des appareils', () => {
  it('se lit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { passkeys: [{ id: 'c1', name: 'Poste', createdAt: 'x' }] })),
    )

    await expect(listPasskeys()).resolves.toEqual([{ id: 'c1', name: 'Poste', createdAt: 'x' }])
  })

  it('rend une liste vide plutôt qu’une exception quand le serveur tombe', async () => {
    // La liste est un confort : une panne ne doit pas empêcher d'enrôler.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 502 })),
    )

    await expect(listPasskeys()).resolves.toEqual([])
  })

  it('se renomme', async () => {
    const fetchMock = vi.fn(async () =>
      respond(200, { passkeys: [{ id: 'c1', name: 'Portable', createdAt: 'x' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await renamePasskey('c1', 'Portable')

    expect(result).toEqual({
      outcome: 'updated',
      passkeys: [{ id: 'c1', name: 'Portable', createdAt: 'x' }],
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ credential_id: 'c1', name: 'Portable' })
  })

  it('refuse de retirer le dernier facteur, avec sa raison', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(409, {
          error: 'Retrait refusé : cet appareil est votre dernier second facteur.',
        }),
      ),
    )

    const result = await revokePasskey('c1')

    // **Le refus qui protège l'opérateur de lui-même.** Retirer son dernier facteur le laisserait
    // dehors : le message doit dire pourquoi, pas « échec ».
    expect(result).toEqual({
      outcome: 'refused',
      message: 'Retrait refusé : cet appareil est votre dernier second facteur.',
    })
  })

  it('n’envoie aucun nom quand il s’agit d’un retrait', async () => {
    // Le point d'entrée décide d'après la **présence** d'un nom : en envoyer un, même vide,
    // renommerait au lieu de retirer.
    const fetchMock = vi.fn(async () => respond(200, { passkeys: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await revokePasskey('c1')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ credential_id: 'c1' })
  })
})

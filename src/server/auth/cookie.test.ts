// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  clearedSessionCookie,
  readSessionSecrets,
  SESSION_COOKIE_NAME,
  sessionCookieAttributes,
  signSessionId,
  verifySessionCookie,
} from './cookie'

const CURRENT_KEY = 'une-cle-de-session-de-test-assez-longue'
const PREVIOUS_KEY = 'une-ancienne-cle-de-session-assez-longue'
const SESSION_ID = '01890a5d-ac96-774b-bcce-b302099a8057'

describe('signature du cookie de session', () => {
  it('signe puis relit son propre identifiant', () => {
    const cookie = signSessionId(SESSION_ID, { current: CURRENT_KEY })

    expect(verifySessionCookie(cookie, { current: CURRENT_KEY })).toBe(SESSION_ID)
  })

  it('refuse une signature produite avec une autre clé', () => {
    const cookie = signSessionId(SESSION_ID, { current: PREVIOUS_KEY })

    expect(verifySessionCookie(cookie, { current: CURRENT_KEY })).toBeUndefined()
  })

  it('refuse un identifiant modifié après signature', () => {
    // Le cas qui compte : un attaquant garde une signature valide et change l'identifiant à côté,
    // pour désigner la session de quelqu'un d'autre.
    const cookie = signSessionId(SESSION_ID, { current: CURRENT_KEY })
    const [, signature] = cookie.split('.')

    expect(
      verifySessionCookie(`01890a5d-ac96-774b-bcce-000000000000.${signature}`, {
        current: CURRENT_KEY,
      }),
    ).toBeUndefined()
  })

  it('ne lève jamais sur un cookie malformé', () => {
    // Cookie d'une ancienne version, troncature d'un proxy, bricolage d'un curieux : c'est le cas
    // ordinaire, pas une erreur serveur.
    for (const value of [
      '',
      '.',
      'sans-point',
      `${SESSION_ID}.`,
      `.signature`,
      `${SESSION_ID}.a.b`,
      '..',
    ]) {
      expect(
        verifySessionCookie(value, { current: CURRENT_KEY }),
        JSON.stringify(value),
      ).toBeUndefined()
    }
  })

  it('produit une signature qui ne contient pas l identifiant', () => {
    const [, signature] = signSessionId(SESSION_ID, { current: CURRENT_KEY }).split('.')

    expect(signature).not.toContain(SESSION_ID)
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('rotation de clé', () => {
  it('accepte encore un cookie signé avec la clé précédente', () => {
    // **Ce qui rend la rotation praticable.** Sans cela, changer de clé déconnecterait tout le monde
    // d'un coup — c'est-à-dire qu'on ne changerait jamais de clé.
    const previousCookie = signSessionId(SESSION_ID, { current: PREVIOUS_KEY })

    expect(
      verifySessionCookie(previousCookie, { current: CURRENT_KEY, previous: PREVIOUS_KEY }),
    ).toBe(SESSION_ID)
  })

  it('signe toujours avec la clé courante, jamais avec l ancienne', () => {
    // Sinon la fenêtre de rotation ne se refermerait jamais : de nouveaux cookies continueraient
    // d'être émis sous une clé qu'on cherche à retirer.
    const issued = signSessionId(SESSION_ID, { current: CURRENT_KEY, previous: PREVIOUS_KEY })

    expect(verifySessionCookie(issued, { current: CURRENT_KEY })).toBe(SESSION_ID)
    expect(verifySessionCookie(issued, { current: PREVIOUS_KEY })).toBeUndefined()
  })

  it('cesse d accepter l ancienne clé dès qu elle est retirée', () => {
    const previousCookie = signSessionId(SESSION_ID, { current: PREVIOUS_KEY })

    expect(verifySessionCookie(previousCookie, { current: CURRENT_KEY })).toBeUndefined()
  })
})

describe('lecture des clés', () => {
  it('refuse de démarrer sans clé de signature', () => {
    // Une clé de repli codée en dur serait publique : n'importe qui signerait une session, donc se
    // connecterait en tant que n'importe qui.
    expect(() => readSessionSecrets({})).toThrow(/AUTH_SESSION_SECRET/)
  })

  it('refuse une clé trop courte', () => {
    expect(() => readSessionSecrets({ AUTH_SESSION_SECRET: 'courte' })).toThrow(/32/)
  })

  it('ignore une clé précédente trop courte plutôt que d échouer', () => {
    // Elle ne sert qu'à accepter des cookies déjà émis : faire échouer le démarrage pour une
    // variable en cours de retrait serait pire que le problème.
    expect(
      readSessionSecrets({
        AUTH_SESSION_SECRET: CURRENT_KEY,
        AUTH_SESSION_SECRET_PREVIOUS: 'trop-courte',
      }),
    ).toEqual({ current: CURRENT_KEY })
  })

  it('retient les deux clés quand elles sont valides', () => {
    expect(
      readSessionSecrets({
        AUTH_SESSION_SECRET: CURRENT_KEY,
        AUTH_SESSION_SECRET_PREVIOUS: PREVIOUS_KEY,
      }),
    ).toEqual({ current: CURRENT_KEY, previous: PREVIOUS_KEY })
  })
})

describe('attributs du cookie', () => {
  it('porte les quatre protections attendues', () => {
    const attributes = sessionCookieAttributes(3600)

    expect(attributes).toContain('HttpOnly')
    expect(attributes).toContain('Secure')
    expect(attributes).toContain('SameSite=Lax')
    expect(attributes).toContain('Path=/')
    expect(attributes).toContain('Max-Age=3600')
  })

  it('utilise le préfixe __Host-, qui refuse un cookie posé par un sous-domaine', () => {
    // Sans ce préfixe, un sous-domaine compromis pourrait poser un cookie que nous accepterions —
    // et donc choisir la session de l'opérateur.
    expect(SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true)
    expect(sessionCookieAttributes(60)).not.toContain('Domain=')
  })

  it('efface le cookie avec les mêmes attributs', () => {
    // Un navigateur n'efface un cookie que si les attributs correspondent : un `Path` différent
    // laisserait la session en place côté client.
    const cleared = clearedSessionCookie()

    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(cleared).toContain('Path=/')
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('HttpOnly')
  })
})

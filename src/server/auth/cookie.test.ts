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

const COURANTE = 'une-cle-de-session-de-test-assez-longue'
const ANCIENNE = 'une-ancienne-cle-de-session-assez-longue'
const ID = '01890a5d-ac96-774b-bcce-b302099a8057'

describe('signature du cookie de session', () => {
  it('signe puis relit son propre identifiant', () => {
    const cookie = signSessionId(ID, { current: COURANTE })

    expect(verifySessionCookie(cookie, { current: COURANTE })).toBe(ID)
  })

  it('refuse une signature produite avec une autre clé', () => {
    const cookie = signSessionId(ID, { current: ANCIENNE })

    expect(verifySessionCookie(cookie, { current: COURANTE })).toBeUndefined()
  })

  it('refuse un identifiant modifié après signature', () => {
    // Le cas qui compte : un attaquant garde une signature valide et change l'identifiant à côté,
    // pour désigner la session de quelqu'un d'autre.
    const cookie = signSessionId(ID, { current: COURANTE })
    const [, signature] = cookie.split('.')

    expect(
      verifySessionCookie(`01890a5d-ac96-774b-bcce-000000000000.${signature}`, {
        current: COURANTE,
      }),
    ).toBeUndefined()
  })

  it('ne lève jamais sur un cookie malformé', () => {
    // Cookie d'une ancienne version, troncature d'un proxy, bricolage d'un curieux : c'est le cas
    // ordinaire, pas une erreur serveur.
    for (const value of ['', '.', 'sans-point', `${ID}.`, `.signature`, `${ID}.a.b`, '..']) {
      expect(
        verifySessionCookie(value, { current: COURANTE }),
        JSON.stringify(value),
      ).toBeUndefined()
    }
  })

  it('produit une signature qui ne contient pas l identifiant', () => {
    const [, signature] = signSessionId(ID, { current: COURANTE }).split('.')

    expect(signature).not.toContain(ID)
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('rotation de clé', () => {
  it('accepte encore un cookie signé avec la clé précédente', () => {
    // **Ce qui rend la rotation praticable.** Sans cela, changer de clé déconnecterait tout le monde
    // d'un coup — c'est-à-dire qu'on ne changerait jamais de clé.
    const ancien = signSessionId(ID, { current: ANCIENNE })

    expect(verifySessionCookie(ancien, { current: COURANTE, previous: ANCIENNE })).toBe(ID)
  })

  it('signe toujours avec la clé courante, jamais avec l ancienne', () => {
    // Sinon la fenêtre de rotation ne se refermerait jamais : de nouveaux cookies continueraient
    // d'être émis sous une clé qu'on cherche à retirer.
    const emis = signSessionId(ID, { current: COURANTE, previous: ANCIENNE })

    expect(verifySessionCookie(emis, { current: COURANTE })).toBe(ID)
    expect(verifySessionCookie(emis, { current: ANCIENNE })).toBeUndefined()
  })

  it('cesse d accepter l ancienne clé dès qu elle est retirée', () => {
    const ancien = signSessionId(ID, { current: ANCIENNE })

    expect(verifySessionCookie(ancien, { current: COURANTE })).toBeUndefined()
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
        AUTH_SESSION_SECRET: COURANTE,
        AUTH_SESSION_SECRET_PREVIOUS: 'trop-courte',
      }),
    ).toEqual({ current: COURANTE })
  })

  it('retient les deux clés quand elles sont valides', () => {
    expect(
      readSessionSecrets({
        AUTH_SESSION_SECRET: COURANTE,
        AUTH_SESSION_SECRET_PREVIOUS: ANCIENNE,
      }),
    ).toEqual({ current: COURANTE, previous: ANCIENNE })
  })
})

describe('attributs du cookie', () => {
  it('porte les quatre protections attendues', () => {
    const attributs = sessionCookieAttributes(3600)

    expect(attributs).toContain('HttpOnly')
    expect(attributs).toContain('Secure')
    expect(attributs).toContain('SameSite=Lax')
    expect(attributs).toContain('Path=/')
    expect(attributs).toContain('Max-Age=3600')
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
    const efface = clearedSessionCookie()

    expect(efface).toContain(`${SESSION_COOKIE_NAME}=;`)
    expect(efface).toContain('Path=/')
    expect(efface).toContain('Max-Age=0')
    expect(efface).toContain('HttpOnly')
  })
})

// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { readWebAuthnConfig } from './webauthn'

describe('configuration WebAuthn', () => {
  it('lit le domaine et l’origine attendus', () => {
    const config = readWebAuthnConfig({
      AUTH_WEBAUTHN_RP_ID: 'cockpit.example.test',
      AUTH_WEBAUTHN_ORIGIN: 'https://cockpit.example.test',
    })

    expect(config).toEqual({
      rpId: 'cockpit.example.test',
      origin: 'https://cockpit.example.test',
      rpName: 'Passerelle SMS',
    })
  })

  it('nomme la variable absente plutôt que « configuration incomplète »', () => {
    // L'exploitant qui lance ce serveur est au milieu d'un déploiement et n'a pas le fichier sous les
    // yeux : « AUTH_WEBAUTHN_RP_ID est requise » lui dit quoi faire, « configuration invalide » non.
    expect(() => readWebAuthnConfig({ AUTH_WEBAUTHN_ORIGIN: 'https://x.test' })).toThrow(
      /AUTH_WEBAUTHN_RP_ID/,
    )
    expect(() => readWebAuthnConfig({ AUTH_WEBAUTHN_RP_ID: 'x.test' })).toThrow(
      /AUTH_WEBAUTHN_ORIGIN/,
    )
  })

  it('refuse une origine qui n’est pas une URL absolue', () => {
    // `expectedOrigin` est comparé caractère pour caractère à ce que le navigateur annonce. Une valeur
    // approximative ne « marche pas à peu près » : elle refuse tout, ou pire, elle accepte trop.
    for (const origin of ['cockpit.example.test', '/cockpit', 'ftp://x.test', '']) {
      expect(() =>
        readWebAuthnConfig({ AUTH_WEBAUTHN_RP_ID: 'x.test', AUTH_WEBAUTHN_ORIGIN: origin }),
      ).toThrow(/AUTH_WEBAUTHN_ORIGIN/)
    }
  })

  it('refuse une origine portant un chemin ou une barre finale', () => {
    // La spécification WebAuthn compare une *origine*, pas une URL : un `/` final suffit à ne jamais
    // correspondre, et l'échec ressemblerait à un problème d'appareil.
    for (const origin of ['https://x.test/', 'https://x.test/console']) {
      expect(() =>
        readWebAuthnConfig({ AUTH_WEBAUTHN_RP_ID: 'x.test', AUTH_WEBAUTHN_ORIGIN: origin }),
      ).toThrow(/AUTH_WEBAUTHN_ORIGIN/)
    }
  })

  it('refuse une origine qui ne couvre pas le domaine déclaré', () => {
    // **La garde qui protège la résistance au hameçonnage.** `rpID` doit être le domaine de l'origine
    // ou l'un de ses parents ; toute autre combinaison est une erreur de déploiement qui rendrait les
    // passkeys inutilisables — ou, si le navigateur l'acceptait, les rendrait rejouables ailleurs.
    expect(() =>
      readWebAuthnConfig({
        AUTH_WEBAUTHN_RP_ID: 'autre.test',
        AUTH_WEBAUTHN_ORIGIN: 'https://cockpit.example.test',
      }),
    ).toThrow(/AUTH_WEBAUTHN_RP_ID/)
  })

  it('accepte un domaine parent de l’origine', () => {
    const config = readWebAuthnConfig({
      AUTH_WEBAUTHN_RP_ID: 'example.test',
      AUTH_WEBAUTHN_ORIGIN: 'https://cockpit.example.test',
    })

    expect(config.rpId).toBe('example.test')
  })

  it('refuse une adresse IP en clair, même en boucle locale', () => {
    // La spécification ne reconnaît pas une adresse IP comme `rpID` valide : l'accepter aurait laissé
    // configurer un facteur qui ne fonctionne pas, avec un échec ressemblant à un problème d'appareil.
    expect(() =>
      readWebAuthnConfig({
        AUTH_WEBAUTHN_RP_ID: '127.0.0.1',
        AUTH_WEBAUTHN_ORIGIN: 'http://127.0.0.1:3000',
      }),
    ).toThrow(/AUTH_WEBAUTHN_ORIGIN/)
  })

  it('accepte un hôte à label unique quand le domaine est exactement celui-là', () => {
    // Un déploiement interne derrière `https://cockpit/` sous une autorité maison est valide : la
    // spécification n'exige un point que pour la relation de parenté, pas pour l'égalité stricte.
    expect(
      readWebAuthnConfig({
        AUTH_WEBAUTHN_RP_ID: 'cockpit',
        AUTH_WEBAUTHN_ORIGIN: 'https://cockpit',
      }).rpId,
    ).toBe('cockpit')
  })

  it('refuse un suffixe nu pris pour un domaine parent', () => {
    // `co` « couvrirait » `example.co` par simple comparaison de suffixe, et le navigateur refuserait.
    expect(() =>
      readWebAuthnConfig({
        AUTH_WEBAUTHN_RP_ID: 'co',
        AUTH_WEBAUTHN_ORIGIN: 'https://example.co',
      }),
    ).toThrow(/AUTH_WEBAUTHN_RP_ID/)
  })

  it('accepte localhost en clair, et lui seul', () => {
    // Le développement local n'a pas de certificat ; la spécification WebAuthn traite `localhost`
    // comme une origine sûre. Ailleurs, `http://` annulerait la garantie de transport.
    expect(
      readWebAuthnConfig({
        AUTH_WEBAUTHN_RP_ID: 'localhost',
        AUTH_WEBAUTHN_ORIGIN: 'http://localhost:3000',
      }).origin,
    ).toBe('http://localhost:3000')

    expect(() =>
      readWebAuthnConfig({
        AUTH_WEBAUTHN_RP_ID: 'cockpit.example.test',
        AUTH_WEBAUTHN_ORIGIN: 'http://cockpit.example.test',
      }),
    ).toThrow(/AUTH_WEBAUTHN_ORIGIN/)
  })
})

/**
 * Les clés de signature de session, lues une fois par process.
 *
 * Trois handlers en ont besoin ; trois copies du même `??=` auraient fini par diverger sur le détail
 * qui compte — la variable lue, ou le moment où l'absence de clé se remarque. Le cache est ici, la
 * validation reste dans `cookie.ts`, où elle est testée.
 *
 * **Hors de `http/`, et ce n'est pas un détail de rangement.** Ce répertoire est exclu de la mesure
 * de couverture au motif que ses fichiers ne décident rien ; un `export` nommé y signalerait du code
 * réutilisable — donc à tester, donc à sortir de l'exclusion. La garde de `frontiere-serveur.test.ts`
 * le refuse, et elle a raison : ce module a un test à lui.
 */

import { readSessionSecrets, type SessionSecrets } from './cookie'
import { type MfaKeys, readMfaKeys } from './mfa-secret'
import { readWebAuthnConfig, type WebAuthnConfig } from './webauthn'

let secrets: SessionSecrets | undefined
let mfaKeys: MfaKeys | undefined
let webAuthnConfig: WebAuthnConfig | undefined

export function getSessionSecrets(): SessionSecrets {
  secrets ??= readSessionSecrets(process.env)
  return secrets
}

/**
 * Les clés du second facteur, dérivées une fois par process.
 *
 * La dérivation HKDF est bon marché, mais la relancer à chaque requête déplacerait le moment où une
 * variable absente se remarque : au premier enrôlement plutôt qu'au premier appel, c'est-à-dire
 * potentiellement des semaines plus tard.
 */
export function getMfaKeys(): MfaKeys {
  mfaKeys ??= readMfaKeys(process.env)
  return mfaKeys
}

/**
 * La configuration WebAuthn, lue et **validée** une fois par process.
 *
 * La validation est la partie qui compte : `rpID` et `origin` portent la résistance au hameçonnage, et
 * une valeur approximative ne refuse pas à moitié — elle refuse tout, avec un échec qui ressemble à un
 * problème d'appareil. La lire une fois fait remarquer l'erreur au premier appel plutôt qu'au
 * cinquantième.
 */
export function getWebAuthnConfig(): WebAuthnConfig {
  webAuthnConfig ??= readWebAuthnConfig(process.env)
  return webAuthnConfig
}

/**
 * Les clés de signature de session, lues une fois par process.
 *
 * Trois handlers en ont besoin ; trois copies du même `??=` auraient fini par diverger sur le détail
 * qui compte — la variable lue, ou le moment où l'absence de clé se remarque. Le cache est ici, la
 * validation reste dans `cookie.ts`, où elle est testée.
 */

import { readSessionSecrets, type SessionSecrets } from '../cookie'

let secrets: SessionSecrets | undefined

export function getSessionSecrets(): SessionSecrets {
  secrets ??= readSessionSecrets(process.env)
  return secrets
}

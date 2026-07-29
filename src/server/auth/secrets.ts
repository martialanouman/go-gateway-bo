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

let secrets: SessionSecrets | undefined

export function getSessionSecrets(): SessionSecrets {
  secrets ??= readSessionSecrets(process.env)
  return secrets
}

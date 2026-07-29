/**
 * Points d'entrée d'exploitation : `pnpm db:seed` et `pnpm auth:bootstrap`.
 *
 * Volontairement réduit à de la plomberie — lire l'environnement, appeler, fermer, choisir un code
 * de sortie. Tout ce qui se décide est ailleurs et testé : `readBootstrapIdentity` pour
 * l'environnement, `seedAuth` et `bootstrapSuperAdmin` pour les écritures. C'est ce qui permet
 * d'exclure ce seul fichier de la mesure de couverture sans rien y cacher.
 */

import { closeDatabase, getDatabase } from '../db/index'
import { installFirstAdministrator, readBootstrapIdentity } from './bootstrap'
import { seedAuth } from './seed'

/**
 * Sortie standard, explicitement — la règle de lint n'autorise `console` que pour `warn` et `error`,
 * et elle a raison : du code applicatif n'a rien à écrire sur stdout. Un point d'entrée en ligne de
 * commande, si.
 */
function say(message: string): void {
  process.stdout.write(`${message}\n`)
}

async function main(): Promise<void> {
  const command = process.argv[2]
  const db = getDatabase()

  if (command === 'seed') {
    const report = await seedAuth(db, { pruneRemovedKeys: process.argv.includes('--prune') })
    say(
      `Catalogue seedé. Rôles créés : ${report.rolesCreated.length}. ` +
        `Permissions ajoutées à super_admin : ${report.ownerPermissionsAdded.length}.`,
    )
    if (report.permissionsRemoved.length > 0) {
      console.warn(`Clés RETIRÉES du catalogue : ${report.permissionsRemoved.join(', ')}`)
    }
    // Une base en avance sur le code qui la seede : rollback, bleu/vert, ou conteneur d'une version
    // antérieure. Le dire fort, parce que la réaction réflexe — relancer avec `--prune` — détruirait
    // par cascade les paquets de rôles que ces clés gardent, y compris dans des rôles personnalisés.
    if (report.staleKeys.length > 0) {
      console.warn(
        `Clés présentes en base et absentes de ce catalogue, LAISSÉES EN PLACE : ${report.staleKeys.join(', ')}. ` +
          'Vérifier quelle version est déployée avant de lancer « pnpm db:seed --prune » : le retrait est irréversible.',
      )
    }
    return
  }

  if (command === 'bootstrap') {
    const { operatorId } = await installFirstAdministrator(db, readBootstrapIdentity(process.env))
    say(`Premier administrateur créé : ${operatorId}`)
    return
  }

  throw new Error(
    `Commande inconnue : ${command ?? '(aucune)'}. Attendu « seed » ou « bootstrap ».`,
  )
}

main()
  .catch((error: unknown) => {
    // Le message seul, jamais la pile : elle emporterait les valeurs des variables locales dans un
    // log d'installation, dont le mot de passe du premier administrateur.
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
  .finally(() => closeDatabase())

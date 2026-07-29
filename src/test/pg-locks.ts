/**
 * Observer une attente de verrou, plutôt que d'espérer une course.
 *
 * ## Pourquoi ce fichier existe
 *
 * `Promise.all([écrire(a), écrire(b)])` sur deux pools **ne prouve pas** qu'une garde de concurrence
 * fonctionne. Les deux appels ne se chevauchent presque jamais : le second part après que le premier a
 * validé, il voit donc l'état déjà écrit, et le test passe — garde ou pas. Deux gardes de ce dépôt ont
 * été écrites avec ce motif et l'ont laissé passer à la mutation ; c'est ce constat qui a produit ce
 * module.
 *
 * Le motif qui prouve quelque chose est l'inverse : **construire** l'entrelacement. Une transaction
 * tient le verrou de la ligne, la seconde écriture s'y bloque, et l'on attend cette attente — en la
 * lisant dans `pg_locks`, pas en dormant un temps arbitraire. Puis la première valide, et l'on regarde
 * ce que la seconde a fait de l'état qu'elle avait lu avant.
 *
 * ## Ce que ce module ne prouve toujours pas
 *
 * Que l'ordonnanceur produise cet entrelacement en production. Il prouve que **lorsque** deux écritures
 * se chevauchent, la garde tranche — ce qui est la propriété qu'on veut, et la seule qu'un test puisse
 * établir sans instrumenter PostgreSQL.
 */

import type postgres from 'postgres'

/** Nombre de sondages avant d'abandonner, et intervalle entre deux. */
const MAX_ATTEMPTS = 100
const INTERVAL_MS = 20

/**
 * Attend qu'au moins une requête soit en attente d'un verrou.
 *
 * **Lève si rien ne se bloque.** C'est délibéré : un test qui continuerait sans que l'entrelacement
 * ait eu lieu ne vérifierait rien, et son succès se lirait comme une preuve. Mieux vaut un échec qui
 * dit « le test ne prouve rien » qu'un vert qui ment.
 */
export async function waitUntilBlocked(sql: postgres.Sql): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const [row] = await sql<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted
    `
    if ((row?.waiting ?? 0) > 0) return

    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
  }

  throw new Error(
    "Aucune requête ne s'est bloquée sur un verrou : l'entrelacement n'a pas eu lieu, et ce test ne prouve donc rien.",
  )
}

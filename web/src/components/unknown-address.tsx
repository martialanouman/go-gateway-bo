import { Shell } from '~/components/shell'

/**
 * L'état de contenu d'une adresse qui ne correspond à aucun écran.
 *
 * Sans lui, TanStack rend `<p>Not Found</p>` — en anglais, hors des cinq états, et sans dire quoi
 * faire. Le cas n'est pas marginal : step-002 renvoie **toute** URL inconnue vers ce document, donc
 * c'est ici qu'atterrit une adresse mal recopiée.
 *
 * Il rend la coquille lui-même parce qu'une adresse inconnue ne matche aucun enfant de `_shell` : la
 * mise en page ne s'applique pas, et l'opérateur se retrouverait sur une page nue. Il doit pouvoir
 * repartir d'où il est, sans revenir en arrière ni retaper une URL.
 */
export function UnknownAddress() {
  return (
    <Shell>
      <section className="empty">
        <h1 className="empty__title">Cette adresse ne correspond à aucun écran</h1>
        <p className="empty__body">
          Le lien est peut-être incomplet, ou l'écran n'est pas encore livré. Les écrans arrivent
          jalon par jalon, et chacun apparaît dans la navigation dès qu'il existe.
        </p>
      </section>
    </Shell>
  )
}

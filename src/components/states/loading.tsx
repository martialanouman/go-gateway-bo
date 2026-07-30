/**
 * L'attente — un **squelette de la vraie mise en page**, jamais un spinner centré.
 *
 * La charte §08 est explicite, et la raison est mesurable : un spinner ne dit rien de ce qui arrive,
 * et le contenu saute à son remplacement. Un squelette qui reprend la forme du tableau réserve la
 * place, annonce le volume, et laisse l'œil se poser au bon endroit avant même que les données
 * arrivent.
 *
 * Une seule région `status` porte l'annonce. Marquer chaque ligne ferait répéter « chargement » dix
 * fois à un lecteur d'écran, ce qui est la façon la plus sûre de faire couper le son.
 */

export type LoadingProps = {
  /** Ce qui charge, en clair : « Chargement des connecteurs ». Lu une fois. */
  readonly label: string
  /** Nombre de lignes du squelette. À caler sur la densité réelle de l'écran. */
  readonly rows?: number
  readonly className?: string
}

export function Loading({ label, rows = 6, className }: LoadingProps) {
  return (
    <div
      className={['ui-loading', className].filter(Boolean).join(' ')}
      role="status"
      aria-busy="true"
    >
      <span className="ui-loading__label">{label}</span>

      {Array.from({ length: rows }, (_, index) => (
        <span
          className="ui-loading__row"
          // Un squelette n'a pas d'identité : sa position **est** sa clé, et rien ne se réordonne.
          // biome-ignore lint/suspicious/noArrayIndexKey: une ligne de squelette n'a pas d'identité propre
          key={index}
          role="presentation"
        />
      ))}
    </div>
  )
}

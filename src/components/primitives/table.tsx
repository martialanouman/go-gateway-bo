/**
 * Le tableau de données.
 *
 * ## Un vrai `<table>`, et ce n'est pas négociable
 *
 * Une grille en `div` peut être rendue identique au pixel près, et elle perd la seule chose que
 * personne ne peut réécrire : la navigation par cellule des lecteurs d'écran, qui annonce l'en-tête
 * de colonne à chaque déplacement. Sur un tableau de connecteurs à neuf colonnes, c'est la
 * différence entre « half_open » et « breaker_state : half_open ».
 *
 * ## Les colonnes décrivent, elles ne calculent pas
 *
 * Chaque colonne dit son alignement et si sa valeur est machine. Les numériques sont alignés à
 * droite — un opérateur compare des ordres de grandeur en lisant la colonne verticalement, et un
 * alignement à gauche rend cette lecture impossible. Les valeurs machine passent en mono, jamais le
 * texte narratif.
 *
 * ## Ce qui n'est pas ici
 *
 * La virtualisation (des dizaines de milliers de lignes, step-06x) et la pagination par curseur
 * (charte §09). Toutes deux ont besoin d'un écran réel pour être éprouvées ; les poser à vide
 * reviendrait à écrire du code que rien n'exerce.
 */

import type { ReactNode } from 'react'

export type SortDirection = 'ascending' | 'descending'

export type TableColumn<Row> = {
  readonly key: string
  readonly header: ReactNode
  /** Rend la cellule. Reçoit la ligne entière : une cellule dérive souvent de plusieurs champs. */
  readonly cell: (row: Row) => ReactNode
  /** Les nombres se lisent en colonne, donc alignés à droite. */
  readonly align?: 'start' | 'end'
  /** Valeur machine : identifiant, compteur, MSISDN. Mono, comme l'exige la charte. */
  readonly mono?: boolean
  readonly sortable?: boolean
}

export type TableProps<Row> = {
  readonly caption: ReactNode
  readonly columns: readonly TableColumn<Row>[]
  readonly rows: readonly Row[]
  /** Clé stable d'une ligne. Jamais l'index : il change au tri et casse la sélection. */
  readonly rowKey: (row: Row) => string
  readonly sort?: { readonly key: string; readonly direction: SortDirection }
  readonly onSortChange?: (key: string) => void
  /** Lignes de 32 px au lieu de 38 px, quand la densité prime (charte §04). */
  readonly dense?: boolean
  readonly className?: string
}

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  dense = false,
  className,
}: TableProps<Row>) {
  return (
    <table
      className={['ui-table', dense ? 'ui-table--dense' : '', className].filter(Boolean).join(' ')}
    >
      {/*
        La légende nomme le tableau pour qui ne le voit pas. Elle est masquée visuellement — le titre
        de section la porte déjà à l'écran — mais jamais retirée : sans elle, un lecteur d'écran
        annonce « tableau, 9 colonnes » sans dire de quoi.
      */}
      <caption className="ui-table__caption">{caption}</caption>

      <thead className="ui-table__head">
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={['ui-table__header', column.align === 'end' ? 'ui-table__cell--end' : '']
                .filter(Boolean)
                .join(' ')}
              // `aria-sort` ne va que sur la colonne triée : le poser partout à « none » est admis
              // par la spec mais fait annoncer l'état à chaque colonne, ce qui noie le seul qui
              // compte.
              aria-sort={sort?.key === column.key ? sort.direction : undefined}
            >
              {column.sortable && onSortChange ? (
                <button
                  type="button"
                  className="ui-table__sort"
                  onClick={() => onSortChange(column.key)}
                >
                  {column.header}
                </button>
              ) : (
                column.header
              )}
            </th>
          ))}
        </tr>
      </thead>

      <tbody>
        {rows.map((row) => (
          <tr className="ui-table__row" key={rowKey(row)}>
            {columns.map((column) => (
              <td
                key={column.key}
                className={[
                  'ui-table__cell',
                  column.align === 'end' ? 'ui-table__cell--end' : '',
                  column.mono ? 'ui-table__cell--mono' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

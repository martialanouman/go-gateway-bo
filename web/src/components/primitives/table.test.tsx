/**
 * Le tableau : la sémantique, pas la mise en forme.
 *
 * Ce qui compte ici ne se voit pas à l'écran — l'association cellule/en-tête, l'annonce du tri,
 * le nom du tableau. Une grille en `div` passerait n'importe quel test visuel et échouerait à tous
 * ceux-ci.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Table, type TableColumn } from './table'

type Connector = { id: string; name: string; throughput: number }

const ROWS: Connector[] = [
  { id: 'cnx_01', name: 'Orange CI', throughput: 8123 },
  { id: 'cnx_02', name: 'MTN CI', throughput: 504 },
]

const COLUMNS: TableColumn<Connector>[] = [
  { key: 'name', header: 'Connecteur', cell: (row) => row.name, sortable: true },
  { key: 'id', header: 'Identifiant', cell: (row) => row.id, mono: true },
  {
    key: 'throughput',
    header: 'Débit',
    cell: (row) => row.throughput,
    align: 'end',
    mono: true,
    sortable: true,
  },
]

describe('Table', () => {
  it('est un vrai tableau, nommé pour qui ne le voit pas', () => {
    const { getByRole } = renderComponent(
      <Table caption="Connecteurs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    )

    expect(getByRole('table', { name: 'Connecteurs' })).toBeInTheDocument()
  })

  it('associe chaque cellule à son en-tête de colonne', () => {
    const { getAllByRole } = renderComponent(
      <Table caption="Connecteurs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    )

    // `scope="col"` est ce qui fait annoncer « Débit, 8123 » plutôt que « 8123 » seul.
    for (const header of getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col')
    }
  })

  it('n’annonce `aria-sort` que sur la colonne réellement triée', () => {
    const { getAllByRole } = renderComponent(
      <Table
        caption="Connecteurs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        sort={{ key: 'throughput', direction: 'descending' }}
      />,
    )

    const headers = getAllByRole('columnheader')
    const sorted = headers.filter((header) => header.hasAttribute('aria-sort'))

    expect(sorted).toHaveLength(1)
    expect(sorted[0]).toHaveAttribute('aria-sort', 'descending')
    // **Et sur la bonne colonne.** Sans cette ligne, poser l'attribut sur la première colonne au
    // lieu de celle qui est triée laissait le test vert.
    expect(sorted[0]).toHaveTextContent('Débit')
  })

  it('trie au clavier depuis l’en-tête, pas seulement à la souris', async () => {
    const onSortChange = vi.fn()
    const { getByRole, user } = renderComponent(
      <Table
        caption="Connecteurs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        onSortChange={onSortChange}
      />,
    )

    // Au clavier réellement : un `<span onClick>` passerait le clic et échouerait ici.
    getByRole('button', { name: 'Connecteur' }).focus()
    await user.keyboard('{Enter}')
    expect(onSortChange).toHaveBeenCalledWith('name')

    await user.click(getByRole('button', { name: 'Débit' }))
    expect(onSortChange).toHaveBeenCalledWith('throughput')
  })

  it('aligne les nombres à droite et rend les valeurs machine en mono', () => {
    const { container } = renderComponent(
      <Table caption="Connecteurs" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    )

    // Un opérateur compare des ordres de grandeur en lisant la colonne verticalement ; à gauche,
    // « 8123 » et « 504 » ne s'alignent plus sur leurs unités.
    //
    // L'en-tête porte le même alignement que sa colonne — sinon « Débit » flotte à gauche au-dessus
    // de nombres calés à droite. On compte donc dans le corps, pas dans tout le tableau.
    const body = container.querySelector('tbody')
    expect(body?.querySelectorAll('.ui-table__cell--end')).toHaveLength(ROWS.length)
    expect(body?.querySelectorAll('.ui-table__cell--mono')).toHaveLength(ROWS.length * 2)

    // Et l'en-tête de la colonne numérique suit bien son alignement.
    const head = container.querySelector('thead')
    expect(head?.querySelectorAll('.ui-table__cell--end')).toHaveLength(1)
  })

  it('ne rend aucune ligne quand il n’y en a pas — sans inventer de message', () => {
    // L'état vide est un composant à part (step-042) : le tableau ne doit pas improviser sa copie,
    // sinon chaque écran finit avec sa propre version du vide.
    const { queryAllByRole } = renderComponent(
      <Table caption="Connecteurs" columns={COLUMNS} rows={[]} rowKey={(row) => row.id} />,
    )

    expect(queryAllByRole('row')).toHaveLength(1)
  })
})

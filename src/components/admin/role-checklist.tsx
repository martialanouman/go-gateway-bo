/**
 * Le choix des rôles d'un opérateur — **plusieurs**, jamais un seul.
 *
 * Des cases et non un `<select multiple>` : l'ensemble tient en une dizaine d'entrées, et un menu
 * multiple oblige à maintenir une touche pour désélectionner, ce que personne ne devine. Les cases
 * disent aussi ce qui n'est **pas** coché, qui est l'information qu'on relit avant d'enregistrer.
 */

import { Checkbox } from '~/components/primitives'

export type RoleChoice = { readonly id: string; readonly name: string; readonly isDefault: boolean }

export type RoleChecklistProps = {
  readonly legend: string
  readonly roles: readonly RoleChoice[]
  readonly selected: readonly string[]
  readonly onToggle: (roleId: string) => void
}

export function RoleChecklist({ legend, roles, selected, onToggle }: RoleChecklistProps) {
  const chosen = new Set(selected)

  return (
    <fieldset className="ui-directory__roles">
      <legend className="ui-directory__roles-legend">{legend}</legend>

      {roles.map((role) => (
        <Checkbox
          key={role.id}
          checked={chosen.has(role.id)}
          // Le nom du rôle reste en mono et en `snake_case` : c'est la valeur qui apparaît au
          // journal d'audit, et un opérateur la grep.
          label={<code className="ui-directory__key">{role.name}</code>}
          description={role.isDefault ? 'Livré avec le produit' : 'Rôle personnalisé'}
          onCheckedChange={() => onToggle(role.id)}
        />
      ))}

      {roles.length === 0 ? (
        <p className="ui-directory__empty-roles">
          Aucun rôle n’existe encore. Un compte sans rôle se connecte mais n’ouvre aucun écran.
        </p>
      ) : null}
    </fieldset>
  )
}

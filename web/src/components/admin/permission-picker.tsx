import { PERMISSIONS, type PermissionCategory, type PermissionKey } from '~/lib/permissions.gen'

const CATEGORY_LABELS: Readonly<Record<PermissionCategory, string>> = {
  routing: 'Routage',
  connectors: 'Connecteurs',
  sessions: 'Sessions',
  antispam: 'Anti-spam',
  accounts: 'Clients et comptes',
  billing: 'Facturation',
  content: 'Contenu',
  compliance: 'Conformité',
  alerts: 'Alertes',
  audit: 'Audit',
  admin: 'Administration',
}

const CATEGORIES = [...new Set(PERMISSIONS.map((permission) => permission.category))]

/**
 * Les 44 clés du catalogue engendré, une case native par clé et un `fieldset` par catégorie : le
 * clavier, le groupement annoncé et la légende viennent du navigateur, sans rien réimplémenter.
 */
export function PermissionPicker({
  selected,
  onChange,
}: {
  readonly selected: readonly string[]
  readonly onChange: (next: string[]) => void
}) {
  function toggle(key: PermissionKey) {
    onChange(selected.includes(key) ? selected.filter((held) => held !== key) : [...selected, key])
  }

  return (
    <div className="permission-picker">
      {CATEGORIES.map((category) => (
        <fieldset className="permission-picker__group" key={category}>
          <legend className="permission-picker__legend">{CATEGORY_LABELS[category]}</legend>
          {PERMISSIONS.filter((permission) => permission.category === category).map(
            ({ key, description }) => (
              <label className="permission-picker__option" key={key}>
                <input
                  checked={selected.includes(key)}
                  onChange={() => toggle(key)}
                  type="checkbox"
                />
                <span className="permission-picker__key">{key}</span>{' '}
                <span className="permission-picker__description">{description}</span>
              </label>
            ),
          )}
        </fieldset>
      ))}
    </div>
  )
}

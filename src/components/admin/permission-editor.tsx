/**
 * Le paquet de permissions d'un rôle, groupé par catégorie.
 *
 * ## Les descriptions viennent du catalogue, telles quelles
 *
 * `PERMISSION_CATALOG` (`~/lib/permissions`) est figé et versionné avec les livraisons : les
 * descriptions qu'il porte sont écrites pour être lues **ici**, au moment de décider qui obtient
 * quoi. Les réécrire dans l'écran donnerait deux formulations d'un même droit, et c'est celle de
 * l'écran qu'on croirait.
 *
 * ## La clé reste visible à côté de sa description
 *
 * `credentials:rotate` est ce qu'un exploitant grep dans un refus, dans une ligne d'audit et dans
 * une garde serveur. La phrase française dit ce que la clé permet ; la clé, elle, dit de quoi on
 * parle.
 */

import { Checkbox } from '~/components/primitives'
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  type PermissionCategory,
  type PermissionKey,
} from '~/lib/permissions'

/**
 * Le nom français de chaque famille, dans l'ordre du catalogue.
 *
 * Les catégories sont des valeurs machine (`enum permission_category` en base) ; ce qui est traduit
 * est le titre affiché, jamais la valeur. Un `Record` complet plutôt qu'un repli : une catégorie
 * ajoutée au catalogue sans titre ne compilerait pas, au lieu de s'afficher sous son nom anglais.
 */
const CATEGORY_LABELS: Readonly<Record<PermissionCategory, string>> = {
  routing: 'Routage et scripts',
  connectors: 'Connecteurs',
  sessions: 'Sessions SMPP',
  antispam: 'Anti-spam',
  accounts: 'Clients et comptes',
  billing: 'Facturation',
  content: 'Contenu et CDR',
  compliance: 'Conformité',
  alerts: 'Alertes métier',
  audit: 'Journal d’audit',
  admin: 'Administration',
}

export type PermissionEditorProps = {
  readonly selected: readonly PermissionKey[]
  readonly onToggle: (key: PermissionKey) => void
}

export function PermissionEditor({ selected, onToggle }: PermissionEditorProps) {
  const chosen = new Set<string>(selected)

  return (
    <div className="ui-directory__catalog">
      {PERMISSION_CATEGORIES.map((category) => {
        const entries = PERMISSION_CATALOG.filter((entry) => entry.category === category)

        return (
          <fieldset className="ui-directory__category" key={category}>
            <legend className="ui-directory__category-title">
              {CATEGORY_LABELS[category]}{' '}
              <span className="ui-directory__category-count">
                {entries.filter((entry) => chosen.has(entry.key)).length} / {entries.length}
              </span>
            </legend>

            {entries.map((entry) => (
              <Checkbox
                key={entry.key}
                checked={chosen.has(entry.key)}
                label={<code className="ui-directory__key">{entry.key}</code>}
                description={entry.description}
                onCheckedChange={() => onToggle(entry.key)}
              />
            ))}
          </fieldset>
        )
      })}
    </div>
  )
}

import { Link } from '@tanstack/react-router'
import { NAV_GROUPS } from '~/lib/navigation'
import { usePermissions } from '~/lib/permissions'

/**
 * Le rail n'a aucune icône — « labels carry the meaning » — et son filtre est un **confort** :
 * masquer une entrée ne protège rien, la route est gardée côté serveur (invariant c). Un groupe que
 * le filtre vide disparaît avec son titre, plutôt que de laisser un cadre creux.
 */
export function Rail() {
  const can = usePermissions()
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => can(entry.anyOf)),
  })).filter((group) => group.entries.length > 0)

  return (
    <nav aria-label="Navigation principale" className="shell__rail">
      <Link activeOptions={{ exact: true }} className="rail__brand" to="/">
        SMS Gateway
      </Link>
      {groups.map((group, index) => (
        <div className="rail__group" key={group.label}>
          <p className="rail__label" id={`rail-groupe-${index}`}>
            {group.label}
          </p>
          <ul aria-labelledby={`rail-groupe-${index}`} className="rail__list">
            {group.entries.map((entry) => (
              <li key={entry.to}>
                <Link className="rail__item" to={entry.to}>
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

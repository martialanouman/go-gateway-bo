/**
 * L'ossature d'un écran : titre, fil d'Ariane, actions, contenu.
 *
 * Elle existe pour que trente écrans n'inventent pas trente hiérarchies. Le titre est le seul `h1`
 * de la page — un lecteur d'écran s'en sert pour savoir où il vient d'arriver, et deux `h1`
 * suppriment ce repère.
 */

import type { ReactNode } from 'react'

export type Breadcrumb = { readonly label: string; readonly to?: string }

export type PageProps = {
  readonly title: string
  /** Le chemin qui mène ici. Le dernier maillon est la page courante et n'est pas un lien. */
  readonly breadcrumbs?: readonly Breadcrumb[]
  /** Actions de l'écran, de la moins engageante à la plus engageante. */
  readonly actions?: ReactNode
  readonly children?: ReactNode
}

export function Page({ title, breadcrumbs, actions, children }: PageProps) {
  return (
    <div className="ui-page">
      {/*
        Un `<div>` et non un `<header>`, et ce n'est pas cosmétique : `<main>` n'est **pas** un
        élément de sectionnement au sens HTML — seuls `article`, `aside`, `nav` et `section` le sont.
        Un `<header>` posé ici hérite donc du rôle `banner`, et la page en compte alors deux : celui
        de la coquille et celui de l'écran. Un lecteur d'écran qui saute « au banner » ne sait plus
        où il atterrit. Le `<h1>` porte la structure ; ce bloc n'a pas besoin de rôle.
      */}
      <div className="ui-page__header">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Fil d’Ariane" className="ui-page__breadcrumbs">
            <ol>
              {breadcrumbs.map((crumb, index) => (
                <li key={crumb.label}>
                  {crumb.to && index < breadcrumbs.length - 1 ? (
                    <a href={crumb.to}>{crumb.label}</a>
                  ) : (
                    // Le dernier maillon est la page courante : `aria-current` évite qu'un lecteur
                    // d'écran l'annonce comme un lien vers là où l'on est déjà.
                    <span aria-current="page">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <div className="ui-page__title-row">
          <h1 className="ui-page__title">{title}</h1>
          {actions ? <div className="ui-page__actions">{actions}</div> : null}
        </div>
      </div>

      {children}
    </div>
  )
}

export type ToolbarProps = {
  /** Ce que la barre filtre ou trie. Nomme la région pour les technologies d'assistance. */
  readonly label: string
  readonly children: ReactNode
}

/**
 * La sous-barre de filtres et d'onglets, 44 px dans la charte.
 *
 * `role="search"` n'est **pas** posé ici : il ne vaut que pour une recherche globale, et l'employer
 * pour un filtre de colonne ferait annoncer « recherche » à chaque écran.
 *
 * Le groupe passe par un `<fieldset>` plutôt que par `role="group"` : c'est l'élément sémantique du
 * rôle, et le linter a raison de le demander. La `<legend>` est masquée visuellement — la barre se
 * lit d'elle-même à l'écran — mais jamais retirée, sinon le groupe redevient anonyme.
 */
export function Toolbar({ label, children }: ToolbarProps) {
  return (
    <fieldset className="ui-toolbar">
      <legend className="ui-toolbar__legend">{label}</legend>
      {children}
    </fieldset>
  )
}

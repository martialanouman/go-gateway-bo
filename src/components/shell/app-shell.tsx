/**
 * La coquille : rail de navigation, barre supérieure, zone de contenu, pile de toasts.
 *
 * ## Les repères ARIA portent la structure
 *
 * `banner`, `navigation`, `main` : ce sont eux qui permettent à un lecteur d'écran de sauter
 * directement au contenu au lieu de reparcourir vingt entrées de rail à chaque navigation. Le lien
 * d'évitement fait la même chose au clavier, et il est le **premier** élément focusable de la page —
 * un lien d'évitement qui arrive en troisième position ne sert plus à rien.
 *
 * ## La route active vient du routeur
 *
 * Jamais d'un état local dupliqué : deux sources finiraient par diverger, et c'est l'affichage qui
 * mentirait, pas l'URL. `Link` de TanStack Router pose `data-status="active"` lui-même.
 *
 * ## Desktop-first, dégradation propre
 *
 * « Le rail se réduit, il ne disparaît pas » (§1.2). Une navigation qui disparaît derrière un
 * bouton oblige à deux gestes pour changer d'écran, sur un outil dont c'est le geste le plus
 * fréquent.
 */

import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ToastProvider, ToastStack, TooltipProvider } from '~/components/overlays'
import { useCurrentOperator } from '~/components/permission'
import { Loading } from '~/components/states'
import { NAVIGATION } from './navigation'

export type AppShellProps = { readonly children?: ReactNode }

export function AppShell({ children }: AppShellProps) {
  const { data: operator, isPending } = useCurrentOperator()

  // Le filtrage se fait **ici** et non par un `PermissionGate` posé sur chaque entrée : un groupe
  // dont aucune entrée n'est accessible doit disparaître entièrement, intitulé compris. La version
  // précédente rendait l'intitulé et les `<li>` inconditionnellement, si bien qu'un
  // `billing_readonly` voyait six titres de groupe, seize puces vides et un seul lien — et qu'un
  // lecteur d'écran annonçait « liste, 3 éléments » sous un groupe sans aucun lien.
  const granted = new Set<string>(operator?.permissions ?? [])
  const groups = NAVIGATION.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => granted.has(entry.permission)),
  })).filter((group) => group.entries.length > 0)

  return (
    <TooltipProvider>
      <ToastProvider>
        <div className="ui-shell">
          {/*
            Premier élément focusable de la page, et pas seulement présent : c'est ce qui distingue
            un lien d'évitement utile d'un lien d'évitement décoratif.
          */}
          <a className="ui-shell__skip" href="#contenu">
            Aller au contenu
          </a>

          {/*
            Pas de `role="banner"` explicite : un `<header>` qui n'est pas dans un élément de
            sectionnement le porte déjà, et le répéter est refusé à raison — un rôle écrit à la main
            finit par diverger de l'élément qui le porte.
          */}
          <header className="ui-shell__topbar">
            <span className="ui-shell__brand">SMS Gateway</span>
            {operator ? <span className="ui-shell__operator">{operator.displayName}</span> : null}
          </header>

          <nav aria-label="Navigation principale" className="ui-shell__rail">
            {/*
              Un squelette pendant l'aller-retour `/auth/me`, et non un rail vide : la charte §08
              demande une forme qui reproduit la mise en page. Sans lui, le rail se remplit d'un coup
              et toute la page saute au moment où l'opérateur pose les yeux dessus.
            */}
            {isPending ? (
              <Loading label="Chargement de la navigation" rows={8} />
            ) : (
              groups.map((group) => (
                <div className="ui-shell__group" key={group.label}>
                  <span className="ui-shell__group-label">{group.label}</span>
                  <ul>
                    {group.entries.map((entry) => (
                      <li key={entry.to}>
                        <Link className="ui-shell__link" to={entry.to}>
                          {entry.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </nav>

          <main className="ui-shell__content" id="contenu">
            {children}
          </main>

          <ToastStack />
        </div>
      </ToastProvider>
    </TooltipProvider>
  )
}

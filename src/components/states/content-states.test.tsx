/**
 * Les cinq états de contenu — le cœur de la step-042.
 *
 * « Ces cinq états ne sont pas décoratifs : ils sont la différence entre "rien à afficher" et
 * "c'est cassé". Un écran qui confond les deux est un bug de step. »
 *
 * Ce qu'on vérifie ici n'est donc pas qu'ils s'affichent — c'est qu'ils **ne se confondent pas**.
 * Un module désactivé rendu comme une erreur envoie un opérateur ouvrir un ticket pour une
 * fonctionnalité que personne n'a activée ; une erreur rendue comme un vide lui fait croire qu'il
 * n'y a rien, alors que la passerelle ne répond plus.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderComponent } from '~/test/render'
import { Empty } from './empty'
import { ErrorState, type ErrorStateProps } from './error-state'
import { Loading } from './loading'
import { ModuleDisabled } from './module-disabled'
import { NoResults } from './no-results'

describe('Loading', () => {
  it('reproduit la mise en page plutôt que de centrer un spinner', () => {
    // Charte §08 : un squelette de la vraie mise en page. Un spinner centré fait sauter le contenu
    // à l'arrivée, et ne dit rien de ce qu'on attend.
    const { getAllByRole } = renderComponent(
      <Loading rows={4} label="Chargement des connecteurs" />,
    )

    expect(getAllByRole('presentation', { hidden: true })).toHaveLength(4)
  })

  it('annonce l’attente sans marteler', () => {
    // `aria-busy` sur une région, et un libellé lisible : le lecteur d'écran dit ce qui charge, une
    // fois, au lieu de répéter chaque squelette.
    const { getByRole } = renderComponent(<Loading label="Chargement des connecteurs" />)

    const region = getByRole('status')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveTextContent('Chargement des connecteurs')
  })
})

describe('Empty', () => {
  it('dit qu’il n’y a rien **et** comment en créer', () => {
    const onCreate = vi.fn()
    const { getByRole, getByText } = renderComponent(
      <Empty
        title="Aucun connecteur"
        description="Les connecteurs portent les binds SMPP vers les opérateurs."
        action={{ label: 'Créer un connecteur', onClick: onCreate }}
      />,
    )

    expect(getByText('Aucun connecteur')).toBeInTheDocument()
    expect(getByRole('button', { name: 'Créer un connecteur' })).toBeInTheDocument()
  })

  it('n’est pas une alerte — il n’y a rien de cassé', () => {
    const { queryByRole } = renderComponent(<Empty title="Aucun connecteur" />)

    expect(queryByRole('alert')).toBeNull()
  })
})

describe('NoResults', () => {
  it('cite la recherche en cours quand l’écran la connaît', () => {
    const { getByText } = renderComponent(<NoResults query="2250701020304" />)

    expect(getByText('2250701020304')).toHaveClass('ui-state__query')
  })

  it('parle des filtres, pas de l’absence de données', () => {
    // La distinction qui compte : « rien encore » et « rien qui corresponde » appellent deux gestes
    // opposés — créer, ou élargir. Les confondre fait créer un doublon.
    const onReset = vi.fn()
    const { getByRole, getByText } = renderComponent(
      <NoResults onReset={onReset} resetLabel="Réinitialiser les filtres" />,
    )

    // La copie parle de **filtres trop étroits**, pas d'absence de données — et propose de les
    // élargir, jamais de créer.
    expect(getByText(/Les filtres actuels ne laissent passer aucune ligne/)).toBeInTheDocument()
    expect(getByText(/Élargissez la période ou retirez un critère/)).toBeInTheDocument()
    expect(getByRole('button', { name: 'Réinitialiser les filtres' })).toBeInTheDocument()
  })
})

describe('ModuleDisabled', () => {
  it('est une dégradation, **jamais** une erreur', () => {
    // Le point le plus important des cinq. La facturation désactivée sur la passerelle n'est pas une
    // panne : rendre cet état en rouge ferait ouvrir un ticket pour une fonctionnalité que personne
    // n'a activée.
    //
    // Le rôle ARIA ne suffit pas à le vérifier : c'est le **rendu** qui fait ouvrir le ticket. On
    // assert donc aussi l'absence de l'habillage d'erreur et de l'issue « Réessayer », qui n'aurait
    // aucun sens ici — réessayer n'activerait rien.
    const { queryByRole, getByText, container } = renderComponent(
      <ModuleDisabled module="Facturation" />,
    )

    expect(queryByRole('alert')).toBeNull()
    expect(getByText(/désactivé/i)).toBeInTheDocument()
    expect(container.querySelector('.ui-state--error')).toBeNull()
    expect(queryByRole('button', { name: /Réessayer/ })).toBeNull()
  })

  it('nomme le module, pour que l’opérateur sache quoi demander', () => {
    const { getByText } = renderComponent(<ModuleDisabled module="Facturation" />)

    expect(getByText(/Facturation/)).toBeInTheDocument()
  })
})

describe('ErrorState', () => {
  it('dit la réalité HTTP, rassure sur les données locales, et propose de réessayer', () => {
    // Les trois éléments que la charte exige, et le second est celui qu'on oublie : un opérateur qui
    // voit une erreur croit avoir tout perdu.
    const onRetry = vi.fn()
    const { getByRole, getByText } = renderComponent(<ErrorState status={503} onRetry={onRetry} />)

    expect(getByText(/503/)).toBeInTheDocument()
    expect(getByText(/vos données locales restent affichées/i)).toBeInTheDocument()
    expect(getByRole('button', { name: 'Réessayer' })).toBeInTheDocument()
  })

  it('est la seule des cinq à s’annoncer comme une alerte', () => {
    const { getByRole } = renderComponent(<ErrorState status={503} />)

    expect(getByRole('alert')).toBeInTheDocument()
  })

  it('ne promet pas de réessayer quand rien ne le permet', () => {
    const { queryByRole } = renderComponent(<ErrorState status={500} />)

    expect(queryByRole('button', { name: 'Réessayer' })).toBeNull()
  })

  it('traduit chaque statut en une conséquence lisible', () => {
    // Le statut seul ne dit rien à un opérateur. Chaque branche doit donc être rendue — et sans
    // jamais reprendre le texte de la passerelle, qui cite volontiers la valeur qu'il refuse.
    const cases = [
      { status: 0, meaning: /n’a pas répondu/ },
      { status: 403, meaning: /refusée/ },
      { status: 404, meaning: /n’existe plus/ },
      { status: 429, meaning: /trop de requêtes/i },
      { status: 500, meaning: /en difficulté/ },
      { status: 409, meaning: /refusée/ },
    ] as const

    for (const { status, meaning } of cases) {
      const { getByRole, unmount } = renderComponent(<ErrorState status={status} />)
      expect(getByRole('alert'), String(status)).toHaveTextContent(meaning)
      unmount()
    }
  })

  it('n’a **aucun moyen** de recevoir un texte distant — le typage le garantit', () => {
    // Une version précédente écrivait `expect(container.textContent).not.toMatch(/RDV demain/)`.
    // C'était une tautologie : rien dans le test ne fournissait jamais cette chaîne, et aucune
    // mutation d'`error-state.tsx` ne pouvait la faire rougir.
    //
    // La vraie protection est que le composant n'expose **aucune** prop de texte : ni `message`, ni
    // `detail`, ni `body`. On le vérifie au niveau du type, si bien que le jour où quelqu'un en
    // ajoute une, `pnpm typecheck` échoue ici — un `@ts-expect-error` aurait été déplacé par le
    // formateur, ce qui l'a rendu inopérant deux fois.
    type ForbiddenProp = 'message' | 'detail' | 'body' | 'error'
    type HasNoTextProp = ForbiddenProp & keyof ErrorStateProps extends never ? true : never

    const guard: HasNoTextProp = true
    expect(guard).toBe(true)
  })
})

describe('les cinq états ne se confondent pas', () => {
  it('rendent cinq copies distinctes', () => {
    const texts = [
      renderComponent(<Loading label="Chargement" />),
      renderComponent(<Empty title="Aucun connecteur" />),
      renderComponent(<NoResults />),
      renderComponent(<ModuleDisabled module="Facturation" />),
      renderComponent(<ErrorState status={503} />),
    ].map((result) => {
      const text = result.container.textContent ?? ''
      result.unmount()
      return text
    })

    expect(new Set(texts).size).toBe(5)
  })
})

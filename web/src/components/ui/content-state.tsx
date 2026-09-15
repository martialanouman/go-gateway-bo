import type { ReactNode } from 'react'
import { Button } from './button'
import { type GlyphName, Icon } from './icon'

/**
 * Les cinq états de contenu de `plan.md` §1.9, en composants plutôt qu'en discipline.
 *
 * Le chargement vit à côté, dans `skeleton.tsx` : il n'a pas de copie, c'est une silhouette. Les
 * quatre autres sont ici, et **trois d'entre eux partagent un rendu** — vide, aucun résultat et
 * module désactivé sont le même encadré pointillé, que seuls l'icône, la copie et la présence d'une
 * action séparent. La charte les dessine ainsi ; les scinder en trois composants aurait fabriqué
 * trois fois la même chose.
 *
 * `ErrorState`, lui, a son propre balisage — panneau teinté, `role="alert"`, ligne de trace. Ce
 * n'est pas une variante de plus : c'est **la** distinction que le produit doit tenir. Un module
 * éteint est une absence de fonctionnalité, une erreur est une panne réessayable, et les confondre
 * afficherait « réessayez » sur ce qui ne reviendra pas. Le serveur a déjà tranché exactement cela
 * (`internal/gateway/errors_test.go`, DN-8) ; ce fichier dit la même chose côté écran.
 */

/**
 * L'élément qui porte le titre.
 *
 * `p` par défaut : un état vide rendu dans une carte, au milieu d'un écran qui a déjà son `h1`, n'a
 * rien à faire dans la hiérarchie de titres — un `h2` surgi là désorganise l'annonce au lecteur
 * d'écran. Mais quand l'état **est** l'écran, il en est le titre, et l'appelant le dit.
 */
type TitleElement = 'h1' | 'h2' | 'h3' | 'p'

export type EmptyStateProps = {
  readonly titleAs?: TitleElement
  readonly icon?: GlyphName
  readonly title: ReactNode
  /**
   * Pourquoi c'est vide. Rendue dans un `div` et non un `p` : un écran y passe volontiers plusieurs
   * paragraphes, et `<p>` dans `<p>` est refermé par le parseur — le DOM obtenu diverge alors entre
   * jsdom et le navigateur, ce qui est la pire forme de défaut à trouver.
   */
  readonly description?: ReactNode
  /** Ce qu'on peut faire. Absente quand il n'y a rien à faire — voir `ModuleDisabled`. */
  readonly action?: ReactNode
  /** Dans une carte ou une colonne plutôt qu'en pleine page : mêmes traits, moins de respiration. */
  readonly inline?: boolean
  readonly className?: string
}

export function EmptyState({
  titleAs: TitleTag = 'p',
  icon = 'diamond',
  title,
  description,
  action,
  inline = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={['ui-empty', inline ? 'ui-empty--inline' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="ui-empty__icon">
        <Icon name={icon} size={16} />
      </span>
      <TitleTag className="ui-empty__title">{title}</TitleTag>
      {description === undefined ? null : <div className="ui-empty__text">{description}</div>}
      {action}
    </div>
  )
}

export type NoResultsProps = {
  readonly titleAs?: TitleElement
  /** Ce qu'on ne trouve pas — « Aucun message trouvé », « Aucun connecteur trouvé ». */
  readonly title: ReactNode
  readonly description?: ReactNode
  /** Retire les filtres. Absent quand l'écran n'en porte pas qui se réinitialisent. */
  readonly onReset?: () => void
  readonly className?: string
}

/**
 * Des filtres trop étroits, et par où les élargir.
 *
 * Distinct de l'état vide, et §1.9 y tient : « rien encore » appelle à créer, « rien qui corresponde »
 * appelle à élargir. Proposer « Créer » à qui vient de filtrer une liste pleine est un contresens.
 */
export function NoResults({
  titleAs,
  title,
  description = 'Élargissez la plage de dates ou retirez un filtre.',
  onReset,
  className,
}: NoResultsProps) {
  return (
    <EmptyState
      action={
        onReset === undefined ? undefined : (
          <Button onClick={onReset} size="sm">
            Réinitialiser
          </Button>
        )
      }
      className={className}
      description={description}
      icon="search"
      title={title}
      titleAs={titleAs}
    />
  )
}

export type ModuleDisabledProps = {
  /** Le module éteint, tel que l'opérateur le nomme : « Facturation », « Export ». */
  readonly module: string
  readonly titleAs?: TitleElement
  readonly className?: string
}

/**
 * Une capacité absente de ce déploiement-ci — **jamais une erreur**.
 *
 * Il n'y a **pas de prop `action`**, et c'est `tsc` qui l'interdit plutôt qu'une convention : un
 * module éteint n'invite à rien, et le premier écran qui voudra y mettre un « Réessayer » devra
 * d'abord expliquer pourquoi. Le refus vaut mieux ici qu'en revue, parce qu'un bouton ajouté dans six
 * mois ne sera relu par personne.
 *
 * **Livré sans producteur**, délibérément : le contrat ne déclare ni 501, ni en-tête, ni code
 * d'erreur pour un module désactivé — les seuls signaux voisins sont des booléens par ressource, qui
 * voyagent dans des réponses 200 (DN-8, mesuré sur le contrat 4.0.2). Un 503 reste donc une erreur
 * avec Réessayer, jusque sur « Export storage is not configured in this deployment ». Le premier
 * écran qui lira un de ces booléens branchera ce composant ; inventer un déclencheur maintenant
 * fabriquerait un signal que la passerelle n'émet pas.
 */
export function ModuleDisabled({ module, titleAs, className }: ModuleDisabledProps) {
  return (
    <EmptyState
      className={className}
      description="Module désactivé sur la passerelle. Dégradation propre — jamais une erreur."
      icon="ban"
      title={`${module} indisponible`}
      titleAs={titleAs}
    />
  )
}

export type ErrorStateProps = {
  readonly titleAs?: TitleElement
  readonly title?: ReactNode
  readonly description?: ReactNode
  /**
   * La requête en cause, telle qu'on la retrouve dans les traces : « GET /api/connectors · 504 ·
   * req_8f2c… ». Absente, aucune ligne n'est rendue — une ligne mono vide se lirait comme une trace
   * perdue.
   */
  readonly request?: string
  readonly onRetry?: () => void
  readonly className?: string
}

/**
 * Une panne, et ce qu'elle laisse debout.
 *
 * La copie promet que « vos données locales restent affichées », et cette promesse est une
 * contrainte de rendu avant d'être une phrase : **l'appelant ne doit pas effacer l'écran pour poser
 * cet état**. Vider la vue pour annoncer une panne est le contraire de ce que demande l'invariant
 * (e) — la chute d'un flux amont dégrade l'affichage, elle ne le supprime pas.
 *
 * `role="alert"` parce qu'une panne survenue pendant la lecture doit s'annoncer sans qu'on la
 * cherche. C'est la seule des quatre surfaces de ce fichier à le porter.
 */
export function ErrorState({
  titleAs: TitleTag = 'p',
  title = 'Impossible de joindre l’API Admin',
  description,
  request,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={['ui-error', className].filter(Boolean).join(' ')} role="alert">
      <span className="ui-error__icon">
        <Icon name="bang" size={16} />
      </span>
      <TitleTag className="ui-error__title">{title}</TitleTag>
      {description === undefined ? null : <div className="ui-error__text">{description}</div>}
      {request === undefined ? null : <span className="ui-error__request">{request}</span>}
      {onRetry === undefined ? null : (
        <Button onClick={onRetry} size="sm">
          Réessayer
        </Button>
      )}
    </div>
  )
}

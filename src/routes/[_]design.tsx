/**
 * `/_design` — la référence visuelle du dépôt.
 *
 * Page interne, volontairement absente de la navigation : elle ne s'adresse pas à un opérateur mais
 * à qui écrit un écran. Elle rend la charte v1.0 telle qu'elle est réellement installée, de sorte
 * qu'une couleur ou une graisse se vérifie ici plutôt que de s'inventer dans un composant.
 *
 * Le nom de fichier est `[_]design.tsx` et non `_design.tsx` : dans TanStack Router, un segment
 * préfixé d'un souligné est une route de mise en page **sans chemin**, et la page ne serait jamais
 * atteignable. Les crochets échappent le caractère et rendent le segment littéral.
 */

import { createFileRoute } from '@tanstack/react-router'
import designCss from '~/styles/design-reference.css?url'

export const Route = createFileRoute('/_design')({
  head: () => ({
    meta: [{ title: 'Référence visuelle — Charte v1.0' }],
    links: [{ rel: 'stylesheet', href: designCss }],
  }),
  component: DesignReference,
})

/** Les six rôles de la charte, et rien d'autre : elle n'en définit pas un septième. */
const TYPE_ROLES = [
  { token: '--text-page-title', role: 'Titre de page · valeur KPI', sample: 'Trafic en direct' },
  { token: '--text-section-title', role: 'Titre de section', sample: 'Connecteurs' },
  { token: '--text-card-title', role: 'Titre de carte', sample: 'Débit sortant' },
  {
    token: '--text-body',
    role: 'Corps de texte',
    sample: 'Baisser ce quota ne coupe pas les binds vivants.',
  },
  { token: '--text-label', role: 'Libellé secondaire', sample: 'Dernière mise à jour' },
  { token: '--text-overline', role: 'Micro-libellé', sample: 'Fraîcheur' },
] as const

/** Valeurs machine : mono exclusivement, jamais du texte narratif. */
const DATA_ROLES = [
  { token: '--text-metric', role: 'Métrique principale', sample: '8 123' },
  { token: '--text-data', role: 'Donnée de tableau', sample: 'msg_01J9K2A7QF' },
  { token: '--text-pill', role: 'État de pilule', sample: 'half_open' },
] as const

const SURFACES = [
  { token: '--surface-page', usage: 'Canvas de l’application' },
  { token: '--surface-chrome', usage: 'Rail de navigation, barre supérieure' },
  { token: '--surface-card', usage: 'Cartes et panneaux' },
  { token: '--surface-sunken', usage: 'Champs et encarts' },
] as const

const SEMANTIC_COLORS = [
  { token: '--teal-500', usage: 'Accent unique : action, sélection, MT' },
  { token: '--green-500', usage: 'Sain, up, closed, delivered' },
  { token: '--amber-500', usage: 'Dégradé, reconnecting, breaker ouvert' },
  { token: '--red-500', usage: 'Panne, failed, suspended, destructif' },
  { token: '--blue-500', usage: 'Métrique secondaire, MO, alertmanager' },
  { token: '--violet-500', usage: 'Domaine métier, évaluation BFF, scripts' },
] as const

/**
 * `link_status` — l'état du bind lui-même. Rendu en **point coloré + libellé mono**, jamais en
 * pilule : la charte l'appelle la règle la plus stricte du système, et la raison est
 * opérationnelle. Un disjoncteur ouvert sur un lien vivant (attendre la reprise) et un bind mort
 * (rebind manuel) demandent des actions opposées ; les rendre pareil, c'est inviter à la
 * confusion au pire moment.
 *
 * Les libellés restent en `snake_case` anglais, verbatim de l'API : ce sont eux qu'un opérateur
 * cherche dans les logs. Le point double le texte, il ne le remplace pas — la couleur seule ne
 * porte jamais l'information (WCAG 1.4.1).
 */
const LINK_STATUS = [
  { label: 'bound', color: 'var(--status-up)' },
  { label: 'reconnecting', color: 'var(--status-degraded)' },
  { label: 'unbound', color: 'var(--status-down)' },
] as const

/**
 * `breaker_state` — l'état du disjoncteur. Rendu en **pilule teintée**, jamais en point, et jamais
 * dérivé du champ précédent.
 *
 * Le texte posé sur un fond teinté rouge prend `--text-danger-on-tint` : le rouge de pleine surface
 * n'atteint que 4,05 sur sa propre teinte, sous le seuil AA.
 */
const BREAKER_STATE = [
  { label: 'closed', color: 'var(--breaker-closed)', tint: 'var(--tint-green)' },
  { label: 'half_open', color: 'var(--breaker-half-open)', tint: 'var(--tint-amber)' },
  { label: 'open', color: 'var(--text-danger-on-tint)', tint: 'var(--tint-red)' },
] as const

/**
 * Les pas canoniques. Aucune valeur en pixels n'est répétée ici : la barre tire sa largeur du token
 * lui-même, de sorte que la page ne puisse pas mentir si `spacing.css` change.
 */
const SPACING = ['--sp-2', '--sp-4', '--sp-6', '--sp-7', '--sp-9', '--sp-11'] as const

const RADII = [
  { token: '--r-field', usage: 'Champs, boutons, petits contrôles' },
  { token: '--r-card', usage: 'Cartes, panneaux, modales' },
  { token: '--r-pill', usage: 'Pilules de statut, badges' },
] as const

function DesignReference() {
  return (
    <main className="design-page">
      <header className="design-section">
        <h1>Référence visuelle</h1>
        <p className="design-page__intro">
          La charte graphique v1.0 telle qu’elle est installée dans ce dépôt. Cette page n’est liée
          depuis aucun écran : elle sert à vérifier un token avant de l’utiliser. Un écran qui a
          besoin d’une valeur absente d’ici pose la question à la charte — il ne l’invente pas.
        </p>
      </header>

      <section className="design-section" aria-labelledby="typo">
        <h2 id="typo">Typographie</h2>
        <p className="design-section__note">
          Six rôles pour l’interface, trois pour les valeurs machine. Le mono ne sert qu’aux
          identifiants, compteurs et états techniques ; jamais à une phrase.
        </p>
        {TYPE_ROLES.map(({ token, role, sample }) => (
          <div className="design-type" key={token}>
            <span className="design-item__label">{role}</span>
            <span style={{ font: `var(${token})` }}>{sample}</span>
            <span className="design-swatch__value">{token}</span>
          </div>
        ))}
        {DATA_ROLES.map(({ token, role, sample }) => (
          <div className="design-type" key={token}>
            <span className="design-item__label">{role}</span>
            <span style={{ font: `var(${token})` }}>{sample}</span>
            <span className="design-swatch__value">{token}</span>
          </div>
        ))}
      </section>

      <section className="design-section" aria-labelledby="surfaces">
        <h2 id="surfaces">Surfaces</h2>
        <p className="design-section__note">
          Quatre surfaces froides quasi-noires. Sur ce fond, c’est la bordure qui porte la
          profondeur, pas l’ombre. Il n’existe pas de thème clair.
        </p>
        <div className="design-grid">
          {SURFACES.map(({ token, usage }) => (
            <div className="design-card" key={token}>
              <div className="design-swatch__chip" style={{ background: `var(${token})` }} />
              <span style={{ font: 'var(--text-label)' }}>{usage}</span>
              <span className="design-swatch__value">{token}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="couleurs">
        <h2 id="couleurs">Accent et sémantique</h2>
        <p className="design-section__note">
          Un seul accent, le teal : il marque l’action et le vivant. Tout le reste demeure neutre
          pour que les alertes ne se noient pas. MT est teal, MO est bleu — jamais l’inverse.
        </p>
        <div className="design-grid">
          {SEMANTIC_COLORS.map(({ token, usage }) => (
            <div className="design-card" key={token}>
              <div className="design-swatch__chip" style={{ background: `var(${token})` }} />
              <span style={{ font: 'var(--text-label)' }}>{usage}</span>
              <span className="design-swatch__value">{token}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="statuts">
        <h2 id="statuts">États</h2>
        <p className="design-section__note">
          Deux familles, deux rendus, jamais fusionnés et jamais dérivés l’un de l’autre. Un
          disjoncteur ouvert sur un lien vivant et un bind mort appellent des gestes opposés : les
          confondre visuellement coûterait cher au pire moment.
        </p>

        <span className="design-item__label">link_status — point et libellé</span>
        <div className="design-pills">
          {LINK_STATUS.map(({ label, color }) => (
            <span className="design-link-status" key={label} style={{ color }}>
              {label}
            </span>
          ))}
        </div>

        <span className="design-item__label">breaker_state — pilule teintée</span>
        <div className="design-pills">
          {BREAKER_STATE.map(({ label, color, tint }) => (
            <span className="design-pill" key={label} style={{ color, background: tint }}>
              {label}
            </span>
          ))}
        </div>
      </section>

      <section className="design-section" aria-labelledby="espacements">
        <h2 id="espacements">Espacements</h2>
        <p className="design-section__note">
          Base de 4 px, pas canoniques 4 · 8 · 12 · 16 · 24 · 40. Cellules 8×12, cartes 16, panneaux
          24, intervalles de section 40.
        </p>
        {SPACING.map((token) => (
          <div className="design-space" key={token}>
            <span className="design-space__name">{token}</span>
            <span className="design-space__bar" style={{ width: `var(${token})` }} />
          </div>
        ))}
      </section>

      <section className="design-section" aria-labelledby="rayons">
        <h2 id="rayons">Rayons</h2>
        <p className="design-section__note">Trois rayons, chacun lié à une famille d’éléments.</p>
        <div className="design-grid">
          {RADII.map(({ token, usage }) => (
            <div className="design-card" key={token}>
              <div
                className="design-swatch__chip"
                style={{ background: 'var(--surface-sunken)', borderRadius: `var(${token})` }}
              />
              <span style={{ font: 'var(--text-label)' }}>{usage}</span>
              <span className="design-swatch__value">{token}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

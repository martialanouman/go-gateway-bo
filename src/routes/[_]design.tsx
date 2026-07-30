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
import type { BreakerState, LinkStatus } from '~/components/primitives'
import {
  Button,
  Checkbox,
  RadioGroup,
  Select,
  StatusPill,
  Switch,
  Table,
  Tabs,
  TextField,
} from '~/components/primitives'
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
 *
 * **Les valeurs viennent du contrat, et la page les rend par `StatusPill`.** Elle annonçait
 * auparavant `bound` / `unbound`, qui n'existent dans aucune énumération, avec des `<span>` peints à
 * la main : la référence enseignait donc deux valeurs que le payload n'émet jamais, et dans des
 * couleurs qui ont fini par diverger de celles du composant. Une page de référence qui contredit ce
 * qu'elle documente est pire qu'absente.
 */
const LINK_STATUS = ['up', 'reconnecting', 'down'] as const satisfies readonly LinkStatus[]

/**
 * `breaker_state` — l'état du disjoncteur. Rendu en **pilule teintée**, jamais en point, et jamais
 * dérivé du champ précédent.
 *
 * `open` est **ambre**, comme la charte le range : un disjoncteur ouvert est un état dégradé dont on
 * attend la reprise, pas une panne qui appelle un rebind. Cette page le peignait en rouge, à côté
 * d'un composant qui le peignait en ambre.
 */
const BREAKER_STATE = ['closed', 'half_open', 'open'] as const satisfies readonly BreakerState[]

/**
 * Les pas canoniques. Aucune valeur en pixels n'est répétée ici : la barre tire sa largeur du token
 * lui-même, de sorte que la page ne puisse pas mentir si `spacing.css` change.
 */
const SPACING = ['--sp-2', '--sp-4', '--sp-6', '--sp-7', '--sp-9', '--sp-11'] as const

/**
 * Trois connecteurs figés, typés sur les unions du contrat.
 *
 * Le typage n'est pas décoratif ici : la version précédente de cette page annonçait `bound` et
 * `unbound` comme valeurs de `link_status`, alors que le contrat dit `up | reconnecting | down`.
 * La page de référence enseignait donc deux valeurs que le payload n'émet jamais — et `StatusPill`
 * les aurait peintes en gris « au repos ».
 */
const CONNECTOR_ROWS = [
  { id: 'cnx_01', name: 'Orange CI', link: 'up', breaker: 'closed', throughput: '8 123' },
  { id: 'cnx_02', name: 'MTN CI', link: 'reconnecting', breaker: 'half_open', throughput: '504' },
  { id: 'cnx_03', name: 'Moov CI', link: 'down', breaker: 'open', throughput: '0' },
] as const satisfies readonly {
  id: string
  name: string
  link: LinkStatus
  breaker: BreakerState
  throughput: string
}[]

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
          {LINK_STATUS.map((state) => (
            <StatusPill kind="link" key={state} state={state} />
          ))}
        </div>

        <span className="design-item__label">breaker_state — pilule teintée</span>
        <div className="design-pills">
          {BREAKER_STATE.map((state) => (
            <StatusPill kind="breaker" key={state} state={state} />
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

      <PrimitivesSection />
    </main>
  )
}

/**
 * Les primitives du lot 1 (step-041), **avec leurs états**.
 *
 * Cette section n'est pas une vitrine : c'est là qu'on vérifie qu'un état existe et qu'il est
 * lisible. Un champ invalide, un bouton occupé, un onglet désactivé ne se voient nulle part ailleurs
 * avant qu'un écran ne les produise — et le jour où un écran les produit, il est trop tard pour
 * découvrir qu'on ne les avait jamais dessinés.
 */
function PrimitivesSection() {
  return (
    <section className="design-section" aria-labelledby="primitives">
      <h2 id="primitives">Primitives — lot 1</h2>
      <p className="design-section__note">
        Comportement et accessibilité par Base UI, forme par les tokens. Chaque primitive est
        montrée avec les états qu’un écran rencontrera : défaut, désactivé, invalide, chargement.
      </p>

      <div className="design-grid">
        <div className="design-card">
          <span style={{ font: 'var(--text-label)' }}>Boutons</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
            <Button variant="primary">Effectuer la rotation</Button>
            <Button>Annuler</Button>
            <Button variant="destructive">Déconnecter</Button>
            <Button variant="link">Tout afficher</Button>
            <Button disabled>Indisponible</Button>
            <Button loading>Lancer le job</Button>
          </div>
        </div>

        <div className="design-card">
          <span style={{ font: 'var(--text-label)' }}>Champs</span>
          <TextField label="Nom du client" placeholder="Acme SA" />
          <TextField label="MSISDN" mono placeholder="2250701020304" />
          <TextField label="max_sessions" hint="Baisser ce quota ne coupe pas les binds vivants." />
          <TextField label="Sender ID" error="Ce sender ID est déjà pris." />
          <TextField label="Compte" disabled placeholder="Indisponible" />
        </div>

        <div className="design-card">
          <span style={{ font: 'var(--text-label)' }}>Sélecteur et bascules</span>
          <Select
            label="balance_scope"
            options={[
              { value: 'shared', label: 'Pool partagé' },
              { value: 'per_account', label: 'Par compte' },
            ]}
            defaultValue="shared"
          />
          <Checkbox label="Masquer les MSISDN" defaultChecked />
          <Checkbox label="Tout sélectionner" indeterminate />
          <Checkbox label="Indisponible" disabled />
          <Switch label="Facturation activée" defaultChecked />
          <RadioGroup
            label="balance_scope"
            defaultValue="shared"
            options={[
              { value: 'shared', label: 'Pool partagé' },
              { value: 'per_account', label: 'Par compte' },
            ]}
          />
        </div>

        <div className="design-card">
          <span style={{ font: 'var(--text-label)' }}>Onglets</span>
          <Tabs
            defaultValue="sessions"
            tabs={[
              { value: 'sessions', label: 'Sessions' },
              { value: 'binds', label: 'Binds', count: 12 },
              { value: 'quotas', label: 'Quotas', disabled: true },
            ]}
          />
        </div>

        <div className="design-card">
          <span style={{ font: 'var(--text-label)' }}>
            Statut — deux dimensions, jamais fusionnées
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            <StatusPill kind="link" state="up" live meta="~2 s" />
            <StatusPill kind="link" state="reconnecting" />
            <StatusPill kind="link" state="down" />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            <StatusPill kind="breaker" state="closed" />
            <StatusPill kind="breaker" state="half_open" />
            <StatusPill kind="breaker" state="open" />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
            <StatusPill kind="entity" state="active" />
            <StatusPill kind="entity" state="suspended" />
            <StatusPill kind="entity" state="closed" />
            <StatusPill kind="delivery" state="rejected" />
          </div>
          <span className="design-swatch__value">
            link_status en point · breaker_state en pilule · `closed` ne veut pas dire la même chose
            selon la dimension, d’où le `kind` obligatoire
          </span>
        </div>
      </div>

      <div className="design-card" style={{ marginTop: 'var(--sp-4)' }}>
        <span style={{ font: 'var(--text-label)' }}>Tableau</span>
        <Table
          caption="Connecteurs"
          rowKey={(row) => row.id}
          sort={{ key: 'throughput', direction: 'descending' }}
          columns={[
            { key: 'name', header: 'Connecteur', cell: (row) => row.name, sortable: true },
            { key: 'id', header: 'Identifiant', cell: (row) => row.id, mono: true },
            {
              key: 'link',
              header: 'link_status',
              // Pas de `live` ici : cette page est un instantané en dur, et le pouls est le seul
              // signal de fraîcheur du produit. Le poser sur des lignes figées le ferait mentir.
              cell: (row) => <StatusPill kind="link" state={row.link} />,
            },
            {
              key: 'breaker',
              header: 'breaker_state',
              cell: (row) => <StatusPill kind="breaker" state={row.breaker} />,
            },
            {
              key: 'throughput',
              header: 'Débit',
              cell: (row) => row.throughput,
              align: 'end',
              mono: true,
              sortable: true,
            },
          ]}
          rows={CONNECTOR_ROWS}
        />
      </div>
    </section>
  )
}

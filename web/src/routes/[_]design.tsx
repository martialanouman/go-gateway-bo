import { createFileRoute } from '@tanstack/react-router'
import {
  Button,
  DataTable,
  Dot,
  Field,
  GLYPH_NAMES,
  Icon,
  Input,
  Select,
  StatusPill,
  Tabs,
} from '~/components/ui'
import {
  ACCENT_COLORS,
  CONTRAST_PAIRS,
  RADII,
  SPACINGS,
  SURFACES,
  TYPE_ROLES,
} from '~/lib/design-tokens'
import '~/styles/design-reference.css'

/**
 * `/_design` — la référence visuelle du dépôt.
 *
 * Page interne, volontairement absente de la navigation : elle ne s'adresse pas à un opérateur mais
 * à qui écrit un écran. Elle rend la charte **telle qu'elle est réellement installée**, de sorte
 * qu'une couleur ou une graisse se vérifie ici plutôt que de s'inventer dans un composant.
 *
 * **Le nom du fichier est `[_]design.tsx` et non `_design.tsx`.** Dans TanStack Router, un segment
 * préfixé d'un souligné est une mise en page *sans chemin* : la page n'aurait aucune URL à elle. Les
 * crochets échappent le caractère et rendent le segment littéral.
 *
 * Mesuré le 08/08/2026 en renommant le fichier : le chemin de la mise en page vaut `/`, qui est déjà
 * celui de `_shell`, et `vite build` **échoue** — `Conflicting configuration paths were found for the
 * following routes: "/", "/"`, rc=1. Le symptôme est donc plus franc qu'une page injoignable, mais il
 * tient à la coexistence des deux : seul dans un arbre, `_design.tsx` produirait une route muette.
 *
 * Elle est un **frère** de `_shell`, donc hors de la coquille, et sans garde de session — elle
 * n'affiche aucune donnée. Ce qu'elle rend vient entièrement de `~/lib/design-tokens`, que
 * `test/charte.test.ts` lit aussi : « chaque paire utilisée par cette page atteint AA » est donc
 * littéralement vrai, plutôt que maintenu à la main de deux côtés.
 *
 * **Elle est servie en production comme ailleurs.** Aucune donnée réelle, aucune API jointe : rien à
 * fuiter. En contrepartie elle permet de vérifier qu'un déploiement rend bien la charte, polices
 * comprises — ce qu'aucune capture d'écran locale ne prouve.
 *
 * Elle rend aussi les **primitives** depuis step-041 : un écran y lit l'état exact d'un contrôle
 * refusé, d'un champ en erreur ou d'une pilule de disjoncteur, plutôt que de le déduire d'une
 * capture. Ce qu'elle ne montre pas encore : les surfaces flottantes et les cinq états de contenu,
 * qui arrivent en step-042.
 */
export const Route = createFileRoute('/_design')({ component: DesignReference })

/**
 * Des lignes **inventées**, et elles doivent le rester : cette page ne parle à personne. Le premier
 * tableau branché sur le BFF est de step-040, et c'est elle qui apportera `QueryClientProvider`.
 */
const SPECIMEN_ROWS = [
  {
    id: 'orange-ci',
    name: 'Orange CI',
    link: 'up',
    breaker: 'closed',
    bind: 'bnd_8f2c',
    throughput: '1 208',
  },
  {
    id: 'mtn-ci',
    name: 'MTN CI',
    link: 'reconnecting',
    breaker: 'half_open',
    bind: 'bnd_31a0',
    throughput: '504',
  },
  {
    id: 'moov-ci',
    name: 'Moov CI',
    link: 'down',
    breaker: 'open',
    bind: 'bnd_77de',
    throughput: '0',
  },
] as const

function DesignReference() {
  return (
    <main className="design">
      <header className="design__intro">
        <h1 className="design__title">Référence visuelle</h1>
        <p className="design__lede">
          La charte telle qu'elle est installée. Un écran prend ses valeurs ici ; s'il n'en trouve
          pas, c'est une question à poser à la charte, pas une valeur à inventer.
        </p>
      </header>

      <section className="design__section">
        <h2 id="typo">Typographie</h2>
        <ul className="design__list">
          {TYPE_ROLES.map(({ token, role, sample }) => (
            <li className="design__row" key={token}>
              <span className="design__sample" style={{ font: `var(${token})` }}>
                {sample}
              </span>
              <span className="design__meta">
                <code>{token}</code> · {role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="design__section">
        <h2 id="surfaces">Surfaces</h2>
        <ul className="design__swatches">
          {SURFACES.map(({ token, role }) => (
            <li className="design__swatch" key={token} style={{ background: `var(${token})` }}>
              <code>{token}</code>
              <span className="design__meta">{role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="design__section">
        <h2 id="couleurs">Accent et sémantique</h2>
        <ul className="design__swatches">
          {ACCENT_COLORS.map(({ token, role }) => (
            <li className="design__swatch design__swatch--bordered" key={token}>
              <span className="design__chip" style={{ background: `var(${token})` }} />
              <code>{token}</code>
              <span className="design__meta">{role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="design__section">
        <h2 id="espacements">Espacements</h2>
        <ul className="design__list">
          {SPACINGS.map((token) => (
            <li className="design__row" key={token}>
              <span className="design__bar" style={{ width: `var(${token})` }} />
              <span className="design__meta">
                <code>{token}</code>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="design__section">
        <h2 id="rayons">Rayons</h2>
        <ul className="design__swatches">
          {RADII.map(({ token, role }) => (
            <li className="design__swatch design__swatch--bordered" key={token}>
              <span className="design__radius" style={{ borderRadius: `var(${token})` }} />
              <code>{token}</code>
              <span className="design__meta">{role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="design__section">
        <h2 id="contraste">Contraste</h2>
        <p className="design__lede">
          Chaque ligne est vérifiée à 4,5:1 par <code>test/charte.test.ts</code>, qui lit cette même
          table. Une paire ajoutée ici est donc testée sans autre geste.
        </p>
        <table className="design__table">
          <thead>
            <tr>
              <th scope="col">Rendu</th>
              <th scope="col">Texte</th>
              <th scope="col">Fond</th>
              <th scope="col">Usage</th>
            </tr>
          </thead>
          <tbody>
            {CONTRAST_PAIRS.map(({ text, background, over, usage }) => (
              <tr key={`${text}-${background}`}>
                <td style={{ background: `var(${over ?? '--surface-page'})` }}>
                  <span
                    className="design__pair"
                    style={{ color: `var(${text})`, background: `var(${background})` }}
                  >
                    Exemple
                  </span>
                </td>
                <td>
                  <code>{text}</code>
                </td>
                <td>
                  <code>{background}</code>
                </td>
                <td>{usage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="design__section">
        <h2 id="primitives">Primitives</h2>
        <p className="design__lede">
          Les contrôles dans les états où ils se lisent mal ailleurs : un refus, un champ invalide,
          un disjoncteur. La règle la plus stricte du système est ici — <code>link_status</code>{' '}
          rend un point, <code>breaker_state</code> une pilule, et les deux ne se déduisent jamais
          l'une de l'autre.
        </p>

        <div className="design__row">
          <Button variant="primary" size="sm">
            Nouveau client
          </Button>
          <Button>Réinitialiser</Button>
          <Button variant="danger">Déconnecter la session</Button>
          <Button variant="link">Voir la trace</Button>
          <Button loading>Export…</Button>
          <Button blocked aria-describedby="refus-demo">
            Effectuer la rotation
          </Button>
        </div>
        <p className="design__meta" id="refus-demo">
          Un contrôle interdit reste visible, atteignable au clavier, et dit ce qui le débloquerait.
        </p>

        <div className="design__row">
          <Field label="Sender ID" hint="Onze caractères au plus.">
            <Input mono placeholder="BANQUE-CI" required />
          </Field>
          <Field label="Adresse e-mail" error="Cette adresse n’est pas reconnue.">
            <Input defaultValue="operatrice@" />
          </Field>
          <Select
            label="balance_scope"
            options={[
              { value: 'shared', label: 'Pool partagé' },
              { value: 'per_account', label: 'Par compte' },
            ]}
            defaultValue="shared"
          />
        </div>

        <div className="design__row">
          <StatusPill kind="link" state="up" live meta="3/4 binds" />
          <StatusPill kind="link" state="reconnecting" />
          <StatusPill kind="link" state="down" />
          <StatusPill kind="breaker" state="closed" />
          <StatusPill kind="breaker" state="open" />
          <StatusPill kind="breaker" state="half_open" />
          <StatusPill kind="entity" state="closed" />
          <StatusPill kind="delivery" state="rejected" />
        </div>

        <Tabs
          defaultValue="sessions"
          tabs={[
            { value: 'sessions', label: 'Sessions', count: 8 },
            { value: 'webhooks', label: 'Webhooks MO/DLR' },
            { value: 'contenu', label: 'Contenu', disabled: true },
          ]}
        />

        <DataTable
          caption="Connecteurs — spécimen de la référence visuelle"
          rowKey={(row) => row.id}
          columns={[
            { key: 'name', header: 'Connecteur', cell: (row) => row.name, sortable: true },
            {
              key: 'link',
              header: 'link_status',
              cell: (row) => <StatusPill kind="link" state={row.link} />,
            },
            {
              key: 'breaker',
              header: 'breaker_state',
              cell: (row) => <StatusPill kind="breaker" state={row.breaker} />,
            },
            { key: 'id', header: 'Bind', cell: (row) => row.bind, mono: true },
            {
              key: 'throughput',
              header: 'Débit',
              cell: (row) => row.throughput,
              align: 'end',
              sortable: true,
            },
          ]}
          rows={SPECIMEN_ROWS}
          sort={{ key: 'throughput', direction: 'descending' }}
        />

        <ul className="design__list">
          {GLYPH_NAMES.map((name) => (
            <li className="design__row" key={name}>
              <Icon name={name} size={16} />
              <code className="design__meta">{name}</code>
            </li>
          ))}
          <li className="design__row">
            <Dot tone="up" live />
            <code className="design__meta">Dot — le glyphe le plus employé</code>
          </li>
        </ul>
      </section>
    </main>
  )
}

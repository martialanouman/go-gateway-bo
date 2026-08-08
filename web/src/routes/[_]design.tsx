import { createFileRoute } from '@tanstack/react-router'
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
 * Ce qu'elle ne montre pas : les primitives habillées (boutons, tables, pilules) et les cinq états
 * de contenu, qui arrivent en step-041 et step-042. Elle ne montre que des **tokens**.
 */
export const Route = createFileRoute('/_design')({ component: DesignReference })

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
    </main>
  )
}

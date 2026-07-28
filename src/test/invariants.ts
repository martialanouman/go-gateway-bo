/**
 * Invariant (a), outillé : **le corps d'un message ne sort jamais de l'onglet qui l'affiche.**
 *
 * Ni log, ni toast, ni URL, ni message d'erreur, ni export, ni cache persisté, ni attribut de trace.
 * Cet utilitaire est l'**oracle** qui le vérifie dans les tests. Ce n'est pas la garde : une garde
 * empêche, un oracle détecte. La garde réelle se construit ailleurs, en profondeur — le corps n'est
 * lu que par un module de `src/server/gateway`, une règle de lint interdit son nom ailleurs, et rien
 * ne recopie de texte libre venu de la passerelle (voir `GatewayError`).
 *
 * ## Ce que cet oracle ne peut pas voir
 *
 * La détection repose sur la reconnaissance d'une chaîne. Elle est donc **aveugle** dès que le corps
 * est transformé sans rester reconnaissable :
 *
 * - **haché** — un condensat de SMS reste une fuite (les corps sont courts et peu entropiques, donc
 *   attaquables par dictionnaire), mais aucun scan ne peut le repérer ;
 * - **chiffré** — même raisonnement.
 *
 * Les transformations qui *préservent* l'information sont couvertes, et elles le sont en **décodant
 * la cible** plutôt qu'en devinant les formes que le noyau pourrait prendre : troncature, découpage
 * en segments SMS, base64, hexadécimal, encodage-pourcentage, échappement `\uXXXX`, et toute
 * combinaison de ceux-ci. Générer des variantes du noyau ne marchait pas : la base64 s'aligne sur
 * des blocs de trois octets, si bien qu'un noyau encodé au milieu d'une charge utile ne contient
 * presque jamais la base64 du noyau isolé.
 *
 * La sentinelle répète un noyau court pour une autre raison : un corps tronqué à vingt caractères en
 * contient encore un. En revanche, **un fragment plus court que le noyau (dix caractères) échappe à
 * la détection** — un découpage en segments SMS réels (153 caractères) est très au-dessus, mais la
 * limite existe.
 *
 * Cette limite est écrite ici, et pas seulement connue : step-103 branchera cet oracle sur les
 * vraies réponses, et hériterait sinon d'une confiance que l'outil ne mérite pas.
 */

import { inspect } from 'node:util'

/**
 * Noyau court et improbable. Court, pour survivre à une troncature ; improbable, pour qu'une
 * correspondance ne soit jamais fortuite.
 */
const SENTINEL_CORE = 'ZQX7-CORPS'

/**
 * Corps de message sentinelle, à injecter dans les fabriques et les réponses de test. Le noyau y est
 * répété pour qu'un extrait — vingt caractères, un segment SMS — reste détectable.
 */
export const MESSAGE_BODY_SENTINEL = `${SENTINEL_CORE} confidentiel ${SENTINEL_CORE} ne doit jamais sortir ${SENTINEL_CORE}`

/**
 * Les formes de la cible dans lesquelles le noyau peut réapparaître.
 *
 * On décode ce qu'on inspecte, plutôt que d'encoder ce qu'on cherche. Un seul niveau de décodage par
 * forme, puis on s'arrête : au-delà, on inventerait des textes que personne n'a jamais produits.
 */
function decodedForms(text: string): string[] {
  const forms = [text]

  // Encodage-pourcentage, tel qu'une URL le porte.
  try {
    const decoded = decodeURIComponent(text)
    if (decoded !== text) forms.push(decoded)
  } catch {
    // Une séquence `%` invalide n'est pas un encodage : le texte brut suffit.
  }

  // Échappement `\uXXXX`, tel qu'un sérialiseur JSON conservateur le produit.
  if (text.includes('\\u')) {
    forms.push(
      text.replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
        String.fromCharCode(Number.parseInt(code, 16)),
      ),
    )
  }

  // Toute séquence assez longue pour porter le noyau est tentée en base64 puis en hexadécimal. Un
  // décodage qui ne produit pas de texte lisible est simplement ignoré — il ne peut rien révéler.
  for (const [, candidate] of text.matchAll(/([A-Za-z0-9+/_-]{12,}={0,2})/g)) {
    if (candidate) forms.push(Buffer.from(candidate, 'base64').toString('utf8'))
  }
  for (const [, candidate] of text.matchAll(/([0-9a-fA-F]{16,})/g)) {
    if (candidate) forms.push(Buffer.from(candidate, 'hex').toString('utf8'))
  }

  return forms
}

export type ScanTarget = {
  /** Ce qui est inspecté — un nom parlant rend l'échec exploitable. */
  what: string
  /** La représentation à scanner : corps de réponse, ligne de log, URL, trace… */
  text: string
}

/**
 * Échoue si le corps sentinelle — ou l'une de ses formes encodées — apparaît dans l'une des cibles.
 *
 * L'appelant fournit des **représentations textuelles** : c'est délibéré. Un objet peut fuir par sa
 * sérialisation JSON, par `util.inspect` (ce que fait `console.error`), par une URL ou par un
 * en-tête, et ces chemins ne produisent pas le même texte. Les passer explicitement force à dire
 * lequel on vérifie.
 */
export function assertNoMessageBody(targets: ScanTarget[]): void {
  const found = findMessageBody(targets)
  if (!found) return

  throw new Error(
    `Invariant (a) violé : le corps d'un message apparaît dans ${found.what}. ` +
      `Forme détectée : « ${found.excerpt} ». ` +
      `Le corps ne sort jamais de l'onglet qui l'affiche — ni log, ni URL, ni erreur, ni trace.`,
  )
}

/** Rend la première occurrence trouvée, ou `undefined`. Les deux fonctions publiques s'y ramènent. */
export function findMessageBody(
  targets: ScanTarget[],
): { what: string; excerpt: string } | undefined {
  const needle = SENTINEL_CORE.toLowerCase()

  for (const { what, text } of targets) {
    // La concaténation attrape un corps réparti sur plusieurs champs — un `before_json` et un
    // `after_json`, deux attributs de trace — qu'aucune cible ne porterait à elle seule.
    for (const form of decodedForms(text)) {
      const position = form.toLowerCase().indexOf(needle)
      if (position !== -1) {
        return { what, excerpt: form.slice(position, position + 24) }
      }
    }
  }

  return undefined
}

/** Vrai si l'une des cibles porte le corps. Utile pour asserter l'échec de l'oracle lui-même. */
export function containsMessageBody(targets: ScanTarget[]): boolean {
  return findMessageBody(targets) !== undefined
}

/**
 * Déplie les représentations par lesquelles une valeur peut fuir.
 *
 * À préférer à une liste écrite à la main : le mode d'échec de cette liste est l'oubli silencieux —
 * `JSON.stringify` sans `util.inspect`, l'URL sans les en-têtes — et un oubli ne se voit pas, il
 * rend simplement le test moins sévère sans que rien ne l'annonce.
 */
export function representationsOf(label: string, value: unknown): ScanTarget[] {
  const targets: ScanTarget[] = [
    { what: `${label} (texte)`, text: String(value) },
    // `util.inspect` est ce que produit `console.error` : il sérialise toutes les propriétés propres
    // énumérables, là où `JSON.stringify` s'arrête à ce que `toJSON` veut bien rendre.
    {
      what: `${label} (inspection, telle qu'un logger la produit)`,
      text: inspect(value, { depth: null }),
    },
  ]

  try {
    targets.push({ what: `${label} (JSON)`, text: JSON.stringify(value) ?? '' })
  } catch {
    // Une structure circulaire ne se sérialise pas ; `inspect` l'a déjà couverte.
  }

  if (value instanceof Error && value.stack) {
    targets.push({ what: `${label} (pile)`, text: value.stack })
  }

  if (value instanceof Request) {
    targets.push({ what: `${label} (URL)`, text: value.url })
    targets.push({ what: `${label} (en-têtes)`, text: JSON.stringify([...value.headers]) })
  }

  return targets
}

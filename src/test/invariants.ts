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
 * Les transformations qui *préservent* la forme sont couvertes : troncature, découpage en segments
 * SMS, encodage base64 / hexadécimal / pourcentage / `\uXXXX`, échappement JSON. C'est pour cela que
 * la sentinelle répète un noyau court : un corps coupé à vingt caractères en contient encore un.
 *
 * Cette limite est écrite ici, et pas seulement connue : step-103 branchera cet oracle sur les
 * vraies réponses, et hériterait sinon d'une confiance que l'outil ne mérite pas.
 */

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

/** Les formes sous lesquelles le noyau peut se présenter sans cesser d'être lisible. */
function coreVariants(): string[] {
  const core = SENTINEL_CORE

  return [
    core,
    core.toLowerCase(),
    Buffer.from(core, 'utf8').toString('base64'),
    Buffer.from(core, 'utf8').toString('base64url'),
    Buffer.from(core, 'utf8').toString('hex'),
    encodeURIComponent(core),
    // Échappement `\uXXXX`, tel qu'un sérialiseur JSON conservateur le produirait.
    [...core].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
  ]
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
  const variants = coreVariants()

  for (const { what, text } of targets) {
    for (const variant of variants) {
      if (text.includes(variant)) {
        throw new Error(
          `Invariant (a) violé : le corps d'un message apparaît dans ${what}. ` +
            `Forme détectée : « ${variant.slice(0, 24)} ». ` +
            `Le corps ne sort jamais de l'onglet qui l'affiche — ni log, ni URL, ni erreur, ni trace.`,
        )
      }
    }
  }
}

/** Vrai si l'une des cibles porte le corps. Utile pour asserter l'échec de l'oracle lui-même. */
export function containsMessageBody(targets: ScanTarget[]): boolean {
  try {
    assertNoMessageBody(targets)
    return false
  } catch {
    return true
  }
}

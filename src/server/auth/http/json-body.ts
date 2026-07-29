/**
 * La lecture d'un corps JSON, et **uniquement** JSON.
 *
 * ## Pourquoi ce n'est pas une préférence de style
 *
 * `readBody` de H3 accepte aussi `application/x-www-form-urlencoded` — or un `<form>` de ce type est
 * une *simple request* : aucun preflight CORS, donc n'importe quelle page visitée par un opérateur
 * pourrait déclencher ces points d'entrée depuis **son** navigateur, avec **son** cookie de session.
 * Sur les routes de second facteur, cela rendrait le verrouillage actionnable à distance et le retrait
 * d'un appareil déclenchable par un tiers. Le JSON, lui, impose un preflight que rien ne satisfait ici.
 *
 * ## Pourquoi ce fichier vit sous `http/`, exclu de la couverture
 *
 * Parce qu'il ne décide rien : il lit un en-tête et rend un corps ou `undefined`. La règle qu'il porte
 * est la même que celle du handler de connexion, écrite une fois — trois copies de quatre lignes
 * auraient fini par diverger sur le détail qui compte, à savoir le type accepté.
 */

import { getRequestHeader, type H3Event, readBody } from 'h3'

export async function readJsonBody(event: H3Event): Promise<unknown> {
  const contentType = getRequestHeader(event, 'content-type')?.split(';')[0]?.trim()
  if (contentType !== 'application/json') return undefined

  return readBody(event).catch(() => undefined)
}

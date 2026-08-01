/**
 * Un `fetch` de test qui **répond par chemin**.
 *
 * Une doublure unique qui répond la même chose à toutes les URL ment dès que l'écran fait deux
 * appels — et les écrans en font tous au moins deux, `/auth/me` compris. Le mode d'échec observé est
 * pire qu'une assertion fausse : `usePermission` lit `permissions` sur la réponse d'une autre route,
 * le rendu lève à chaque tentative, et la suite tourne **sans fin** — la boucle étant synchrone,
 * `testTimeout` ne la coupe pas.
 *
 * Rend la liste des URL appelées : c'est ce qui permet d'asserter qu'une requête n'a **pas** eu
 * lieu, ce qu'aucune assertion sur le DOM ne dit.
 */

import { vi } from 'vitest'

export type StubbedRoute = { readonly body: unknown; readonly status?: number }

export function stubFetch(routes: Readonly<Record<string, StubbedRoute>>): string[] {
  const calls: string[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)

      // Le chemin le plus **long** gagne : `/api/admin/operators/create` doit l'emporter sur
      // `/api/admin/operators`, quel que soit l'ordre de déclaration. Sans ce tri, la réponse
      // dépendrait de l'ordre des clés d'un objet littéral, ce que personne ne relit.
      const match = Object.entries(routes)
        .sort(([a], [b]) => b.length - a.length)
        .find(([path]) => url.startsWith(path))

      if (!match) {
        return new Response(JSON.stringify({ error: `route non déclarée au test : ${url}` }), {
          status: 404,
        })
      }

      return new Response(JSON.stringify(match[1].body), { status: match[1].status ?? 200 })
    }),
  )

  return calls
}

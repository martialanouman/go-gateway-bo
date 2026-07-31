/**
 * Appeler le BFF **depuis le contexte de la page**, et non depuis Node.
 *
 * La différence n'est pas de commodité. Le cookie de session est `HttpOnly` : il vit dans le
 * navigateur, il accompagne les requêtes émises par lui, et un `fetch` lancé depuis le processus de
 * test partirait sans lui. Passer par `page.evaluate` fait porter l'appel par le navigateur, avec sa
 * session et son origine — la même que celle qu'une cérémonie WebAuthn comparera au `rpID`.
 */

import type { Page } from '@playwright/test'

export async function callApi(
  page: Page,
  path: string,
  body?: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: le corps des réponses du BFF varie selon la route.
): Promise<{ status: number; body: any }> {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : {} }
    },
    { path, body },
  )
}

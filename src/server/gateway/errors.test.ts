// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { GatewayError, toGatewayError } from './errors'

describe('toGatewayError', () => {
  it("traduit l'enveloppe plate du contrat en erreur typée", async () => {
    const response = jsonResponse(422, {
      code: 'validation_error',
      message: 'Le corps de la requête est invalide.',
      errors: [
        { field: 'name', message: 'requis' },
        { field: 'status', message: 'valeur inconnue' },
      ],
    })

    const error = await toGatewayError(response)

    expect(error).toBeInstanceOf(GatewayError)
    expect(error.code).toBe('validation_error')
    expect(error.status).toBe(422)
    expect(error.fieldErrors).toEqual([
      { field: 'name', message: 'requis' },
      { field: 'status', message: 'valeur inconnue' },
    ])
  })

  it('accepte une enveloppe sans `errors[]` — le contrat ne le rend pas obligatoire', async () => {
    const error = await toGatewayError(
      jsonResponse(404, { code: 'message_not_found', message: 'Inconnu.' }),
    )

    expect(error.code).toBe('message_not_found')
    expect(error.fieldErrors).toEqual([])
  })

  it('retombe sur un code stable quand la réponse ne suit pas le contrat', async () => {
    // Un 502 émis par un proxy en amont ne parle pas le contrat : il rend du HTML. L'appelant doit
    // quand même recevoir une erreur exploitable plutôt qu'une exception de parsing.
    const response = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    })

    const error = await toGatewayError(response)

    expect(error.code).toBe('upstream_unavailable')
    expect(error.status).toBe(502)
  })

  it('ne conserve jamais le corps brut de la réponse', async () => {
    // Invariant (a) : une erreur voyage dans les logs et les traces. Si elle transportait le corps
    // de la réponse, le corps d'un message finirait par y apparaître — sur `get-message` par
    // exemple. L'erreur ne retient que ce que le contrat décrit comme diagnostic.
    const secret = 'RDV demain 14h chez le notaire'
    const response = jsonResponse(500, {
      code: 'internal_error',
      message: 'Erreur interne.',
      body: secret,
      messages: [{ body: secret }],
    })

    const error = await toGatewayError(response)
    const serialised = JSON.stringify({ ...error, message: error.message, stack: error.stack })

    expect(serialised).not.toContain(secret)
    expect(error.message).not.toContain(secret)
  })

  it('expose un message lisible sans jamais promettre plus que le code', async () => {
    const error = await toGatewayError(
      jsonResponse(403, { code: 'forbidden_scope', message: 'Scope manquant.' }),
    )

    expect(error.message).toContain('forbidden_scope')
    expect(error.message).toContain('403')
  })
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

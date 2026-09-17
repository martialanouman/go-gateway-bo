import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { stubSession } from '../../test/session'
import { HttpError, isUnauthenticated, meQueryOptions } from './api'

describe('la lecture de la session', () => {
  it('interroge le BFF sur l’origine qui a servi le document', async () => {
    const fetch = stubSession({ permissions: ['routes:read'] })

    const me = await new QueryClient().fetchQuery(meQueryOptions)

    expect(me.permissions).toEqual(['routes:read'])
    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe(new URL('/api/auth/me', window.location.href).href)
  })

  it('rend un 401 reconnaissable, sans réessayer une session morte', async () => {
    const fetch = stubSession({ status: 401 })

    const error = await new QueryClient().fetchQuery(meQueryOptions).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect(isUnauthenticated(error)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('ne confond pas une panne serveur avec une session absente', async () => {
    stubSession({ status: 500 })

    const error = await new QueryClient().fetchQuery(meQueryOptions).catch((e: unknown) => e)

    expect(isUnauthenticated(error)).toBe(false)
    expect((error as HttpError).status).toBe(500)
  })
})

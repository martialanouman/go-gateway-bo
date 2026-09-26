import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { stubSession } from '../../test/session'
import { HttpError, isUnauthenticated, meQueryOptions, refusalMessage } from './api'

describe('reading the session', () => {
  it('queries the BFF on the origin that served the document', async () => {
    const fetch = stubSession({ permissions: ['routes:read'] })

    const me = await new QueryClient().fetchQuery(meQueryOptions)

    expect(me.permissions).toEqual(['routes:read'])
    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe(new URL('/api/auth/me', window.location.href).href)
  })

  it('returns a recognizable 401, without retrying a dead session', async () => {
    const fetch = stubSession({ status: 401 })

    const error = await new QueryClient().fetchQuery(meQueryOptions).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect(isUnauthenticated(error)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not mistake a server failure for a missing session', async () => {
    stubSession({ status: 500 })

    const error = await new QueryClient().fetchQuery(meQueryOptions).catch((e: unknown) => e)

    expect(isUnauthenticated(error)).toBe(false)
    expect((error as HttpError).status).toBe(500)
  })
})

describe('wording of a server refusal', () => {
  it('returns the screen fallback when the server wrote no message', () => {
    expect(refusalMessage(undefined, 'le repli')).toBe('le repli')
  })

  it('returns the fallback rather than an empty refusal', () => {
    // Le DTO `Error` déclare `message` **requis**, et rien n'y interdit la chaîne vide. Sans cette
    // clause, l'écran rendrait un `AuthRefusal` réduit à son icône : un refus qui ne refuse rien.
    expect(refusalMessage({ code: 'x', message: '' }, 'le repli')).toBe('le repli')
  })

  it('prefers the server sentence over the screen one', () => {
    expect(refusalMessage({ code: 'x', message: 'Ce refus-ci.' }, 'le repli')).toBe('Ce refus-ci.')
  })
})

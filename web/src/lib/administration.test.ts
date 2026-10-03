import { describe, expect, it } from 'vitest'
import { orRefusal } from './administration'

describe('orRefusal', () => {
  it('names a request that never reached the dashboard in French', async () => {
    await expect(
      orRefusal(Promise.reject(new TypeError('Failed to fetch')), 'La liste n’a pas pu être lue'),
    ).rejects.toThrow(
      'La liste n’a pas pu être lue : le tableau de bord ne répond pas. Réessayez dans un instant.',
    )
  })
})

// @vitest-environment node

/**
 * Le cycle de vie du pool : ouverture paresseuse, partage, extinction.
 *
 * Ces fonctions n'ont aujourd'hui aucun appelant — le BFF n'a pas encore de requête à servir — et
 * c'est précisément pour cela qu'elles méritent un test maintenant. Un défaut de fermeture ne se
 * manifeste pas à l'écriture : il se manifeste le jour d'un redéploiement tournant, quand les
 * connexions s'accumulent, ou quand un processus refuse de s'arrêter.
 *
 * Aucune base réelle n'est jointe : `postgres` (postgres.js) ouvre ses connexions paresseusement,
 * donc construire le pool ne parle à personne. Ces tests restent dans le projet `unit`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, connect, getDatabase, resetDatabaseForTests } from './index'

const URL = 'postgres://dashboard:dashboard@127.0.0.1:5432/dashboard'

beforeEach(() => {
  process.env.DATABASE_URL = URL
})

afterEach(async () => {
  await closeDatabase()
  // L'arrêt est terminal en production ; seuls les tests rouvrent, et par cette porte nommée.
  resetDatabaseForTests()
  delete process.env.DATABASE_URL
})

describe('getDatabase', () => {
  it('rend la même instance à chaque appel', () => {
    expect(getDatabase()).toBe(getDatabase())
  })

  it('refuse de démarrer sans DATABASE_URL', async () => {
    await closeDatabase()
    resetDatabaseForTests()
    // `delete`, et non `= undefined` : une affectation écrirait la chaîne « undefined », qui est
    // truthy — le test passerait alors par la branche « valeur invalide » et non par « absente ».
    delete process.env.DATABASE_URL

    // Pas de repli silencieux vers une base locale : une instance qui démarre en écrivant son
    // audit dans le vide est pire qu'une instance qui refuse de démarrer.
    expect(() => getDatabase()).toThrow(/DATABASE_URL/)
  })
})

describe('closeDatabase', () => {
  it('refuse toute requête nouvelle une fois l’extinction engagée', async () => {
    getDatabase()
    const closing = closeDatabase()

    // Sans cette garde, un appel concurrent — une écriture d'audit dans un `finally`, un handler
    // WebSocket qui se termine — rouvrirait un pool que plus personne ne fermerait, et le
    // processus ne s'arrêterait jamais.
    expect(() => getDatabase()).toThrow(/fermeture/)
    await closing
  })

  it('reste fermé une fois éteint — l’arrêt est terminal', async () => {
    // Un pool qui se rouvrirait après extinction empêcherait le processus de se terminer : une
    // écriture d'audit tardive suffirait à ressusciter des connexions que plus personne n'attend.
    getDatabase()
    await closeDatabase()

    expect(() => getDatabase()).toThrow(/fermeture/)
  })

  it('rend la même promesse quand on l’appelle deux fois', async () => {
    getDatabase()

    const first = closeDatabase()
    const second = closeDatabase()

    expect(first).toBe(second)
    await first
  })

  it('ne fait rien quand aucun pool n’a été ouvert', async () => {
    await expect(closeDatabase()).resolves.toBeUndefined()
  })
})

describe('connect', () => {
  it('rend un client et une instance Drizzle distincts à chaque appel', async () => {
    const first = connect(URL, { poolSize: 1 })
    const second = connect(URL, { poolSize: 1 })

    expect(first.db).not.toBe(second.db)
    await first.client.end({ timeout: 1 })
    await second.client.end({ timeout: 1 })
  })
})

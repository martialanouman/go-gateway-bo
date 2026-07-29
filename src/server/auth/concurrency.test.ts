// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createSemaphore, QueueFullError, readVerificationSlots } from './concurrency'

/** Une tâche qui reste en vol jusqu'à ce qu'on la relâche — pour tenir des tickets ouverts. */
function suspended(): { promise: Promise<void>; release: () => void } {
  let release = () => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

describe('sémaphore de vérification', () => {
  it('laisse passer jusqu à sa limite en parallèle', async () => {
    const semaphore = createSemaphore({ slots: 2, queueLimit: 10 })
    let inFlight = 0
    let peak = 0

    const first = suspended()
    const second = suspended()

    const runs = [first, second].map((task) =>
      semaphore.run(async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await task.promise
        inFlight -= 1
      }),
    )

    // Les deux doivent être en vol *en même temps* : un sémaphore qui sérialiserait tout tiendrait
    // la garantie de mémoire mais diviserait le débit de connexion par sa limite.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(peak).toBe(2)

    for (const task of [first, second]) task.release()
    await Promise.all(runs)
  })

  it('ne dépasse jamais sa limite, même sous rafale', async () => {
    const semaphore = createSemaphore({ slots: 3, queueLimit: 100 })
    let inFlight = 0
    let peak = 0

    await Promise.all(
      Array.from({ length: 40 }, () =>
        semaphore.run(async () => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 1))
          inFlight -= 1
        }),
      ),
    )

    expect(peak).toBe(3)
    expect(inFlight).toBe(0)
  })

  it('refuse au-delà de sa file plutôt que de la laisser croître', async () => {
    // Une file non bornée transforme la protection mémoire en réservoir : chaque requête en attente
    // garde son contexte vivant, et l'instance tombe quand même — plus tard, et sans qu'on ait vu
    // venir. Le refus est ce qui rend la borne réelle.
    const semaphore = createSemaphore({ slots: 1, queueLimit: 2 })
    const held = suspended()

    const running = semaphore.run(() => held.promise)
    const queued = [semaphore.run(async () => {}), semaphore.run(async () => {})]

    await expect(semaphore.run(async () => {})).rejects.toBeInstanceOf(QueueFullError)

    held.release()
    await Promise.all([running, ...queued])
  })

  it('relâche son ticket même quand la tâche échoue', async () => {
    // Le mode d'échec le plus coûteux : un ticket fuité par cas d'erreur épuise le sémaphore en
    // quelques minutes, et plus personne ne se connecte. Il ne se voit pas au test heureux.
    const semaphore = createSemaphore({ slots: 1, queueLimit: 5 })

    await expect(
      semaphore.run(async () => {
        throw new Error('échec de vérification')
      }),
    ).rejects.toThrow('échec de vérification')

    await expect(semaphore.run(async () => 'de nouveau libre')).resolves.toBe('de nouveau libre')
  })

  it('rend la valeur de la tâche', async () => {
    const semaphore = createSemaphore({ slots: 1, queueLimit: 5 })

    await expect(semaphore.run(async () => 42)).resolves.toBe(42)
  })
})

describe('nombre de places de vérification', () => {
  it('laisse toujours un thread au reste du process', () => {
    // **Le mode d'échec réel n'est pas la mémoire, c'est la famine du threadpool.**
    // `crypto.scrypt` s'exécute dans le pool libuv — quatre threads par défaut — qu'il partage avec
    // `dns.lookup` et les entrées/sorties de fichiers. Saturer ce pool avec des vérifications de mot
    // de passe fait ramer les résolutions DNS du process, donc les appels vers l'API Admin : une
    // rafale de connexions dégraderait tout le tableau de bord. C'est l'invariant (e) attaqué depuis
    // l'intérieur, ce qui est précisément le genre de panne qu'on ne diagnostique pas.
    expect(readVerificationSlots({})).toBe(3)
    expect(readVerificationSlots({ UV_THREADPOOL_SIZE: '4' })).toBe(3)
  })

  it('profite d un pool agrandi sans qu on ait à y penser', () => {
    expect(readVerificationSlots({ UV_THREADPOOL_SIZE: '8' })).toBe(7)
    expect(readVerificationSlots({ UV_THREADPOOL_SIZE: '16' })).toBe(15)
  })

  it('garde au moins une place quand le pool est minuscule ou absurde', () => {
    // Zéro place, ce serait un tableau de bord où personne ne peut se connecter — une panne totale
    // provoquée par une variable d'environnement mal saisie.
    for (const size of ['1', '0', '-4', 'beaucoup', '']) {
      expect(readVerificationSlots({ UV_THREADPOOL_SIZE: size }), size).toBeGreaterThanOrEqual(1)
    }
  })
})

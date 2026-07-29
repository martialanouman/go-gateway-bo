/**
 * Bornage de la concurrence des vérifications de mot de passe.
 *
 * ## Le risque, et pourquoi ce n'est pas celui qu'on croit
 *
 * Une vérification scrypt aux paramètres de production demande 128 Mio et 166 ms. L'inquiétude
 * évidente est donc l'épuisement mémoire — cinquante connexions concurrentes, 6,4 Gio, l'instance
 * tombe. Elle est réelle, mais elle n'est pas le mode d'échec le plus probable.
 *
 * **Le vrai risque est la famine du threadpool libuv.** `crypto.scrypt` s'exécute dans ce pool —
 * quatre threads par défaut — et le partage avec `dns.lookup` et les entrées/sorties de fichiers.
 * Quatre vérifications en continu suffisent à faire attendre toutes les résolutions DNS du process,
 * donc les appels vers l'API Admin de la passerelle. Une rafale de tentatives de connexion
 * dégraderait l'ensemble du tableau de bord sans qu'aucune métrique d'authentification ne bouge :
 * l'invariant (e) attaqué depuis l'intérieur, et une panne qu'on ne diagnostique pas.
 *
 * D'où la règle : **toujours moins de places que de threads**, pour qu'il en reste au reste du
 * process.
 *
 * ## Pourquoi un sémaphore par process, et non une limite globale
 *
 * La ressource protégée — threads et mémoire — est **par instance**. Une limite globale partagée
 * entre les instances ne protégerait aucune d'elles en particulier. Le plafond global, c'est le
 * rate-limit distribué d'une step ultérieure ; les deux rôles ne se confondent pas.
 *
 * ## Pourquoi la file est bornée
 *
 * Une file d'attente illimitée transforme la protection en réservoir : chaque requête en attente
 * garde son contexte vivant, et l'instance tombe quand même — plus tard, et sans qu'on l'ait vue
 * venir. Le refus au-delà de la file est ce qui rend la borne réelle.
 *
 * Ce refus est lui-même un levier de déni de service : saturer la file empêche les connexions
 * légitimes. C'est assumé, et pour deux raisons. La première est que l'alternative — l'épuisement
 * mémoire — est un déni plus total et moins observable. La seconde tient à **l'ordre des coûts** :
 * le compteur d'échecs par adresse IP (une lecture Postgres, quelques millisecondes) rejette
 * *avant* qu'un ticket ne soit demandé ici. Un attaquant depuis une seule adresse est éliminé sans
 * jamais toucher la file.
 */

/** Levée quand la file est pleine. L'appelant la traduit en 429, uniformément. */
export class QueueFullError extends Error {
  constructor() {
    super("Trop de vérifications d'authentification en attente.")
    this.name = 'QueueFullError'
  }
}

export type Semaphore = {
  run<T>(task: () => Promise<T>): Promise<T>
}

/**
 * Places de vérification simultanées, déduites de la taille du threadpool.
 *
 * Toujours **une de moins** que le pool : voir l'en-tête. La valeur suit `UV_THREADPOOL_SIZE` sans
 * qu'on ait à la régler à la main — agrandir le pool au déploiement augmente automatiquement le
 * débit de connexion, et ne rien faire reste sûr.
 *
 * Une valeur illisible ou absurde ne doit jamais donner zéro place : ce serait un tableau de bord où
 * plus personne ne se connecte, provoqué par une variable mal saisie.
 */
export function readVerificationSlots(env: NodeJS.ProcessEnv): number {
  const DEFAULT_THREADPOOL_SIZE = 4
  const parsed = Number(env.UV_THREADPOOL_SIZE)
  const size = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_THREADPOOL_SIZE

  return Math.max(1, size - 1)
}

export function createSemaphore(options: { slots: number; queueLimit: number }): Semaphore {
  let available = options.slots
  const waiting: Array<() => void> = []

  function releaseOne(): void {
    const next = waiting.shift()
    if (next) {
      next()
      return
    }
    available += 1
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (available > 0) {
        available -= 1
      } else {
        if (waiting.length >= options.queueLimit) throw new QueueFullError()
        await new Promise<void>((resolve) => waiting.push(resolve))
      }

      try {
        return await task()
      } finally {
        // `finally`, et c'est le point critique de ce module : un ticket fuité par un chemin d'erreur
        // épuise le sémaphore en quelques minutes, et plus personne ne se connecte. Le test heureux
        // ne le montrerait jamais.
        releaseOne()
      }
    },
  }
}

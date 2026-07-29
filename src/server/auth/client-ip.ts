/**
 * L'adresse de l'appelant — celle sur laquelle le compteur d'échecs s'appuie.
 *
 * ## Pourquoi `x-forwarded-for` ne se lit pas naïvement
 *
 * Cet en-tête est fourni par le client. Derrière un load balancer, celui-ci **ajoute** son propre
 * maillon à droite, mais tout ce qui se trouve à gauche a été écrit par quelqu'un d'autre — c'est-à-dire
 * potentiellement par l'attaquant. Prendre la première valeur, comme le font la plupart des exemples,
 * revient à laisser l'appelant **choisir son identité de comptage** : il envoie une adresse différente
 * à chaque tentative, et le compteur par IP ne compte plus rien. C'est la façon la plus courante de
 * neutraliser un anti-brute-force sans que rien ne le signale.
 *
 * La règle est donc : on ne fait confiance qu'aux **derniers** maillons, ceux qu'ont écrits nos
 * propres proxies, et on compte combien il y en a. `AUTH_TRUSTED_PROXIES` déclare ce nombre.
 *
 * Sa valeur par défaut est **zéro** : sans déclaration explicite, l'en-tête est ignoré et l'adresse
 * de connexion fait foi. Se tromper dans ce sens dégrade la précision derrière un proxy ; se tromper
 * dans l'autre ouvre la porte. Le défaut doit être celui qui échoue du bon côté.
 */

export type ClientIpSources = {
  /** Valeur brute de `x-forwarded-for`, si présente. */
  readonly forwardedFor?: string | null
  /**
   * Adresse de la connexion TCP, **telle que le serveur la constate lui-même**.
   *
   * Jamais un en-tête. `x-real-ip` en particulier est fourni par le client au même titre que
   * `x-forwarded-for` : le lire ici reviendrait à refermer une porte tout en en ouvrant une autre,
   * et l'appelant choisirait de nouveau son identité de comptage.
   */
  readonly remoteAddress?: string | null
}

/**
 * Ce que vaut une adresse qu'on n'a pas pu déterminer.
 *
 * **Elle n'est pas comptée** : voir `isCountableIp`. Un seau commun serait pire que rien — vingt
 * échecs de n'importe qui verrouilleraient la connexion de tout le monde, ce qui transforme
 * l'anti-brute-force en déni de service à un coût dérisoire.
 */
export const UNKNOWN_CLIENT_IP = 'unknown'

/**
 * Vrai si cette adresse mérite un compteur.
 *
 * Une adresse indéterminée ne borne rien et se retourne contre les opérateurs légitimes. Renoncer au
 * comptage par adresse est le bon compromis : le compteur **par identifiant** continue de protéger
 * chaque compte, et c'est lui qui empêche de casser un mot de passe. Ce que l'on perd est la
 * détection du balayage — d'où l'avertissement au démarrage plutôt qu'un silence.
 */
export function isCountableIp(ip: string): boolean {
  return ip !== UNKNOWN_CLIENT_IP && ip.length > 0 && ip.length <= 64
}

/**
 * L'adresse de l'appelant, lue depuis une requête entrante.
 *
 * Vit ici et non dans le fichier de route : c'est une **décision de sécurité** — quel en-tête fait
 * foi — et le fichier de route est exclu de la mesure de couverture. Une règle non couverte dans un
 * fichier qu'on a déclaré sans règles est exactement le genre d'angle mort qu'on ne retrouve pas.
 */
export function readClientIpFromRequest(
  request: { headers: { get(name: string): string | null } },
  env: NodeJS.ProcessEnv,
  remoteAddress?: string | null,
): string {
  return readClientIp(
    { forwardedFor: request.headers.get('x-forwarded-for'), remoteAddress },
    readTrustedProxyCount(env),
  )
}

export function readTrustedProxyCount(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.AUTH_TRUSTED_PROXIES)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * L'adresse à retenir pour le comptage.
 *
 * Avec `trustedProxies = n`, on remonte de `n` maillons depuis la droite de `x-forwarded-for` :
 * c'est l'adresse que le proxy le plus externe de **notre** infrastructure a constatée. Au-delà de
 * ce que la chaîne contient, on retombe sur l'adresse de connexion plutôt que d'accepter une valeur
 * choisie par l'appelant.
 */
export function readClientIp(sources: ClientIpSources, trustedProxies: number): string {
  const remote = sources.remoteAddress?.trim()

  if (trustedProxies <= 0) return remote || UNKNOWN_CLIENT_IP

  const chain = (sources.forwardedFor ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  // `n` proxies de confiance ajoutent `n` maillons ; celui qui nous intéresse est juste avant eux.
  // Une chaîne trop courte signifie que la requête n'a pas traversé le chemin attendu : on ne
  // devine pas, on retombe sur l'adresse de connexion.
  const index = chain.length - trustedProxies
  const candidate = index >= 0 ? chain[index] : undefined

  // `||` et non `??` : une chaîne vide n'est pas une adresse, et `??` la laisserait passer telle
  // quelle jusqu'au compteur.
  return candidate || remote || UNKNOWN_CLIENT_IP
}

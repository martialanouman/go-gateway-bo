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
 * ## « Non déclarée » et « zéro » ne veulent pas dire la même chose
 *
 * `AUTH_TRUSTED_PROXIES=0` est une **affirmation** : aucun proxy ne s'intercale, l'adresse du socket
 * est celle du client, comptez-la. Son absence n'affirme rien — et dans la topologie que la spec
 * impose, ≥2 instances derrière un load balancer, l'adresse du socket est celle du **répartiteur**,
 * identique pour tous les opérateurs. La compter verrouillerait la console entière au vingtième
 * échec de n'importe qui : l'anti-brute-force retourné en interrupteur général.
 *
 * Le défaut est donc « **ne pas compter par adresse** ». Le compteur par identifiant, lui, continue
 * de protéger chaque compte — c'est celui qui empêche de casser un mot de passe. Ce qu'on perd tant
 * que la variable n'est pas posée, c'est la détection du balayage ; ce qu'on évite, c'est de rendre
 * la console indisponible à un coût dérisoire.
 *
 * ## L'adresse de connexion vient du socket
 *
 * `remoteAddress` est renseignée par `getRequestIP(event)` de H3, qui lit le socket — vérifié : un
 * `x-forwarded-for` forgé ne la modifie pas. C'est ce qui rend `AUTH_TRUSTED_PROXIES=0` sûr là où
 * c'est vrai, et c'est aussi pourquoi la valeur ne se devine pas.
 *
 * Note à garder : `getRequestIP(event, { xForwardedFor: true })` existe, et prend la valeur **la plus
 * à gauche** de la chaîne — exactement le piège décrit plus haut. On ne l'utilise donc pas ;
 * l'en-tête est lu brut et interprété ici.
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
 * Le nombre de proxies de confiance, ou `undefined` si personne ne l'a déclaré.
 *
 * **La distinction entre « absente » et « zéro » porte tout le poids de ce module.** `0` signifie
 * « je certifie qu'aucun proxy ne s'intercale » : l'adresse du socket est alors celle du client, et
 * elle est comptée. L'absence signifie « personne n'a réfléchi à la topologie » — et dans la nôtre,
 * ≥2 instances derrière un load balancer, l'adresse du socket est celle du **load balancer**,
 * identique pour tous les opérateurs. La compter reviendrait à verrouiller la console entière au
 * vingtième échec de n'importe qui.
 *
 * Le défaut doit donc être « ne pas compter par adresse », jamais « compter n'importe quoi ».
 */
export function readTrustedProxyCount(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.AUTH_TRUSTED_PROXIES
  if (raw === undefined || raw.trim() === '') return undefined

  const parsed = Number(raw)
  // Une valeur illisible n'est pas une déclaration : elle retombe dans le cas « non déclarée »,
  // plutôt que d'être interprétée comme un zéro qui, lui, engage.
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * L'adresse à retenir pour le comptage.
 *
 * Avec `trustedProxies = n`, on remonte de `n` maillons depuis la droite de `x-forwarded-for` :
 * c'est l'adresse que le proxy le plus externe de **notre** infrastructure a constatée. Au-delà de
 * ce que la chaîne contient, on retombe sur l'adresse de connexion plutôt que d'accepter une valeur
 * choisie par l'appelant.
 */
export function readClientIp(sources: ClientIpSources, trustedProxies: number | undefined): string {
  const remote = sources.remoteAddress?.trim()

  // Topologie non déclarée : on ne compte pas. Derrière un load balancer — la topologie imposée par
  // la spec — l'adresse du socket est celle du répartiteur, la même pour tout le monde ; la compter
  // transformerait l'anti-brute-force en interrupteur général.
  if (trustedProxies === undefined) return UNKNOWN_CLIENT_IP

  if (trustedProxies === 0) return remote || UNKNOWN_CLIENT_IP

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

/**
 * Le mot de passe d'un compte qui vient d'être créé.
 *
 * ## Pourquoi il est tiré au sort, et pas saisi par l'administrateur
 *
 * Un mot de passe saisi par un tiers est un mot de passe choisi par un humain pressé : il ressemble
 * au nom du service, il se réutilise d'un compte à l'autre, et il transite par le canal qui aura
 * servi à le composer. Tiré ici, il est de l'entropie et rien d'autre.
 *
 * ## Montré une seule fois — c'est l'invariant (b), pas une commodité
 *
 * La valeur n'existe que le temps de la réponse à la création. Elle n'est ni stockée en clair, ni
 * journalisée, ni réaffichable : la base ne garde que le condensat scrypt, et aucune action
 * « révéler » n'existe nulle part dans le produit. Un administrateur qui la perd en fait tirer un
 * autre, il ne la retrouve pas.
 *
 * ## L'alphabet exclut ce qui se confond
 *
 * Ni `O`/`0`, ni `I`/`l`/`1`. Ce mot de passe se dicte au téléphone ou se recopie depuis un écran :
 * les caractères ambigus ne coûtent pas de la sécurité, ils coûtent des appels au support et, au
 * bout de trois essais, un contournement — « je vais te créer un compte avec un mot de passe
 * simple ».
 */

import { randomInt } from 'node:crypto'

/**
 * 32 symboles, tous distinguables à l'œil et à l'oral.
 *
 * Pas de symboles de ponctuation : ils ne sont pas les mêmes d'un clavier à l'autre — AZERTY, QWERTY,
 * clavier de téléphone — et une saisie impossible sur l'appareil qu'on a sous la main est un compte
 * inutilisable.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Vingt caractères, soit un peu moins de 100 bits. Très au-delà des douze exigés par la politique
 * (`password-policy.ts`) : ce mot de passe circule par un canal qu'on ne choisit pas toujours, et il
 * vit jusqu'à ce que son porteur le change — deux raisons de ne pas viser le minimum.
 */
const LENGTH = 20

export function generateTemporaryPassword(): string {
  // `randomInt` et non `Math.random()` : le second est prévisible à partir de quelques tirages, ce
  // qui donnerait les mots de passe des comptes créés ensuite.
  return Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

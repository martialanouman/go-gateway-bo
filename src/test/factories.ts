/**
 * Fabriques de données de test, **typées par le contrat**.
 *
 * Chaque fabrique rend un objet dont le type vient de `components['schemas']` du contrat publié. La
 * conséquence tient en une phrase : le jour où la passerelle renomme un champ ou en ajoute un
 * obligatoire, `pnpm typecheck` rougit ici, avant qu'un écran ne soit écrit contre une forme qui
 * n'existe plus. Une fabrique dont la forme est inventée à la main donnerait l'illusion inverse —
 * des tests verts sur un contrat périmé.
 *
 * Les valeurs par défaut sont **réalistes** : un identifiant qui ressemble à un identifiant, un
 * MSISDN ivoirien plausible, un nom de client qu'on pourrait lire dans le produit. Les jeux de
 * données lorem-ipsum masquent les problèmes de mise en page que le vrai contenu révèle.
 */

import type { components } from '@martialanouman/gateway-api-contracts/admin'

type Schemas = components['schemas']

/**
 * Compteur déterministe. Les tests ne tirent jamais au hasard : deux exécutions doivent produire
 * exactement les mêmes données, sinon un échec n'est pas reproductible et la suite devient un
 * générateur de mystères.
 */
let sequence = 0

/** À appeler entre deux fichiers de test qui compareraient des identifiants littéraux. */
export function resetFactories(): void {
  sequence = 0
}

function nextId(): number {
  sequence += 1
  return sequence
}

/** UUID déterministe et valide en forme, pour que les champs `format: uuid` restent crédibles. */
function uuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0')
  return `00000000-0000-7000-8000-${hex}`
}

export function aCustomer(overrides: Partial<Schemas['Customer']> = {}): Schemas['Customer'] {
  const id = nextId()

  return {
    id: uuid(id),
    name: `Client ${id}`,
    status: 'active',
    billing_enabled: true,
    billing_mode: 'prepaid',
    balance_scope: 'customer',
    // `off` par défaut, et pas un stockage : un client de test qui conserverait des corps de
    // message ferait entrer, par simple commodité, la donnée la plus sensible du produit dans des
    // jeux de données que personne ne relit (invariant a).
    content_storage: 'off',
    created_at: '2026-07-28T08:00:00Z',
    updated_at: '2026-07-28T08:00:00Z',
    ...overrides,
  }
}

export function aCustomerPage(
  customers: Schemas['Customer'][] = [aCustomer()],
  overrides: Partial<Schemas['CustomerPage']> = {},
): Schemas['CustomerPage'] {
  return {
    data: customers,
    has_more: false,
    next_cursor: null,
    ...overrides,
  }
}

/**
 * L'enveloppe d'erreur plate du contrat. Utile pour vérifier qu'un écran rend l'état « erreur »
 * décrit par la charte — réalité HTTP, données locales conservées, bouton Réessayer — plutôt qu'un
 * écran vide.
 */
export function anError(overrides: Partial<Schemas['Error']> = {}): Schemas['Error'] {
  return {
    code: 'forbidden_scope',
    message: 'The machine token lacks the required scope.',
    ...overrides,
  }
}

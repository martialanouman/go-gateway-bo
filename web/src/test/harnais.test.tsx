/**
 * Le harnais de composant, prouvé.
 *
 * Aucun composant du produit n'existe encore — ils arrivent en step-041 — mais le harnais qui les
 * montera, lui, est livré maintenant. Un outillage non exercé est un outillage qu'on découvre cassé
 * le jour où on en a besoin, au milieu d'autre chose.
 *
 * Le composant ci-dessous est donc volontairement minimal et **local au test** : il ne préfigure
 * aucun écran, il exerce les trois choses que le harnais promet — le client TanStack Query, une
 * interaction `user-event`, et une fabrique typée par le contrat.
 */

import { useQuery } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { aCustomer, aCustomerPage, resetFactories } from './factories'
import { renderComponent } from './render'

function ListeDeClients({ charger }: { charger: () => Promise<ReturnType<typeof aCustomerPage>> }) {
  const [actif, setActif] = useState(false)
  const { data, isPending } = useQuery({
    queryKey: ['clients'],
    queryFn: charger,
    enabled: actif,
  })

  if (!actif) {
    return (
      <button type="button" onClick={() => setActif(true)}>
        Charger les clients
      </button>
    )
  }

  // Les cinq états de contenu de la charte se construisent ici en M2 ; ce test n'en exerce que
  // deux, le temps de prouver que le harnais rend l'attente puis le résultat.
  if (isPending) return <p>Chargement…</p>

  return (
    <ul>
      {data?.data.map((client) => (
        <li key={client.id}>{client.name}</li>
      ))}
    </ul>
  )
}

describe('harnais de composant', () => {
  it('monte un composant avec son client de requêtes et suit une interaction', async () => {
    resetFactories()
    const page = aCustomerPage([
      aCustomer({ name: 'ACME Télécom' }),
      aCustomer({ name: 'Orange CI' }),
    ])

    const { user } = renderComponent(<ListeDeClients charger={async () => page} />)

    // `user-event` reproduit une vraie interaction — pointeur, focus, événements dans l'ordre —
    // là où `fireEvent` déclencherait un événement que personne ne produit en pratique.
    await user.click(screen.getByRole('button', { name: 'Charger les clients' }))

    expect(await screen.findByText('ACME Télécom')).toBeInTheDocument()
    expect(screen.getByText('Orange CI')).toBeInTheDocument()
  })

  it('donne à chaque test son propre cache', () => {
    // Deux rendus successifs ne doivent rien partager : un cache commun rendrait les tests
    // dépendants de leur ordre d'exécution, ce qui est la façon la plus sûre d'obtenir une suite
    // qui échoue une fois sur dix sans qu'on sache pourquoi.
    const premier = renderComponent(<p>a</p>)
    const second = renderComponent(<p>b</p>)

    expect(premier.queryClient).not.toBe(second.queryClient)
  })
})

describe('fabriques', () => {
  it('produisent des données déterministes', () => {
    // Deux exécutions doivent donner exactement la même chose : sans cela, un échec n'est pas
    // reproductible et la suite devient un générateur de mystères.
    resetFactories()
    const premier = aCustomer()
    resetFactories()
    const second = aCustomer()

    expect(premier).toEqual(second)
  })

  it('acceptent une surcharge sans perdre la forme du contrat', () => {
    const client = aCustomer({ status: 'suspended', name: 'Client suspendu' })

    expect(client.status).toBe('suspended')
    expect(client.name).toBe('Client suspendu')
    // Le reste vient du contrat, pas de la surcharge.
    expect(client.balance_scope).toBe('customer')
  })
})

/**
 * `/connexion` — email et mot de passe, première moitié de l'entrée.
 *
 * ## Le refus vient du serveur, entier
 *
 * L'écran ne rédige aucun message d'échec. Celui du serveur ne dit pas si le compte existe, et c'est
 * délibéré : distinguer « email inconnu » de « mot de passe incorrect » offrirait un annuaire
 * d'opérateurs à qui sonde la console. Le seul enrichissement est l'échéance de verrouillage, que
 * `api.ts` raccroche depuis l'en-tête `retry-after`.
 *
 * ## Le mot de passe ne sort pas de son champ
 *
 * Ni dans l'URL — le formulaire ne navigue pas — ni dans un message, ni dans le cache Query. Il vit
 * dans un état local, part dans un corps JSON, et disparaît avec le composant.
 */

import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { login } from '~/components/auth/api'
import { operatorQueryOptions } from '~/components/permission'
import { Button, TextField } from '~/components/primitives'

export const Route = createFileRoute('/connexion/')({
  component: LoginScreen,
})

function LoginScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Un filet, pas le mécanisme — et il vaut mieux le dire. Ce qui désarme réellement la seconde
    // soumission est le `loading` du bouton : il neutralise le clic, et la soumission implicite au
    // clavier passe par ce même bouton. Aucun test ne rougit si cette ligne disparaît, ce qui a été
    // vérifié plutôt que supposé. Elle reste parce que le jour où quelqu'un remplacera ce bouton par
    // un `<button>` nu, elle sera la seule chose entre un double clic et deux sessions ouvertes.
    if (pending) return

    setPending(true)
    setFailure(undefined)

    const result = await login({ identifier, password })
    setPending(false)

    if (result.outcome === 'mfa_required') {
      // **La session est relue, et attendue, avant de partir.** La garde de la coquille vient
      // d'écrire `null` sur cette clé — c'est ce qui a renvoyé l'opérateur ici — et l'écran de
      // vérification lit la même : sans relecture, il se croit sans session et repart aussitôt au
      // login. Une boucle que seul un parcours complet fait apparaître.
      //
      // `fetchQuery` et non `invalidateQueries` : invalider ne fait que **marquer périmé**, et ne
      // relance rien tant qu'aucun composant monté n'observe la clé — ce qui n'est le cas d'aucun
      // ici. L'écran suivant aurait alors lu le `null` périmé avant que la reprise n'aboutisse, et
      // aurait redirigé sur cette lecture-là. Vérifié : l'invalidation seule laissait le test rouge.
      // `staleTime: 0` **explicite**, et ce n'est pas une redondance : le client de production tient
      // la réponse pour fraîche pendant trente secondes, si bien que `fetchQuery` rendrait le `null`
      // que la garde vient d'écrire sans jamais interroger le serveur. Le harnais de test, lui, a un
      // `staleTime` de zéro — le test passait donc pour une raison qui n'existe pas dans le produit,
      // et c'est le parcours de bout en bout qui a fait la différence.
      await queryClient
        .fetchQuery({ ...operatorQueryOptions(), staleTime: 0 })
        .catch(() => undefined)
      await navigate({ to: '/connexion/verification' })
      return
    }

    setFailure(result.message)
  }

  return (
    <form className="ui-auth__form" noValidate onSubmit={submit}>
      <header className="ui-auth__heading">
        <h1>Connexion opérateur</h1>
        <p>Tableau de bord d’exploitation de la passerelle SMS.</p>
      </header>

      {/*
        `role="alert"` et non un simple paragraphe : le lecteur d'écran interrompt et lit le refus.
        Sans lui, l'opérateur ne saurait qu'il a échoué qu'en revenant lui-même sur le formulaire.
      */}
      {failure ? (
        <p className="ui-auth__failure" role="alert">
          {failure}
        </p>
      ) : null}

      <TextField
        autoComplete="username"
        label="Adresse e-mail"
        name="identifier"
        onChange={(event) => setIdentifier(event.target.value)}
        required
        type="email"
        value={identifier}
      />

      <TextField
        autoComplete="current-password"
        hint="Verrouillage temporaire après plusieurs tentatives."
        label="Mot de passe"
        name="password"
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />

      <Button loading={pending} type="submit" variant="primary">
        {pending ? 'Connexion en cours' : 'Continuer'}
      </Button>
    </form>
  )
}

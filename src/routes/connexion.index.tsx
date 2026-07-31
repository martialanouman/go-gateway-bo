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

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { login } from '~/components/auth/api'
import { Button, TextField } from '~/components/primitives'

export const Route = createFileRoute('/connexion/')({
  component: LoginScreen,
})

function LoginScreen() {
  const navigate = useNavigate()
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

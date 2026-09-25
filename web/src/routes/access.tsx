import { useMutation } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AuthLayout, AuthRefusal } from '~/components/auth-layout'
import { Button, Field, Input } from '~/components/ui'
import { api, refusalMessage } from '~/lib/api'
import { formResolver } from '~/lib/form'
import { missingFromPassword } from '~/lib/password'
import { forgetAccessToken, peekAccessToken, rememberAccessToken } from '~/lib/session'

const TITLE = 'Définir un mot de passe'

/**
 * Le refus unique d'un jeton d'accès — absent, servi, expiré ou remplacé. Le serveur rédige le même
 * message pour les quatre causes (`internal/bff/access.go`) ; celui-ci n'en distingue aucune non
 * plus, avant tout envoi.
 */
const LINK_REFUSAL = "Ce lien n'est plus valable : demandez-en un nouveau à un administrateur."

/**
 * L'écran public de définition du mot de passe — le seul du produit qu'un opérateur ouvre sans
 * session, jeton en poche.
 *
 * Le jeton arrive dans le fragment (`#JETON`), que le navigateur ne transmet jamais au serveur.
 * `beforeLoad` le retient en mémoire du document puis efface le fragment **avant tout rendu**,
 * comme le challenge du second facteur : un fragment qui survivrait au premier rendu finirait dans
 * l'historique, un `Referer`, ou un export — invariant (a).
 */
export const Route = createFileRoute('/access')({
  beforeLoad: ({ location }) => {
    if (location.hash !== '') {
      rememberAccessToken(location.hash)
      throw redirect({ to: '/access', replace: true })
    }
  },

  component: AccessScreen,
})

function AccessScreen() {
  const token = peekAccessToken()

  if (token === undefined) {
    return (
      <AuthLayout title={TITLE}>
        <AuthRefusal>{LINK_REFUSAL}</AuthRefusal>
      </AuthLayout>
    )
  }

  return <AccessForm token={token} />
}

/**
 * La saisie s'oppose à ses propres règles avant celles du contrat : `missingFromPassword` d'abord,
 * l'égalité des deux saisies ensuite — l'ordre que la fiche fixe.
 */
const passwordForm = z
  .object({ password: z.string(), confirmation: z.string() })
  .superRefine((value, ctx) => {
    const missing = missingFromPassword(value.password)
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `Il manque : ${missing.join(', ')}.`,
        path: ['password'],
      })
    }

    if (value.password !== value.confirmation) {
      ctx.addIssue({
        code: 'custom',
        message: 'Les deux saisies diffèrent.',
        path: ['confirmation'],
      })
    }
  })

function AccessForm({ token }: { readonly token: string }) {
  const navigate = Route.useNavigate()
  // Un jeton mort ne se réessaie pas : le 410 retire le formulaire, comme l'absence de jeton.
  const [deadLink, setDeadLink] = useState<string | undefined>(undefined)

  const form = useForm({
    resolver: formResolver(passwordForm),
    defaultValues: { password: '', confirmation: '' },
  })

  const setPassword = useMutation({
    // Les variables de la mutation portent le jeton et le mot de passe en clair : sans `gcTime: 0`,
    // TanStack Query les garde cinq minutes dans le cache après le départ de l'écran (invariant b),
    // comme la création d'un opérateur (`_shell.operators.tsx`).
    gcTime: 0,
    mutationFn: async ({ password }: z.output<typeof passwordForm>) => {
      // Pas de `data` à lire : le succès rend 204 sans corps (`setPasswordFromAccessLink`).
      const { error, response } = await api.POST('/auth/access-link', {
        body: { token, password },
      })
      if (!response.ok) {
        const message = refusalOf(error, response.status)
        if (response.status === 410) setDeadLink(message)
        throw new Error(message)
      }
    },
    onSuccess: () => {
      forgetAccessToken()
      void navigate({ to: '/login', search: { passwordSet: true, redirect: undefined } })
    },
  })

  if (deadLink !== undefined) {
    return (
      <AuthLayout title={TITLE}>
        <AuthRefusal>{deadLink}</AuthRefusal>
      </AuthLayout>
    )
  }

  // Comme `login.tsx` : le refus du serveur porte sur une saisie qui vient de changer, et un
  // message qui lui survit fait douter de tous les autres.
  const forgetRefusal = { onChange: () => setPassword.reset() }
  const { errors } = form.formState

  return (
    <AuthLayout title={TITLE}>
      {setPassword.error === null ? null : <AuthRefusal>{setPassword.error.message}</AuthRefusal>}

      <form
        className="auth__form"
        noValidate
        onSubmit={form.handleSubmit((values) => setPassword.mutate(values))}
      >
        <Field
          error={errors.password?.message}
          hint="Douze caractères au moins, avec une majuscule, une minuscule, un chiffre et un caractère spécial."
          label="Mot de passe"
        >
          <Input
            autoComplete="new-password"
            autoFocus
            required
            type="password"
            {...form.register('password', forgetRefusal)}
          />
        </Field>

        <Field error={errors.confirmation?.message} label="Confirmer le mot de passe">
          <Input
            autoComplete="new-password"
            required
            type="password"
            {...form.register('confirmation', forgetRefusal)}
          />
        </Field>

        <Button loading={setPassword.isPending} type="submit" variant="primary">
          Enregistrer
        </Button>
      </form>
    </AuthLayout>
  )
}

function refusalOf(error: unknown, status: number) {
  return refusalMessage(
    error,
    `L’enregistrement n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}).`,
  )
}

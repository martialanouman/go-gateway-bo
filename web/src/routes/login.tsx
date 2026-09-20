import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { AuthLayout, AuthPending, AuthRefusal } from '~/components/auth-layout'
import { Button, Field, Input } from '~/components/ui'
import { api } from '~/lib/api'
import { forgetSession, readSession, rememberChallenge, safeDestination } from '~/lib/session'

/**
 * Le premier facteur — **hors de la coquille** : un opérateur non connecté n'a ni rail ni barre
 * supérieure, puisqu'aucune de leurs entrées ne mènerait ailleurs qu'à un refus.
 *
 * La route est sœur de `_shell` et non son enfant, comme `/_design` : la garde de session vit sur la
 * coquille, donc ce qui doit rester atteignable sans session n'a rien à s'exempter.
 */
export const Route = createFileRoute('/login')({
  // Le paramètre est réduit avant d'atteindre le moindre composant : ce qui en sort est une adresse
  // de ce tableau de bord, ou rien.
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeDestination(search.redirect),
  }),

  beforeLoad: async ({ context, search }) => {
    const session = await readSession(context.queryClient)

    // Une session déjà élevée n'a rien à faire ici : la laisser sur le formulaire ferait d'un retour
    // en arrière un cul-de-sac. Une session **non élevée**, en revanche, reste servie — se
    // reconnecter est la seule remédiation d'un cookie qu'on croit compromis
    // (`closePresentedSession`, `internal/bff/auth.go`).
    if (session.kind === 'open' && session.me.elevated) {
      throw redirect({ href: search.redirect ?? '/' })
    }
  },

  pendingComponent: () => <AuthPending title="Connexion au tableau de bord" />,

  component: LoginScreen,
})

/** Ce qui manque dans le formulaire, champ par champ. Vide, il n'y a rien à dire. */
type MissingFields = { email?: string; password?: string }

function LoginScreen() {
  const { redirect: destination } = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [missing, setMissing] = useState<MissingFields>({})

  const login = useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/auth/login', {
        body: { email, password },
      })
      if (data === undefined) throw new Error(refusalOf(error, response.status))

      return data
    },
    onSuccess: ({ challenge }) => {
      // Le challenge ne traverse ni l'URL ni le stockage : il passe par la mémoire du document, que
      // le second facteur relit à l'écran suivant.
      rememberChallenge(challenge)
      // La session vient de changer : sans cet oubli, la garde du second facteur relirait le 401
      // mis en cache avant la connexion et renverrait ici même.
      forgetSession(queryClient)
      void navigate({ to: '/mfa', search: { redirect: destination } })
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()

    // Les deux champs sont relus d'un coup : signaler le premier puis le second ferait deux
    // aller-retours là où l'opérateur peut tout corriger en une fois.
    const incomplete: MissingFields = {
      ...(email.trim() === ''
        ? { email: 'Cette adresse est requise pour ouvrir une session.' }
        : {}),
      ...(password === ''
        ? { password: 'Ce mot de passe est requis pour ouvrir une session.' }
        : {}),
    }
    setMissing(incomplete)

    if (Object.keys(incomplete).length > 0) return

    login.mutate()
  }

  return (
    <AuthLayout
      intro="Le tableau de bord ne montre aucun écran sans session : l’adresse et le mot de passe ouvrent le premier facteur, puis un second est demandé."
      title="Connexion au tableau de bord"
    >
      {login.error === null ? null : <AuthRefusal>{login.error.message}</AuthRefusal>}

      {/* `noValidate` : la validation native rendrait ses propres messages, dans la langue du
          navigateur et hors de la charte. `required` reste posé — il porte la sémantique pour les
          technologies d'assistance, et la marque visuelle en découle. */}
      <form className="auth__form" noValidate onSubmit={onSubmit}>
        <Field error={missing.email} label="Adresse professionnelle">
          <Input
            autoComplete="username"
            autoFocus
            name="email"
            onChange={(event) => {
              setEmail(event.target.value)
              // Le refus s'efface dès la correction : un message qui survit à ce qu'il reproche
              // fait douter de tous les autres.
              setMissing((previous) => ({ ...previous, email: undefined }))
            }}
            required
            type="email"
            value={email}
          />
        </Field>

        <Field error={missing.password} label="Mot de passe">
          <Input
            autoComplete="current-password"
            name="password"
            onChange={(event) => {
              setPassword(event.target.value)
              setMissing((previous) => ({ ...previous, password: undefined }))
            }}
            required
            type="password"
            value={password}
          />
        </Field>

        <Button loading={login.isPending} type="submit" variant="primary">
          Se connecter
        </Button>
      </form>
    </AuthLayout>
  )
}

/**
 * Le message rendu à l'opérateur, pris **du serveur** plutôt que réécrit ici.
 *
 * Le BFF rédige déjà ses refus en français, conséquence d'abord, et c'est lui qui sait ce qu'il a
 * refusé : le 401 ne distingue pas l'adresse inconnue du mot de passe faux, et le 429 porte la durée
 * restante. Les recopier ici en ferait deux rédactions dont une périmerait — et l'écran serait alors
 * le miroir bavard d'une garde qui, elle, se tait.
 *
 * Le repli ne sert que ce que le serveur n'a pas rédigé : une coupure réseau, où aucun corps n'est
 * revenu.
 */
function refusalOf(error: unknown, status: number) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown }
    if (typeof message === 'string' && message !== '') return message
  }

  return `La connexion n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}). Réessayez ; si le refus persiste, la passerelle est peut-être en cours de redémarrage.`
}

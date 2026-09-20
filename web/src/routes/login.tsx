import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AuthLayout, AuthPending, AuthRefusal } from '~/components/auth-layout'
import { Button, Field, Input } from '~/components/ui'
import { api, refusalMessage } from '~/lib/api'
import { LoginRequest } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
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

  pendingComponent: () => <AuthPending title="Connexion" />,

  component: LoginScreen,
})

/**
 * Ce que le formulaire oppose à la saisie : ses propres règles **puis** celles du contrat.
 *
 * `.pipe` et non deux contrôles côte à côte, et l'ordre est ce qui compte. Un champ vide échouerait
 * aussi sur le `minLength: 1` que le contrat pose sur le mot de passe, et c'est alors le message
 * générique de `refusalInFrench` — « Cette saisie est trop courte : 1 caractère au minimum. » — que
 * l'opérateur lirait, au lieu de celui qui nomme le champ. Le schéma engendré ne s'exécute donc
 * qu'une fois les règles de l'écran satisfaites : chacun rédige ce qu'il sait, et aucune borne n'est
 * retapée ici.
 *
 * **Le motif d'adresse est volontairement lâche** — un `@`, quelque chose de part et d'autre, un
 * point dans le domaine — et il **ne rouvre pas l'oracle d'énumération** : le format ne dit rien de
 * l'existence d'un compte, `absent@nulle.part` le passe. Ce qu'il évite est un aller-retour qui
 * coûte un argon2id et revient en 401 générique, où l'opérateur soupçonne son mot de passe.
 */
const credentials = z.object({
  email: z
    .string()
    // Pas de `.trim()` : la « value sanitization » que la spécification HTML impose à
    // `type="email"` retire déjà les espaces qui entourent la valeur. Mesuré, en jsdom comme au
    // navigateur — c'est donc le `type` du champ qui tient l'adresse postée, et le passer à `text`
    // fait rougir.
    .min(1, 'Saisissez un e-mail.')
    // L'exemple enseigne mieux que la règle : il montre la forme au lieu de la décrire.
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Cet e-mail est incomplet. Exemple : ops@exemple.ci')
    .pipe(LoginRequest.shape.email),
  password: z.string().min(1, 'Saisissez un mot de passe.').pipe(LoginRequest.shape.password),
})

/**
 * **Les refus de champ viennent d'ici et non du serveur**, contrairement à ce que la fiche de
 * step-027 annonçait (« les erreurs champ par champ depuis `errors[]` »). Vérifié dans le contrat
 * plutôt que supposé : le schéma `Error` d'`api/openapi-bff.yaml` n'a que `code` et `message`, et il
 * écrit lui-même que « le champ `errors[]` que le §1.4 annonce arrive avec la première route qui
 * relaie la passerelle (step-060) ».
 *
 * L'écart est sans conséquence ici, et c'est la seconde raison de ne pas l'attendre : les refus que
 * cette route rend à un formulaire **rempli** — 401 et 429 — sont globaux par conception. (Elle en
 * déclare six en tout ; les quatre autres — 400, 403, 415, 503 — ne nomment pas davantage un champ.)
 * Le serveur se tait sur lequel des deux champs a manqué, puisque le dire nommerait les adresses qui
 * existent.
 */
function LoginScreen() {
  const { redirect: destination } = Route.useSearch()
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()

  // Les défauts de React Hook Form sont ceux qu'on veut, et c'est pourquoi aucun n'est écrit :
  // valider à l'envoi, puis **revalider à la frappe** une fois le refus affiché. Valider dès la
  // première frappe reprocherait une adresse incomplète à qui est en train de la taper.
  const form = useForm({
    resolver: formResolver(credentials),
    defaultValues: { email: '', password: '' },
  })

  const login = useMutation({
    mutationFn: async ({ email, password }: z.output<typeof credentials>) => {
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

  // Le refus du serveur s'efface dès la frappe : un message qui survit à ce qu'il reproche fait
  // douter de tous les autres, et celui-ci refusait des identifiants qui ne sont plus ceux-là. Le
  // refus de champ, lui, est effacé par React Hook Form, qui revalide.
  //
  // **C'est le seul endroit qui l'efface, et il suffit** : un bandeau n'existe qu'après un envoi que
  // la validation a laissé passer, donc avec deux champs remplis, et le vider demande une frappe.
  const forgetRefusal = { onChange: () => login.reset() }
  const { errors } = form.formState

  return (
    <AuthLayout title="Connexion">
      {login.error === null ? null : <AuthRefusal>{login.error.message}</AuthRefusal>}

      {/* `noValidate` : la validation native rendrait ses propres messages, dans la langue du
          navigateur et hors de la charte. `required` reste posé — il porte la sémantique pour les
          technologies d'assistance, et la marque visuelle en découle. */}
      <form
        className="auth__form"
        noValidate
        onSubmit={form.handleSubmit((values) => login.mutate(values))}
      >
        <Field error={errors.email?.message} label="E-mail">
          <Input
            autoComplete="username"
            autoFocus
            required
            type="email"
            {...form.register('email', forgetRefusal)}
          />
        </Field>

        <Field error={errors.password?.message} label="Mot de passe">
          <Input
            autoComplete="current-password"
            required
            type="password"
            {...form.register('password', forgetRefusal)}
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
  return refusalMessage(
    error,
    `La connexion n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}). Réessayez ; si le refus persiste, la passerelle est peut-être en cours de redémarrage.`,
  )
}

import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { type FormEvent, useId, useState } from 'react'
import { AuthLayout, AuthPending, AuthRefusal } from '~/components/auth-layout'
import { Button, Field, Input } from '~/components/ui'
import { api, HttpError, meQueryOptions } from '~/lib/api'
import {
  forgetChallenge,
  forgetSession,
  peekChallenge,
  readSession,
  safeDestination,
} from '~/lib/session'

/**
 * Le second facteur — hors de la coquille pour la même raison que la connexion : la session existe,
 * mais elle n'ouvre encore rien.
 */
export const Route = createFileRoute('/mfa')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeDestination(search.redirect),
  }),

  beforeLoad: async ({ context, search }) => {
    const session = await readSession(context.queryClient)

    if (session.kind === 'none') {
      throw redirect({ to: '/login', search: { redirect: search.redirect } })
    }

    if (session.kind === 'open' && session.me.elevated) {
      throw redirect({ href: search.redirect ?? '/' })
    }

    // Sans challenge, `POST /auth/mfa/verify` refuserait chaque envoi : le formulaire serait un
    // cul-de-sac qui ne dit pas pourquoi. Le cas n'est pas théorique — c'est ce que produit un
    // rechargement de cet écran, puisque le challenge ne vit qu'en mémoire.
    if (session.kind === 'open' && peekChallenge() === undefined) {
      throw redirect({ to: '/login', search: { redirect: search.redirect } })
    }
  },

  pendingComponent: () => <AuthPending title="Second facteur" />,
  component: SecondFactorScreen,
})

/**
 * L'indice que `step-035` a retiré du serveur.
 *
 * `invalid_second_factor` sert les trois méthodes — TOTP, code de récupération, clé d'accès — et
 * disait « vérifier l'heure de l'application d'authentification » à qui venait de présenter une
 * clé. Le serveur ne le dit donc plus. **Cet écran-ci sait quelle méthode il présente**, et c'est
 * ce qui lui permet de le dire sans mentir : sans cette reprise, un opérateur dont le téléphone a
 * dérivé n'a plus aucune piste.
 */
const CLOCK_HINT =
  'Si le code est refusé plusieurs fois de suite, vérifiez l’heure de l’application d’authentification : le serveur tolère environ une minute d’écart, et refuse les codes au-delà.'

function SecondFactorScreen() {
  const { redirect: destination } = Route.useSearch()
  const me = useQuery(meQueryOptions)

  // **Pas de lecture optionnelle ici, et c'est tout le correctif.** La garde laisse passer une
  // session que le BFF n'a pas su rendre — `kind: 'unknown'` — parce qu'une panne dégrade sans
  // déconnecter, invariant (e). Lus à travers un `?.`, les facteurs d'une telle session valaient
  // « aucun », et l'écran annonçait à un opérateur parfaitement enrôlé qu'il n'avait rien : une
  // panne rendue comme un état **vide**, que le §1.9 sépare précisément d'un état d'erreur.
  //
  // Les deux causes se séparent donc avant d'être lues, et le produit n'affirme plus rien qu'il ne
  // sache.
  if (me.data === undefined) {
    return <SessionUnreadable error={me.error} onRetry={() => void me.refetch()} />
  }

  const { totp, passkeys } = me.data.secondFactors
  if (!totp && passkeys === 0) return <NoFactorEnrolled />

  return <FactorChallenge destination={destination} holdsPasskey={passkeys > 0} holdsTotp={totp} />
}

function FactorChallenge({
  destination,
  holdsTotp,
  holdsPasskey,
}: {
  readonly destination: string | undefined
  readonly holdsTotp: boolean
  readonly holdsPasskey: boolean
}) {
  // Les deux hooks sont lus ici plutôt que passés en props par le parent : `RestartLogin` le fait
  // déjà dans ce fichier, et un hook qui traverse une frontière de composant se redéclare dans sa
  // signature de type pour ne rien apporter.
  const router = useRouter()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [missing, setMissing] = useState<string | undefined>(undefined)
  const explanationId = useId()

  // `browserSupportsWebAuthn` plutôt qu'une sonde maison : la bibliothèque connaît les cas que
  // `window.PublicKeyCredential !== undefined` manque, et c'est elle qui conduira la cérémonie.
  const platformKnowsPasskeys = browserSupportsWebAuthn()

  function elevate() {
    // La session vient de changer d'état : sans cet oubli, la garde de la coquille relirait
    // `elevated: false` encore frais et renverrait ici même, en boucle.
    forgetSession(queryClient)
    forgetChallenge()
    void router.navigate({ href: destination ?? '/' })
  }

  const verify = useMutation({
    mutationFn: async (attempt: { method: 'totp'; code: string } | { method: 'webauthn' }) => {
      const challenge = peekChallenge()
      if (challenge === undefined) throw new Error(CHALLENGE_LOST)

      const body =
        attempt.method === 'totp'
          ? { challenge, method: 'totp' as const, code: attempt.code }
          : {
              challenge,
              method: 'webauthn' as const,
              // Le contrat déclare `assertion` comme un objet **libre** — sa forme appartient à la
              // spécification WebAuthn, et c'est la bibliothèque du serveur qui l'analyse. Le type
              // engendré est donc un sac de clés, que le type précis de `@simplewebauthn` ne
              // satisfait pas faute de signature d'index. Rien n'est lu ici : le transit est
              // littéral.
              assertion: (await assertPasskey()) as unknown as Record<string, unknown>,
            }

      const { error, response } = await api.POST('/auth/mfa/verify', { body })
      if (!response.ok) throw new Error(refusalOf(error, response.status, attempt.method))
    },
    onSuccess: elevate,
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()

    if (code.trim() === '') {
      setMissing('Ce code est requis pour franchir le second facteur.')

      return
    }

    verify.mutate({ method: 'totp', code })
  }

  return (
    <AuthLayout
      intro={
        holdsTotp
          ? 'La session est ouverte au premier facteur : le code de l’application d’authentification l’élève, et donne accès aux écrans.'
          : 'La session est ouverte au premier facteur : la clé d’accès l’élève, et donne accès aux écrans.'
      }
      title="Second facteur"
    >
      {verify.error === null ? null : <AuthRefusal>{verify.error.message}</AuthRefusal>}

      {holdsTotp ? (
        <form className="auth__form" noValidate onSubmit={onSubmit}>
          <Field error={missing} label="Code à six chiffres">
            <Input
              autoComplete="one-time-code"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              mono
              name="code"
              onChange={(event) => {
                setCode(event.target.value)
                setMissing(undefined)
                verify.reset()
              }}
              required
              value={code}
            />
          </Field>

          <Button loading={verify.isPending} type="submit" variant="primary">
            Vérifier
          </Button>
        </form>
      ) : null}

      {holdsPasskey ? (
        <>
          <Button
            {...(platformKnowsPasskeys
              ? { blocked: false as const }
              : { blocked: true as const, 'aria-describedby': explanationId })}
            loading={verify.isPending}
            onClick={() => verify.mutate({ method: 'webauthn' })}
            variant="secondary"
          >
            Utiliser une clé d’accès
          </Button>
          {platformKnowsPasskeys ? null : (
            <p className="auth__aside" id={explanationId}>
              Ce navigateur n’expose pas les clés d’accès : la cérémonie ne peut pas s’ouvrir ici.
              {holdsTotp
                ? ' Le code de l’application d’authentification reste disponible.'
                : ' Un navigateur à jour, sur un poste qui porte la clé, ouvre cette voie.'}
            </p>
          )}
        </>
      ) : null}

      <RestartLogin />
    </AuthLayout>
  )
}

/**
 * Ce que voit un opérateur quand le BFF n'a pas rendu sa session.
 *
 * L'état **erreur** et non l'état vide : le §1.9 les sépare parce qu'ils appellent des gestes
 * opposés — un module éteint ne reviendra pas, une panne se réessaie. Il dit la réalité HTTP, garde
 * « Réessayer » sous la main, et n'affirme rien des facteurs que ce compte détient.
 *
 * Ce n'est pas un `ErrorState` : celui-là promet « vos données locales restent affichées », et il
 * n'y a ici aucune donnée locale — l'écran n'a jamais rien ouvert.
 */
function SessionUnreadable({
  error,
  onRetry,
}: {
  readonly error: unknown
  readonly onRetry: () => void
}) {
  const status = error instanceof HttpError ? String(error.status) : 'réseau'

  return (
    <AuthLayout
      intro="Le tableau de bord n’a pas obtenu de réponse du serveur : il ne sait donc pas quels seconds facteurs ce compte détient, et n’en propose aucun plutôt que d’en supposer un."
      title="Impossible de vérifier la session"
    >
      <AuthRefusal>{`GET /api/auth/me · ${status}`}</AuthRefusal>
      <Button onClick={onRetry} variant="primary">
        Réessayer
      </Button>
      <RestartLogin />
    </AuthLayout>
  )
}

/**
 * Ce que voit un opérateur dont aucun second facteur n'est enrôlé.
 *
 * `POST /auth/login` rend un challenge **sans regarder** ce qui est enrôlé (`internal/auth`,
 * `OutcomeChallenged`) : c'est donc ici que le cas se découvre, et l'envoyer au challenge serait
 * l'envoyer à un refus certain — la boucle que la v1.0 a livrée. L'enrôlement arrive en step-028 ;
 * d'ici là, l'écran nomme son jalon et garde une sortie, jamais un cul-de-sac.
 */
function NoFactorEnrolled() {
  return (
    <AuthLayout
      intro="Ce compte n’a ni application d’authentification ni clé d’accès, et la session en reste au premier facteur : aucun écran ne s’ouvre tant que le second n’est pas franchi."
      title="L’enrôlement du second facteur n’est pas encore livré"
    >
      <p className="auth__aside">
        L’écran d’enrôlement arrive avec step-028, au jalon M1. D’ici là, un administrateur peut
        poser un second facteur sur ce compte.
      </p>
      <RestartLogin />
    </AuthLayout>
  )
}

/**
 * La sortie, présente sur **les deux** états de cet écran : un opérateur qui s'est trompé de compte,
 * ou dont le facteur est perdu, doit pouvoir repartir sans fermer l'onglet.
 *
 * Elle ferme la session côté serveur plutôt que de seulement naviguer : rester connecté au premier
 * facteur après avoir demandé à repartir laisserait un cookie vivant que personne ne croit ouvert.
 */
function RestartLogin() {
  const queryClient = useQueryClient()
  const navigate = Route.useNavigate()

  const restart = useMutation({
    mutationFn: async () => {
      await api.POST('/auth/logout')
    },
    onSettled: () => {
      // `onSettled` et non `onSuccess` : si la déconnexion échoue, rester bloqué ici serait le
      // cul-de-sac qu'on cherche justement à éviter. Le serveur rend le même 204 sans session.
      forgetChallenge()
      forgetSession(queryClient)
      void navigate({ to: '/login', search: { redirect: undefined } })
    },
  })

  return (
    <Button loading={restart.isPending} onClick={() => restart.mutate()} variant="link">
      Reprendre la connexion
    </Button>
  )
}

const CHALLENGE_LOST =
  'Cette vérification a expiré : ce que la connexion avait ouvert n’est plus en mémoire. Reprenez la connexion.'

/** Ce que `navigator.credentials.get()` produit, transmis **tel quel** au BFF. */
async function assertPasskey() {
  const { data, error, response } = await api.POST('/auth/mfa/webauthn/assert/begin')
  if (data === undefined) throw new Error(refusalOf(error, response.status, 'webauthn'))

  try {
    // Les options traversent **telles quelles**, du serveur au navigateur : le DTO du contrat les
    // déclare champ par champ, et `@simplewebauthn` les retype en son propre vocabulaire. Les deux
    // décrivent la même charge utile WebAuthn ; les réconcilier champ à champ en ferait deux
    // rédactions dont une périmerait au premier ajout de la spécification.
    return await startAuthentication({
      optionsJSON: data.publicKey as Parameters<typeof startAuthentication>[0]['optionsJSON'],
    })
  } catch {
    // La bibliothèque rédige **en anglais**, et sa phrase parlerait de `NotAllowedError` à un
    // opérateur. Le cas le plus courant n'est d'ailleurs pas une panne : c'est la fenêtre du
    // navigateur qu'on referme. La copie du produit dit la conséquence, en français, sans accuser.
    throw new Error(CEREMONY_ABANDONED)
  }
}

const CEREMONY_ABANDONED =
  'La clé d’accès n’a pas été présentée : la fenêtre du navigateur s’est refermée, ou l’appareil n’a pas répondu. Reprenez la vérification.'

/**
 * Le message rendu à l'opérateur, pris **du serveur**, augmenté de ce que le serveur ne peut pas
 * dire.
 *
 * Le BFF rédige ses refus en français et ne nomme pas laquelle des cinq causes s'applique — les
 * distinguer dirait à une machine où elle en est. Les recopier ici en ferait deux rédactions dont
 * une périmerait.
 *
 * L'indice d'horloge n'est ajouté **que** sur le chemin TOTP, et c'est tout l'objet de sa reprise :
 * ajouté partout, il redeviendrait ce que step-035 a retiré.
 */
function refusalOf(error: unknown, status: number, method: 'totp' | 'webauthn') {
  const fromServer = messageOf(error, status)

  // La **cause** autant que la méthode. Conditionné au seul chemin TOTP, l'indice se collait aussi
  // au verrouillage et à la panne — « réessayez dans cinq minutes » suivi de « vérifiez l'heure de
  // votre téléphone », qui n'y est pour rien. C'est l'autre moitié de ce que step-035 a retiré du
  // serveur : `invalid_second_factor` y servait des causes qu'il ne décrivait pas autant que des
  // méthodes qu'il ne décrivait pas.
  if (method !== 'totp' || codeOf(error) !== 'invalid_second_factor') return fromServer

  return `${fromServer} ${CLOCK_HINT}`
}

/** Le `code` du DTO `Error`, qui se grep dans les journaux et ne se traduit pas. */
function codeOf(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown }
    if (typeof code === 'string') return code
  }

  return undefined
}

function messageOf(error: unknown, status: number) {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown }
    if (typeof message === 'string' && message !== '') return message
  }

  return `La vérification n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}).`
}

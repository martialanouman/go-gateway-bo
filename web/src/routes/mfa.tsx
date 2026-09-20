import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { AuthLayout, AuthPending, AuthRefusal, RestartLogin } from '~/components/auth-layout'
import { Button, Field, Input } from '~/components/ui'
import { api, HttpError, meQueryOptions } from '~/lib/api'
import { formResolver } from '~/lib/form'
import { CHALLENGE_LOST, totpAttempt, verificationRefusal } from '~/lib/second-factor'
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

    // **Aucun facteur enrôlé : l'enrôlement, pas le challenge.** `POST /auth/login` rend un
    // challenge **sans regarder** ce qui est enrôlé (`internal/auth`, `OutcomeChallenged`) : le cas
    // se découvre donc ici, et présenter un formulaire dont chaque envoi serait refusé est la
    // boucle que la v1.0 a livrée.
    if (
      session.kind === 'open' &&
      !session.me.secondFactors.totp &&
      session.me.secondFactors.passkeys === 0
    ) {
      throw redirect({ to: '/enroll', search: { redirect: search.redirect } })
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
    return <SessionUnreadable error={me.error} />
  }

  const { totp, passkeys } = me.data.secondFactors

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
  const form = useForm({ resolver: formResolver(totpAttempt), defaultValues: { code: '' } })
  const explanationId = useId()

  // `browserSupportsWebAuthn` plutôt qu'une sonde maison — non qu'elle voie plus de cas : son corps
  // est `PublicKeyCredential !== undefined && typeof … === 'function'`, mesuré en 13.3.0. Ce qu'elle
  // apporte est d'être **la** sonde de la bibliothèque qui conduira la cérémonie. Même arbitrage
  // qu'en `enroll.tsx`, où il est écrit en entier.
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
      if (!response.ok) throw new Error(verificationRefusal(error, response.status, attempt.method))
    },
    onSuccess: elevate,
  })

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
        <form
          className="auth__form"
          noValidate
          onSubmit={form.handleSubmit(({ code }) => verify.mutate({ method: 'totp', code }))}
        >
          <Field error={form.formState.errors.code?.message} label="Code à six chiffres">
            <Input
              autoComplete="one-time-code"
              autoFocus
              inputMode="numeric"
              maxLength={6}
              mono
              required
              {...form.register('code', {
                // Le refus du serveur s'efface dès la frappe : il refusait un code qui n'est plus
                // celui-là. Le refus de champ, lui, est effacé par React Hook Form, qui revalide.
                onChange: () => verify.reset(),
              })}
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
function SessionUnreadable({ error }: { readonly error: unknown }) {
  // `router.invalidate()` et non `me.refetch()` : ce qu'il faut rejouer est la **garde**, pas la
  // seule requête. Une relecture réussie peut rendre un compte **sans aucun facteur**, et cet
  // écran se peignait alors sur un challenge que le serveur refuserait — `beforeLoad` ne se rejoue
  // pas de lui-même. La garde, elle, conduit à l'enrôlement. Même arbitrage que `shell.tsx`.
  const router = useRouter()
  const status = error instanceof HttpError ? String(error.status) : 'réseau'

  return (
    <AuthLayout
      intro="Le tableau de bord n’a pas obtenu de réponse du serveur : il ne sait donc pas quels seconds facteurs ce compte détient, et n’en propose aucun plutôt que d’en supposer un."
      title="Impossible de vérifier la session"
    >
      <AuthRefusal>{`GET /api/auth/me · ${status}`}</AuthRefusal>
      <Button onClick={() => void router.invalidate()} variant="primary">
        Réessayer
      </Button>
      <RestartLogin />
    </AuthLayout>
  )
}

/** Ce que `navigator.credentials.get()` produit, transmis **tel quel** au BFF. */
async function assertPasskey() {
  const { data, error, response } = await api.POST('/auth/mfa/webauthn/assert/begin')
  if (data === undefined) throw new Error(verificationRefusal(error, response.status, 'webauthn'))

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

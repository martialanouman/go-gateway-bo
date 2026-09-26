import { browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { AuthLayout, AuthPending, AuthRefusal, RestartLogin } from '~/components/auth-layout'
import { TotpEnrollment } from '~/components/totp-enrollment'
import { Button, Field, Input } from '~/components/ui'
import { api, refusalMessage } from '~/lib/api'
import { formResolver } from '~/lib/form'
import { passkeyNaming, registerPasskey } from '~/lib/passkey'
import { CHALLENGE_LOST, verificationRefusal } from '~/lib/second-factor'
import {
  forgetChallenge,
  forgetSession,
  peekChallenge,
  readSession,
  safeDestination,
} from '~/lib/session'

/**
 * L'enrôlement du second facteur — l'écran par lequel un compte nu devient un compte qui entre.
 *
 * Il est hors de la coquille pour la même raison que la connexion et le second facteur : la session
 * existe, mais elle n'ouvre encore rien. Et il existe avant l'écran de gestion des opérateurs parce
 * que **le premier administrateur n'a personne pour l'enrôler** — la v1.0 avait rendu le second
 * facteur obligatoire sans livrer aucun écran qui permette d'en poser un.
 *
 * **Il enrôle et il confirme, dans cet ordre, sur le même écran.** L'enrôlement écrit le secret
 * avant tout scan : entre les deux, le compte porte un facteur que personne ne détient. Le serveur
 * rend désormais cet état récupérable (`internal/bff/mfa.go`, `unconfirmed`), et l'écran, lui,
 * réduit la fenêtre à ce qu'elle doit être — le champ du premier code est sous le QR, et les dix
 * codes de récupération n'apparaissent qu'une fois le facteur prouvé. Les montrer avant, c'est les
 * faire enregistrer pour un authentificateur qui ne marchera peut-être jamais.
 *
 * L'enregistrement d'une clé d'accès, lui, conduit toujours à `/mfa` : une clé est utilisable dès
 * qu'elle est enregistrée, il n'y a aucun code à protéger, et la cérémonie d'assertion vit déjà
 * là-bas.
 */
export const Route = createFileRoute('/enroll')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeDestination(search.redirect),
  }),

  beforeLoad: async ({ context, search }) => {
    const session = await readSession(context.queryClient)

    if (session.kind === 'none') {
      throw redirect({ to: '/login', search: { redirect: search.redirect, passwordSet: false } })
    }

    // Une session illisible ne dit pas ce que ce compte détient, et proposer un enrôlement à un
    // opérateur parfaitement enrôlé rendrait une **panne** sous la forme d'un état **vide**, que le
    // §1.9 sépare. L'écran du second facteur porte déjà l'état d'erreur, avec sa réessai.
    if (session.kind === 'unknown') {
      throw redirect({ to: '/mfa', search: { redirect: search.redirect } })
    }

    if (session.me.elevated) {
      throw redirect({ href: search.redirect ?? '/' })
    }

    // Un facteur en place se présente, il ne se double pas : cet écran n'enrôle que le premier.
    // L'ajout et le remplacement vivent dans « Mon compte », derrière une session élevée.
    const { totp, passkeys } = session.me.secondFactors
    if (totp || passkeys > 0) {
      throw redirect({ to: '/mfa', search: { redirect: search.redirect } })
    }

    // Sans challenge, la vérification qui suit l'enrôlement serait refusée : l'écran poserait un
    // facteur, montrerait dix codes irrécupérables, puis déposerait l'opérateur devant un refus
    // certain. Le cas n'est pas théorique — c'est ce que produit un rechargement, puisque le
    // challenge ne vit qu'en mémoire du document.
    if (peekChallenge() === undefined) {
      throw redirect({ to: '/login', search: { redirect: search.redirect, passwordSet: false } })
    }
  },

  pendingComponent: () => <AuthPending title={TITLE} />,
  component: EnrollmentScreen,
})

const TITLE = 'Enrôler un second facteur'

function EnrollmentScreen() {
  const { redirect: destination } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const explanationId = useId()

  // `browserSupportsWebAuthn` plutôt qu'une sonde maison — non qu'elle voie plus de cas : son corps
  // est `PublicKeyCredential !== undefined && typeof … === 'function'`, mesuré en 13.3.0. Ce qu'elle
  // apporte est d'être **la** sonde de la bibliothèque qui conduira la cérémonie, et de passer par
  // `_browserSupportsWebAuthnInternals.stubThis`, le crochet par lequel un test déclare la
  // plateforme sans remplacer quoi que ce soit du produit.
  const platformKnowsPasskeys = browserSupportsWebAuthn()

  /** La clé d'accès est posée ; c'est l'écran du second facteur qui la présentera. */
  function assertNewPasskey() {
    // Sans cet oubli, la garde de `/mfa` relirait une session encore fraîche — sans facteur — et
    // renverrait ici même, en boucle.
    forgetSession(queryClient)
    void router.navigate({ to: '/mfa', search: { redirect: destination } })
  }

  /** Le second facteur est franchi : la session est élevée, et les écrans s'ouvrent. */
  function enterConsole() {
    forgetSession(queryClient)
    forgetChallenge()
    void router.navigate({ href: destination ?? '/' })
  }

  /**
   * L'enrôlement TOTP ne présente **rien** : `TotpEnrollmentRequest` déclare `required: []`, et le
   * premier enrôlement n'a pas de facteur à prouver.
   *
   * C'est ce corps vide qui rend deux des trois causes du 409 inatteignables autrement que par
   * course — un second onglet qui enrôle pendant celui-ci. `mfa_replacement_refused`, lui, exige
   * `state.Enrolled && Body.Code != nil` (`internal/bff/mfa.go`) : aucune preuve n'étant présentée
   * ici, il ne peut pas arriver, et le champ où le poser n'existe donc pas non plus. Les deux qui
   * restent valent pour l'écran entier, et le serveur les rédige lui-même.
   */
  const enroll = useMutation({
    // `data` porte la clé et les dix codes : sans `gcTime: 0`, ils restent cinq minutes en cache.
    gcTime: 0,
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/auth/mfa/totp/enroll', { body: {} })
      if (data === undefined) throw new Error(enrollmentRefusal(error, response.status))

      return data
    },
  })

  const naming = useForm({ resolver: formResolver(passkeyNaming), defaultValues: { name: '' } })

  const register = useMutation({
    mutationFn: ({ name }: { name: string }) => registerPasskey(name),
    onSuccess: assertNewPasskey,
  })

  // **L'écran des codes ne porte aucun refus, et ce n'est pas un oubli.** `enroll.error` et
  // `enroll.data` s'excluent, et cet écran-là n'offre plus la voie de la clé d'accès : un refus
  // qui y paraîtrait serait forcément celui d'une cérémonie abandonnée **avant** l'enrôlement qui
  // vient de réussir. Il contredirait l'intro juste au-dessus, sur le seul écran qui ne se
  // réaffiche jamais. Mesuré : il s'y affichait.
  if (enroll.data !== undefined) {
    return (
      <TotpEnrollment
        confirm={verifyFirstCode}
        enrollment={enroll.data}
        frame={(phase, content) => (
          <AuthLayout intro={INTRO[phase]} title={TITLE}>
            {content}
            {phase === 'confirm' ? <RestartLogin /> : null}
          </AuthLayout>
        )}
        onAcknowledged={enterConsole}
      />
    )
  }

  const refusal = enroll.error?.message ?? register.error?.message

  return (
    <AuthLayout
      intro="Ce compte n’a ni application d’authentification ni clé d’accès, et aucun écran ne s’ouvre tant qu’un second facteur n’est pas posé. Deux voies mènent au même résultat."
      title={TITLE}
    >
      {refusal === undefined ? null : <AuthRefusal>{refusal}</AuthRefusal>}

      {/*
        La clé d'accès **en premier**, conformément au §6.9 de la spécification : « WebAuthn/passkey
        privilégié quand l'appareil le supporte ». Privilégié se lit dans l'ordre autant que dans la
        variante — un opérateur qui parcourt l'écran au clavier rencontre la voie recommandée
        d'abord. Elle reste rendue, et expliquée, sur un poste qui ne la connaît pas : la retirer
        ferait disparaître la moitié de l'écran sans dire pourquoi.
      */}
      {platformKnowsPasskeys ? (
        <form
          className="auth__form"
          noValidate
          onSubmit={naming.handleSubmit((values) => register.mutate(values))}
        >
          <Field error={naming.formState.errors.name?.message} label="Nom de la clé">
            <Input autoComplete="off" maxLength={64} required {...naming.register('name')} />
          </Field>
          <Button loading={register.isPending} type="submit" variant="primary">
            Enregistrer une clé d’accès
          </Button>
        </form>
      ) : (
        <Button aria-describedby={explanationId} blocked>
          Enregistrer une clé d’accès
        </Button>
      )}
      {platformKnowsPasskeys ? (
        <p className="auth__aside">
          L’appareil déverrouille la session comme il déverrouille son écran : empreinte, visage ou
          code. Rien n’est à recopier, et rien n’est à conserver ailleurs.
        </p>
      ) : (
        <p className="auth__aside" id={explanationId}>
          Ce navigateur n’expose pas les clés d’accès : la cérémonie ne peut pas s’ouvrir ici.
          L’application d’authentification reste disponible, et une clé pourra être ajoutée plus
          tard depuis un poste à jour.
        </p>
      )}

      <Button
        loading={enroll.isPending}
        onClick={() => enroll.mutate()}
        variant={platformKnowsPasskeys ? 'secondary' : 'primary'}
      >
        Configurer une application d’authentification
      </Button>
      <p className="auth__aside">
        Un QR code à scanner avec l’application d’authentification, et dix codes de récupération
        montrés une seule fois.
      </p>

      <RestartLogin />
    </AuthLayout>
  )
}

const INTRO = {
  confirm:
    'Scannez ce code avec l’application d’authentification, puis saisissez le code qu’elle affiche. Tant qu’il n’est pas accepté, l’enrôlement reste à terminer.',
  codes:
    'L’application d’authentification est confirmée. Voici les dix codes qui rouvrent la session si l’appareil est perdu — ils ne seront plus jamais affichés.',
} as const

/** Le premier enrôlement se confirme par la vérification que la connexion a ouverte. */
async function verifyFirstCode(code: string) {
  const challenge = peekChallenge()
  if (challenge === undefined) throw new Error(CHALLENGE_LOST)

  const { error, response } = await api.POST('/auth/mfa/verify', {
    body: { challenge, method: 'totp' as const, code },
  })
  if (!response.ok) throw new Error(verificationRefusal(error, response.status, 'totp'))
}

function enrollmentRefusal(error: unknown, status: number) {
  return refusalMessage(
    error,
    `L’enrôlement n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}).`,
  )
}

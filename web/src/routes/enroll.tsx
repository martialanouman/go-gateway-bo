import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useId } from 'react'
import { AuthLayout, AuthPending, AuthRefusal, RestartLogin } from '~/components/auth-layout'
import { Button } from '~/components/ui'
import { api, refusalMessage } from '~/lib/api'
import { forgetSession, peekChallenge, readSession, safeDestination } from '~/lib/session'

/**
 * L'enrôlement du second facteur — l'écran par lequel un compte nu devient un compte qui entre.
 *
 * Il est hors de la coquille pour la même raison que la connexion et le second facteur : la session
 * existe, mais elle n'ouvre encore rien. Et il existe avant l'écran de gestion des opérateurs parce
 * que **le premier administrateur n'a personne pour l'enrôler** — la v1.0 avait rendu le second
 * facteur obligatoire sans livrer aucun écran qui permette d'en poser un.
 *
 * **Il enrôle, il ne vérifie pas.** Ni l'enrôlement TOTP ni l'enregistrement d'une clé d'accès
 * n'élèvent la session côté serveur : seule `POST /auth/mfa/verify` le fait (`internal/bff/mfa.go`,
 * `Sessions.Elevate`). La vérification a déjà son écran, qui sait présenter les deux méthodes et
 * rédiger leurs refus ; cet écran-ci y conduit plutôt que d'en écrire une seconde copie.
 */
export const Route = createFileRoute('/enroll')({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeDestination(search.redirect),
  }),

  beforeLoad: async ({ context, search }) => {
    const session = await readSession(context.queryClient)

    if (session.kind === 'none') {
      throw redirect({ to: '/login', search: { redirect: search.redirect } })
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

    // **Un facteur en place se présente, il ne se double pas.** Le serveur exige la preuve de celui
    // qu'on remplace (`TotpEnrollmentRequest`), et cet écran n'en présente aucune : il n'enrôle que
    // le premier facteur. Le remplacement arrive en step-029, avec le formulaire qui porte la preuve.
    const { totp, passkeys } = session.me.secondFactors
    if (totp || passkeys > 0) {
      throw redirect({ to: '/mfa', search: { redirect: search.redirect } })
    }

    // Sans challenge, la vérification qui suit l'enrôlement serait refusée : l'écran poserait un
    // facteur, montrerait dix codes irrécupérables, puis déposerait l'opérateur devant un refus
    // certain. Le cas n'est pas théorique — c'est ce que produit un rechargement, puisque le
    // challenge ne vit qu'en mémoire du document.
    if (peekChallenge() === undefined) {
      throw redirect({ to: '/login', search: { redirect: search.redirect } })
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

  // `browserSupportsWebAuthn` plutôt qu'une sonde maison : la bibliothèque connaît les cas que
  // `window.PublicKeyCredential !== undefined` manque, et c'est elle qui conduira la cérémonie.
  const platformKnowsPasskeys = browserSupportsWebAuthn()

  /** Le facteur est posé ; c'est l'écran du second facteur qui l'élèvera. */
  function verifyNewFactor() {
    // Sans cet oubli, la garde de `/mfa` relirait une session encore fraîche — sans facteur — et
    // renverrait ici même, en boucle.
    forgetSession(queryClient)
    void router.navigate({ to: '/mfa', search: { redirect: destination } })
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
    mutationFn: async () => {
      const { data, error, response } = await api.POST('/auth/mfa/totp/enroll', { body: {} })
      if (data === undefined) throw new Error(enrollmentRefusal(error, response.status))

      return data
    },
  })

  const register = useMutation({
    mutationFn: async () => {
      const opened = await api.POST('/auth/mfa/webauthn/register/begin')
      if (opened.data === undefined) {
        throw new Error(enrollmentRefusal(opened.error, opened.response.status))
      }

      const attestation = await createPasskey(opened.data.publicKey)

      const { data, error, response } = await api.POST('/auth/mfa/webauthn/register/finish', {
        // Le contrat déclare `attestation` comme un objet **libre** — sa forme appartient à la
        // spécification WebAuthn, et c'est la bibliothèque du serveur qui l'analyse. Rien n'est lu
        // ici : le transit est littéral.
        body: { attestation: attestation as unknown as Record<string, unknown> },
      })
      if (data === undefined) throw new Error(enrollmentRefusal(error, response.status))
    },
    onSuccess: verifyNewFactor,
  })

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
      <Button
        {...(platformKnowsPasskeys
          ? { blocked: false as const }
          : { blocked: true as const, 'aria-describedby': explanationId })}
        loading={register.isPending}
        onClick={() => register.mutate()}
        variant={platformKnowsPasskeys ? 'primary' : 'secondary'}
      >
        Enregistrer une clé d’accès
      </Button>
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

/** Ce que `navigator.credentials.create()` produit, transmis **tel quel** au BFF. */
async function createPasskey(options: unknown) {
  try {
    // Les options traversent **telles quelles**, du serveur au navigateur : le DTO du contrat les
    // déclare champ par champ, et `@simplewebauthn` les retype en son propre vocabulaire. Les deux
    // décrivent la même charge utile WebAuthn ; les réconcilier champ à champ en ferait deux
    // rédactions dont une périmerait au premier ajout de la spécification.
    return await startRegistration({
      optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'],
    })
  } catch {
    // La bibliothèque rédige **en anglais**, et sa phrase parlerait de `NotAllowedError` à un
    // opérateur. Le cas le plus courant n'est d'ailleurs pas une panne : c'est la fenêtre du
    // navigateur qu'on referme.
    throw new Error(CEREMONY_ABANDONED)
  }
}

const CEREMONY_ABANDONED =
  'La clé d’accès n’a pas été enregistrée : la fenêtre du navigateur s’est refermée, ou l’appareil n’a pas répondu. Reprenez l’enregistrement.'

function enrollmentRefusal(error: unknown, status: number) {
  return refusalMessage(
    error,
    `L’enrôlement n’a pas abouti : le tableau de bord n’a pas obtenu de réponse (HTTP ${status}).`,
  )
}

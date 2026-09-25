import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { AuthLayout, AuthPending, AuthRefusal, RestartLogin } from '~/components/auth-layout'
import { Button, Field, Input } from '~/components/ui'
import { api, refusalMessage } from '~/lib/api'
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

    // **Un facteur en place se présente, il ne se double pas.** Le serveur exige la preuve de celui
    // qu'on remplace (`TotpEnrollmentRequest`), et cet écran n'en présente aucune : il n'enrôle que
    // le premier facteur. Le remplacement n'a pas encore d'écran : dette 053.
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

  /**
   * La clé d'accès est posée ; c'est l'écran du second facteur qui la présentera.
   *
   * **Aucun test ne l'exécute, et c'est mesuré plutôt que supposé.** jsdom n'expose pas
   * `navigator.credentials`, donc `startRegistration` échoue toujours et ce `onSuccess` n'est
   * jamais atteint ; le parcours Playwright, lui, passe par TOTP, seule voie qu'un poste de CI
   * sans authentificateur puisse suivre. Dette 052 : un authentificateur virtuel posé par CDP
   * refermerait ce chemin **et** l'assertion de `/mfa`, aujourd'hui dans le même état.
   *
   * L'exemption porte sur la mesure, pas sur la règle — elle se retire avec la dette.
   */
  /* v8 ignore next 5 */
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
    onSuccess: assertNewPasskey,
  })

  // **L'écran des codes ne porte aucun refus, et ce n'est pas un oubli.** `enroll.error` et
  // `enroll.data` s'excluent, et cet écran-là n'offre plus la voie de la clé d'accès : un refus
  // qui y paraîtrait serait forcément celui d'une cérémonie abandonnée **avant** l'enrôlement qui
  // vient de réussir. Il contredirait l'intro juste au-dessus, sur le seul écran qui ne se
  // réaffiche jamais. Mesuré : il s'y affichait.
  if (enroll.data !== undefined) {
    return <TotpEnrollment enrollment={enroll.data} onAcknowledged={enterConsole} />
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

/**
 * La taille du QR, écrite plutôt que laissée au défaut de la bibliothèque.
 *
 * `qrcode.react` dessine 128 px par défaut, soit une vignette qu'une caméra de téléphone rate à
 * distance de lecture confortable.
 *
 * `size` n'écrit que les attributs `width` et `height` : la géométrie des deux chemins est en
 * **unités de module**, et le `viewBox` — ici `0 0 49 49`, 41 modules plus deux fois la zone calme
 * — la met à l'échelle. Mesuré : à 128 px et à 200 px, le `d` des modules est identique. La valeur
 * est donc posée ici et non dans la feuille parce que c'est le bouton de la bibliothèque, et que la
 * taille intrinsèque du SVG doit dire la vérité plutôt que dépendre d'une règle qui ne la nomme pas.
 */
const QR_SIZE = 200

/**
 * Ce que l'enrôlement vient de rendre, en deux temps : **d'abord prouver, ensuite garder**.
 *
 * La configuration montre le QR et la clé, et demande le premier code. Les dix codes de
 * récupération n'arrivent qu'après : les montrer avant, c'est les faire enregistrer pour un
 * authentificateur qui ne marchera peut-être jamais — et laisser partir l'opérateur sur un compte
 * que le serveur croit gardé.
 *
 * Les codes sont hachés (`internal/mfa/recovery.go`, argon2id) : irrécupérables, y compris pour le
 * serveur. La clé, elle, est **chiffrée au repos et non hachée** — `internal/mfa/cipher.go` la
 * rouvre à chaque vérification TOTP, sans quoi aucun code ne pourrait être vérifié. Ce qui la rend
 * irréaffichable n'est donc pas la cryptographie mais l'absence de route qui la rende : aucune
 * action « révéler » n'existe, invariant (b). Rien de tout cela ne quitte l'état de ce composant ;
 * un rechargement le perd, et c'est la propriété qu'on veut, non un effet de bord.
 */
function TotpEnrollment({
  enrollment,
  onAcknowledged,
}: {
  readonly enrollment: {
    readonly secret: string
    readonly otpauthUri: string
    readonly recoveryCodes: readonly string[]
  }
  readonly onAcknowledged: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)

  if (confirmed) {
    return <RecoveryCodes codes={enrollment.recoveryCodes} onAcknowledged={onAcknowledged} />
  }

  return <TotpConfirmation enrollment={enrollment} onConfirmed={() => setConfirmed(true)} />
}

/** Le QR, la clé, et le premier code qui prouve que l'application est bien configurée. */
function TotpConfirmation({
  enrollment,
  onConfirmed,
}: {
  readonly enrollment: { readonly secret: string; readonly otpauthUri: string }
  readonly onConfirmed: () => void
}) {
  const form = useForm({ resolver: formResolver(totpAttempt), defaultValues: { code: '' } })

  const verify = useMutation({
    mutationFn: async ({ code }: { code: string }) => {
      const challenge = peekChallenge()
      if (challenge === undefined) throw new Error(CHALLENGE_LOST)

      const { error, response } = await api.POST('/auth/mfa/verify', {
        body: { challenge, method: 'totp' as const, code },
      })
      if (!response.ok) throw new Error(verificationRefusal(error, response.status, 'totp'))
    },
    onSuccess: onConfirmed,
  })

  return (
    <AuthLayout
      intro="Scannez ce code avec l’application d’authentification, puis saisissez le code qu’elle affiche. Tant qu’il n’est pas accepté, l’enrôlement reste à terminer."
      title={TITLE}
    >
      {verify.error === null ? null : <AuthRefusal>{verify.error.message}</AuthRefusal>}

      <div className="auth__qr">
        <QRCodeSVG
          // Les quatre modules de zone calme que la spécification du QR exige, posés par la
          // bibliothèque plutôt que par une marge CSS : leur largeur suit le module, pas le pixel.
          marginSize={4}
          size={QR_SIZE}
          title="QR code d’enrôlement de l’application d’authentification"
          value={enrollment.otpauthUri}
        />
      </div>

      <p className="auth__aside">Sans caméra, saisissez la clé ci-dessous à la main.</p>

      <p className="auth__secret">{enrollment.secret}</p>
      <CopyButton done="Clé copiée." label="Copier la clé" value={enrollment.secret} />

      <form
        className="auth__form"
        noValidate
        onSubmit={form.handleSubmit((values) => verify.mutate(values))}
      >
        <Field error={form.formState.errors.code?.message} label="Code à six chiffres">
          <Input
            autoComplete="one-time-code"
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

      <RestartLogin />
    </AuthLayout>
  )
}

/**
 * Les dix codes, montrés une fois, sur un facteur qui vient de faire ses preuves.
 *
 * **Aucune reprise de connexion ici.** La session est élevée et l'authentificateur marche : il n'y
 * a plus rien à reprendre, et l'offrir jetterait dix codes pour rien. La seule sortie est l'accusé
 * de réception, qui ouvre la console.
 */
function RecoveryCodes({
  codes,
  onAcknowledged,
}: {
  readonly codes: readonly string[]
  readonly onAcknowledged: () => void
}) {
  const codesId = useId()
  const asText = codes.join('\n')

  return (
    <AuthLayout
      intro="L’application d’authentification est confirmée. Voici les dix codes qui rouvrent la session si l’appareil est perdu — ils ne seront plus jamais affichés."
      title={TITLE}
    >
      <h2 className="auth__subtitle" id={codesId}>
        Codes de récupération
      </h2>
      <p className="auth__aside">
        Chacun ne sert qu’une fois. Conservez-les hors de cet appareil — un gestionnaire de mots de
        passe, ou une impression en lieu sûr. Quitter cet écran sans les avoir enregistrés les perd
        définitivement.
      </p>
      <ul aria-labelledby={codesId} className="auth__codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <CopyButton done="Codes copiés." label="Copier les codes" value={asText} />
      <a
        className="auth__download"
        // Un `data:` plutôt qu'un `blob:` : le fichier n'est qu'une chaîne, et `download` suffit à
        // le faire enregistrer. Un `URL.createObjectURL` demanderait en plus qu'on le révoque,
        // donc une fuite de plus à tenir pour rien.
        download="codes-de-recuperation-sms-gateway.txt"
        href={`data:text/plain;charset=utf-8,${encodeURIComponent(`${asText}\n`)}`}
      >
        Télécharger les codes
      </a>

      <Button onClick={onAcknowledged} variant="primary">
        J’ai enregistré ces codes
      </Button>
    </AuthLayout>
  )
}

/**
 * Copier une valeur qu'on ne reverra pas, et le **dire**.
 *
 * Le retour est écrit plutôt que joué : un état qui s'efface tout seul demanderait une minuterie,
 * donc un test qui mesure sa propre attente. Il est annoncé aux lecteurs d'écran, faute de quoi un
 * clic réussi ne change rien de perceptible — le presse-papiers ne se relit pas à l'œil.
 */
function CopyButton({
  label,
  done,
  value,
}: {
  readonly label: string
  readonly done: string
  readonly value: string
}) {
  const [outcome, setOutcome] = useState<string | undefined>(undefined)

  return (
    <>
      <Button
        onClick={() =>
          void navigator.clipboard.writeText(value).then(
            () => setOutcome(done),
            () => setOutcome(COPY_REFUSED),
          )
        }
        variant="secondary"
      >
        {label}
      </Button>
      <p aria-live="polite" className="auth__aside">
        {outcome}
      </p>
    </>
  )
}

const COPY_REFUSED =
  'Le navigateur n’a pas autorisé la copie : sélectionnez la valeur et copiez-la à la main.'

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

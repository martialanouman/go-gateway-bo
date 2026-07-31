/**
 * `/connexion/enrolement` — poser un second facteur, soi-même.
 *
 * ## L'écran sans lequel le produit était inaccessible
 *
 * La step-025 a rendu le second facteur obligatoire ; `installFirstAdministrator` crée le premier
 * administrateur sans en poser aucun. Les points d'entrée d'enrôlement existaient depuis les step-023
 * et step-024 et acceptaient déjà une session partielle — mais rien ne les appelait. Ce compte-là ne
 * pouvait donc jamais entrer, et le challenge de la step-026 se contentait de nommer le cul-de-sac.
 *
 * ## L'ordre des onglets s'inverse par rapport au challenge
 *
 * À la vérification, la passkey passe d'abord : elle résiste au hameçonnage. **À l'enrôlement, c'est
 * l'application authenticator qui passe d'abord**, parce qu'elle marche partout. Le compte qu'il faut
 * débloquer en priorité est celui d'un opérateur sur un poste sans authentificateur intégré — et
 * proposer d'abord une cérémonie que son matériel ne sait pas jouer le laisserait dehors.
 *
 * ## Invariant (b), et il gouverne la moitié de ce fichier
 *
 * Le secret TOTP et les codes de récupération sont montrés **exactement une fois**. Ils vivent dans
 * un état local, jamais dans le cache Query — qui peut être persisté ou inspecté — jamais dans une
 * URL, qui se retrouve dans un historique, un journal de proxy et une capture d'écran. Aucune action
 * « révéler » n'existe : elle supposerait de les avoir gardés quelque part.
 *
 * D'où l'accusé de réception avant de quitter l'écran des codes. Ce n'est pas une politesse : sans
 * lui, un opérateur qui clique trop vite perd son seul recours le jour où il perd son téléphone.
 */

import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { type FormEvent, useEffect, useId, useState } from 'react'
import {
  confirmTotpEnrollment,
  listPasskeys,
  type Passkey,
  registerPasskey,
  revokePasskey,
  startTotpEnrollment,
} from '~/components/auth/enrollment'
import { useFocusHeading } from '~/components/auth/focus-heading'
import { SessionBoundary } from '~/components/auth/session-boundary'
import { useSessionStatus } from '~/components/auth/session-gate'
import { OPERATOR_QUERY_KEY } from '~/components/permission'
import { Button, Checkbox, Tabs, TextField } from '~/components/primitives'

export const Route = createFileRoute('/connexion/enrolement')({
  component: EnrollmentScreen,
})

/** Un refus se lit en `alert`, une information en `status` : deux urgences, deux annonces. */
type Notice = { readonly tone: 'refusal' | 'information'; readonly message: string }

/**
 * L'enrôlement TOTP, en trois moments.
 *
 * `idle` n'est pas un état d'attente déguisé : préparer d'office consommerait un secret à chaque
 * ouverture de l'onglet et **écraserait** l'enrôlement en cours de celui qui a déjà scanné son QR
 * code sans confirmer.
 */
type TotpPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'started'; readonly secret: string; readonly uri: string }
  | { readonly phase: 'activated'; readonly recoveryCodes: readonly string[] }

function EnrollmentScreen() {
  const { status, retry } = useSessionStatus()
  const heading = useFocusHeading<HTMLHeadingElement>()

  // **L'état de l'enrôlement vit ici et non dans le panneau.** Base UI démonte le panneau d'onglet
  // caché : porté plus bas, le secret déjà scanné — puis les codes de récupération — disparaissaient
  // au premier aller-retour d'onglet.
  const [totp, setTotp] = useState<TotpPhase>({ phase: 'idle' })
  const [acknowledged, setAcknowledged] = useState(false)

  if (status === 'unknown' || status === 'unavailable') {
    return (
      <SessionBoundary label="Chargement de la session" retry={retry} rows={3} status={status} />
    )
  }

  // Enrôler suppose de savoir **pour qui**. Une session partielle suffit — c'est la règle des points
  // d'entrée depuis la step-023, et c'est ce qui rend cet écran atteignable par un compte bloqué —
  // mais l'absence de session, non.
  if (status === 'anonymous') return <Navigate replace to="/connexion" />

  return (
    <div className="ui-auth__form">
      <div className="ui-auth__heading">
        <h1 ref={heading} tabIndex={-1}>
          Second facteur
        </h1>
        <p>
          Un second facteur est requis pour ouvrir la console. Choisissez celui que votre matériel
          permet ; vous pourrez en ajouter un autre ensuite.
        </p>
      </div>

      {/*
        **Les codes de récupération prennent tout l'écran, sans onglets.** Base UI démonte le panneau
        caché — `keepMounted` vaut `false` — et un clic sur « Passkey » détruisait donc l'état local
        qui les portait. Ils ne sont conservés nulle part ailleurs : le serveur n'en garde que des
        empreintes, et un second enrôlement est refusé puisque le facteur est désormais actif.
        L'opérateur perdait son seul recours par le geste que l'écran l'invite à faire.
        L'accusé de réception ne gardait que la sortie par le bouton, pas la sortie par l'onglet.
      */}
      {totp.phase === 'activated' ? (
        <RecoveryCodes
          acknowledged={acknowledged}
          codes={totp.recoveryCodes}
          onAcknowledge={setAcknowledged}
        />
      ) : (
        <Tabs
          defaultValue="totp"
          tabs={[
            {
              value: 'totp',
              label: 'Application authenticator',
              panel: <TotpPanel onEnrolled={setTotp} totp={totp} />,
            },
            { value: 'passkey', label: 'Passkey', panel: <PasskeyPanel status={status} /> },
          ]}
        />
      )}
    </div>
  )
}

function TotpPanel({
  totp,
  onEnrolled,
}: {
  readonly totp: TotpPhase
  readonly onEnrolled: (phase: TotpPhase) => void
}) {
  // **Le focus suit les transitions internes.** Le bouton cliqué est démonté avec son bloc, et le
  // focus retombe alors sur `body` : un opérateur au lecteur d'écran clique « Préparer », n'entend
  // rien, et doit re-tabuler à l'aveugle depuis le début du document pour découvrir qu'un QR est
  // apparu. `focus-heading.ts` traite le même défaut d'un écran à l'autre ; ces transitions-ci se
  // font **dans** l'écran, hors de sa portée.
  const prepared = useFocusHeading<HTMLHeadingElement>()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>()

  async function prepare() {
    if (busy) return
    setBusy(true)
    setNotice(undefined)

    const result = await startTotpEnrollment()
    setBusy(false)

    if (result.outcome === 'started') {
      onEnrolled({ phase: 'started', secret: result.secret, uri: result.uri })
      return
    }

    // **« Déjà enrôlé » se peint en refus**, et cette version-ci est la seconde. La première le
    // traitait en information, au motif que le compte est en règle — mais le message du serveur
    // commence par « Enrôlement refusé » et dit que le remplacement passe par un administrateur.
    // Un refus annoncé en information neutre est une contradiction que l'opérateur lit d'un coup
    // d'œil. Et le commentaire qui l'accompagnait était faux : depuis une session partielle,
    // l'onglet passkey répond 403 lui aussi.
    setNotice({ tone: 'refusal', message: result.message })
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setNotice(undefined)

    const result = await confirmTotpEnrollment(code)
    setBusy(false)

    if (result.outcome === 'activated') {
      onEnrolled({ phase: 'activated', recoveryCodes: result.recoveryCodes })
      return
    }

    // **Un enrôlement expiré ramène à `idle`**, et pas au champ de code : le secret affiché ne vaut
    // plus rien, et laisser le champ ouvert inviterait à retaper indéfiniment un code que le serveur
    // ne peut plus vérifier.
    if (result.outcome === 'expired') {
      onEnrolled({ phase: 'idle' })
      setCode('')
    }

    setNotice({ tone: 'refusal', message: result.message })
  }

  return (
    <div className="ui-auth__method">
      {notice ? (
        <p
          className={notice.tone === 'refusal' ? 'ui-auth__failure' : 'ui-auth__notice'}
          role={notice.tone === 'refusal' ? 'alert' : 'status'}
        >
          {notice.message}
        </p>
      ) : null}

      {totp.phase === 'idle' ? (
        <>
          <p>
            Une application authenticator produit un code à six chiffres, renouvelé toutes les
            trente secondes. Elle fonctionne hors ligne et sur n’importe quel téléphone.
          </p>
          <Button loading={busy} onClick={prepare} type="button" variant="primary">
            {busy ? 'Préparation en cours' : 'Préparer l’enrôlement'}
          </Button>
        </>
      ) : null}

      {totp.phase === 'started' ? (
        <>
          <h2 className="ui-enroll__step" ref={prepared} tabIndex={-1}>
            Scannez ce code
          </h2>
          <p>
            Scannez-le avec votre application, ou saisissez la clé à la main si l’appareil ne peut
            pas scanner.
          </p>
          {/*
            Rendu en SVG **inline** : une image distante placerait le secret dans une requête sortante
            — donc dans les journaux d'un tiers — et la politique de sécurité du contenu la refuserait
            de toute façon.
          */}
          <div className="ui-enroll__qr">
            {/*
              Aucune couleur passée en propriété, et aucune posée par CSS non plus : les valeurs par
              défaut de la bibliothèque sont le noir pur sur blanc pur que la norme de lecture exige.
              Une tentative de les déplacer dans la feuille de style a peint le **fond** du QR en noir
              aussi — la bibliothèque émet deux chemins, et le sélecteur les prenait tous les deux.
              Voir `.ui-enroll__qr` dans `components.css`.
            */}
            <QRCodeSVG
              level="M"
              marginSize={2}
              size={176}
              title="QR code d’enrôlement du second facteur"
              value={totp.uri}
            />
          </div>

          {/*
            « Clé de secours » désignait ici le **secret partagé** du TOTP, alors que les vrais
            recours — les codes de récupération — arrivent deux écrans plus loin sous un autre nom.
            Un opérateur qui notait « la clé de secours » croyait avoir conservé son recours.
          */}
          <p className="ui-enroll__secret">
            Clé à saisir si l’appareil ne peut pas scanner : <code>{totp.secret}</code>
          </p>

          <form className="ui-auth__method" noValidate onSubmit={confirm}>
            <TextField
              autoComplete="one-time-code"
              inputMode="numeric"
              label="Code à 6 chiffres"
              mono
              name="code"
              onChange={(event) => setCode(event.target.value)}
              placeholder="000000"
              required
              value={code}
            />
            <Button loading={busy} type="submit" variant="primary">
              {busy ? 'Vérification en cours' : 'Confirmer'}
            </Button>
          </form>
        </>
      ) : null}
    </div>
  )
}

/**
 * La sortie vers la console, une fois le facteur posé.
 *
 * Elle est partagée par les deux onglets parce que les deux promeuvent la session côté serveur, et
 * que cet écran vit **hors de la coquille** : sans elle, un opérateur qui vient d'enrôler se
 * retrouve avec une session complète et aucun moyen d'entrer — ni rail, ni lien.
 *
 * `refetchQueries` et non `fetchQuery` : celui-ci rejoint une relecture déjà en vol et rendrait la
 * session d'avant l'enrôlement, ce qui renverrait l'opérateur au challenge en boucle. Même piège que
 * dans `connexion.verification.tsx`, même sortie.
 */
function ConsoleExit({
  label,
  blocked = false,
  describedBy,
}: {
  readonly label: string
  readonly blocked?: boolean
  readonly describedBy?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [leaving, setLeaving] = useState(false)

  async function onContinue() {
    if (leaving) return
    setLeaving(true)

    await queryClient.refetchQueries({ queryKey: OPERATOR_QUERY_KEY, exact: true })
    await navigate({ to: '/', replace: true })
  }

  return (
    // Un vrai `<button>` et non un lien habillé : `blocked` neutralise le clic sur un bouton, mais
    // `aria-disabled` sur un `<a href>` n'empêche rien — l'opérateur partirait sans avoir noté ses
    // codes, et ils seraient perdus. Le contrat de `PermissionGate` avait déjà buté là-dessus.
    <Button
      aria-describedby={describedBy}
      blocked={blocked}
      loading={leaving}
      onClick={onContinue}
      type="button"
      variant="primary"
    >
      {leaving ? 'Ouverture de la console' : label}
    </Button>
  )
}

/**
 * Les codes de récupération, montrés une fois.
 *
 * Le bouton reste **bloqué et expliqué** tant que l'accusé n'est pas coché — jamais masqué, ce qui
 * laisserait croire qu'il n'y a rien à faire. C'est la règle de la charte appliquée à un cas où elle
 * protège d'une perte définitive.
 */
function RecoveryCodes({
  codes,
  acknowledged,
  onAcknowledge,
}: {
  readonly codes: readonly string[]
  readonly acknowledged: boolean
  readonly onAcknowledge: (value: boolean) => void
}) {
  const ackId = useId()
  const heading = useFocusHeading<HTMLHeadingElement>()

  return (
    <>
      {/*
        **Le moment le plus irréversible de l'écran, et il était silencieux.** Le focus retombait sur
        `body` après la confirmation, et la région `status` était insérée en même temps que son texte
        — une région live montée d'un bloc n'est pas annoncée de façon fiable. Le titre reçoit donc
        le focus, ce qui le fait lire, et les codes suivent immédiatement dans l'ordre du document.
      */}
      <h2 className="ui-enroll__step" ref={heading} tabIndex={-1}>
        Second facteur activé
      </h2>
      <p>
        Voici vos codes de récupération : ils remplacent votre application le jour où vous perdez
        votre téléphone.
      </p>

      {codes.length > 0 ? (
        <>
          <ul aria-label="Codes de récupération" className="ui-enroll__codes">
            {codes.map((recoveryCode) => (
              <li key={recoveryCode}>
                <code>{recoveryCode}</code>
              </li>
            ))}
          </ul>

          <p className="ui-auth__note">
            Ils ne seront plus jamais affichés — ni ici, ni ailleurs, ni sur demande. Conservez-les
            hors de cette machine.
          </p>
        </>
      ) : (
        // Un 200 sans codes : le facteur **est** actif, et annoncer « voici vos codes » au-dessus
        // d'une liste vide serait une affirmation fausse au moment où l'opérateur en a le plus
        // besoin. On dit ce qui est vrai, et ce qu'il lui reste.
        <p className="ui-auth__failure" role="alert">
          Aucun code de récupération n’a été rendu par le serveur. Votre second facteur est actif,
          mais vous n’avez pas de recours en cas de perte de l’appareil : signalez-le à
          l’exploitation.
        </p>
      )}

      <Checkbox
        checked={acknowledged}
        label="J’ai noté ces codes et les ai conservés en lieu sûr"
        onCheckedChange={(value) => onAcknowledge(value === true)}
      />

      <ConsoleExit
        blocked={!acknowledged}
        describedBy={acknowledged ? undefined : ackId}
        label="Continuer vers la console"
      />
      {acknowledged ? null : (
        <span className="ui-auth__note" id={ackId}>
          Cochez la case ci-dessus : ces codes ne seront plus affichés après cette page.
        </span>
      )}
    </>
  )
}

function PasskeyPanel({ status }: { readonly status: 'partial' | 'complete' }) {
  const [name, setName] = useState('')
  const [passkeys, setPasskeys] = useState<readonly Passkey[]>([])
  const [busy, setBusy] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [listUnavailable, setListUnavailable] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>()
  const removalId = useId()

  /**
   * **Le retrait exige une session complète, la liste non.**
   *
   * `GET /mfa/passkeys` accepte une session partielle ; `POST /mfa/passkeys/manage` exige `active` et
   * répond sinon 401 « Session absente ou expirée ». Offrir le bouton depuis le challenge faisait
   * donc annoncer une expiration à un opérateur dont la session est parfaitement valide, et il se
   * reconnectait pour rien. Un contrôle qui ne peut pas aboutir est désactivé **et expliqué**.
   */
  const canRemove = status === 'complete'

  // La liste est un **confort** : son échec n'empêche pas d'enrôler, et l'onglet reste utilisable.
  // Mais il se dit — un vide muet ferait croire à un opérateur qui a trois passkeys qu'elles ont été
  // retirées.
  useEffect(() => {
    let mounted = true
    void listPasskeys().then((result) => {
      if (!mounted) return
      if (result.outcome === 'listed') setPasskeys(result.passkeys)
      else setListUnavailable(true)
    })
    return () => {
      mounted = false
    }
  }, [])

  async function register() {
    if (busy || name.trim().length === 0) return
    setBusy(true)
    setNotice(undefined)

    const result = await registerPasskey(name.trim())
    setBusy(false)

    if (result.outcome === 'registered') {
      // `passkeys` peut manquer : garder alors celle qu'on affichait plutôt que de faire disparaître
      // l'appareil qu'on vient d'enregistrer.
      if (result.passkeys) setPasskeys(result.passkeys)
      setName('')
      // La cérémonie promeut la session côté serveur, et cet écran vit **hors de la coquille** : sans
      // sortie explicite, l'opérateur se retrouvait avec une session complète et aucun moyen d'entrer
      // — ni rail, ni lien. Le cul-de-sac que cette step supprime se reformait sur cet onglet.
      setRegistered(true)
      return
    }

    // Fermer la fenêtre système n'est pas une panne — même partage qu'au challenge.
    setNotice({
      tone: result.outcome === 'cancelled' ? 'information' : 'refusal',
      message: result.message,
    })
  }

  async function revoke(credentialId: string) {
    if (busy) return
    setBusy(true)
    setNotice(undefined)

    const result = await revokePasskey(credentialId)
    setBusy(false)

    if (result.outcome === 'updated') {
      if (result.passkeys) setPasskeys(result.passkeys)
      return
    }

    // Le refus du dernier facteur passe par ici : le message du serveur dit **pourquoi**, et c'est
    // ce qui empêche l'opérateur de se verrouiller dehors.
    setNotice({ tone: 'refusal', message: result.message })
  }

  return (
    <div className="ui-auth__method">
      {notice ? (
        <p
          className={notice.tone === 'refusal' ? 'ui-auth__failure' : 'ui-auth__notice'}
          role={notice.tone === 'refusal' ? 'alert' : 'status'}
        >
          {notice.message}
        </p>
      ) : null}

      {/*
        **« lie ce compte à cet appareil » était faux**, et le produit le savait : les options
        d'enregistrement n'imposent ni `authenticatorAttachment` ni `residentKey`, si bien qu'une
        passkey synchronisée — trousseau du système, gestionnaire de mots de passe — est acceptée, et
        c'est le cas dominant sur un poste de travail. La passerelle stocke même `deviceType` et
        `backedUp` pour en garder trace. L'opérateur en concluait que perdre ce poste lui coûtait son
        facteur, et enrôlait en double par précaution.
      */}
      <p>
        Une passkey est une clé détenue par cet appareil ou par le trousseau qui le synchronise. Le
        navigateur refuse de signer pour une autre origine, ce qui rend la cérémonie inutilisable
        depuis une page qui imite celle-ci.
      </p>

      <TextField
        hint="Il apparaîtra dans la liste ci-dessous — choisissez de quoi le reconnaître."
        label="Nom de l’appareil"
        name="device"
        onChange={(event) => setName(event.target.value)}
        required
        value={name}
      />

      <Button
        blocked={name.trim().length === 0}
        loading={busy}
        onClick={register}
        type="button"
        variant="primary"
      >
        {busy ? 'Enregistrement en cours' : 'Enregistrer cet appareil'}
      </Button>

      {registered ? <ConsoleExit label="Continuer vers la console" /> : null}

      {listUnavailable ? (
        <p className="ui-auth__notice" role="status">
          La liste des appareils enregistrés n’a pas pu être lue. Ce n’est pas la preuve qu’il n’y
          en a aucun — l’enrôlement, lui, reste possible.
        </p>
      ) : null}

      {passkeys.length > 0 && !canRemove ? (
        <p className="ui-auth__note" id={removalId}>
          Le retrait d’un appareil demande une session complète : franchissez d’abord votre second
          facteur.
        </p>
      ) : null}

      {passkeys.length > 0 ? (
        <ul className="ui-enroll__devices">
          {passkeys.map((passkey) => (
            <li key={passkey.id}>
              <span>{passkey.name}</span>
              <Button
                aria-describedby={canRemove ? undefined : removalId}
                blocked={!canRemove}
                onClick={() => revoke(passkey.id)}
                size="sm"
                type="button"
                variant="destructive"
                /*
                  **`aria-label` et non un `<span>` masqué.** Le nom de l'appareil doit entrer dans le
                  nom accessible : avec trois appareils, trois boutons « Retirer » identiques ne
                  disent pas lequel on s'apprête à supprimer, et le geste est irréversible. Un span
                  visuellement masqué dépendait d'un calcul de nom que la bibliothèque de test ne
                  reproduisait pas ; `aria-label` ne dépend de rien.
                */
                aria-label={`Retirer ${passkey.name}`}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

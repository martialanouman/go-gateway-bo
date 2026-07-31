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

      <Tabs
        defaultValue="totp"
        tabs={[
          { value: 'totp', label: 'Application authenticator', panel: <TotpPanel /> },
          { value: 'passkey', label: 'Passkey', panel: <PasskeyPanel /> },
        ]}
      />
    </div>
  )
}

function TotpPanel() {
  const [totp, setTotp] = useState<TotpPhase>({ phase: 'idle' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>()

  async function prepare() {
    if (busy) return
    setBusy(true)
    setNotice(undefined)

    const result = await startTotpEnrollment()
    setBusy(false)

    if (result.outcome === 'started') {
      setTotp({ phase: 'started', secret: result.secret, uri: result.uri })
      return
    }

    // « Déjà enrôlé » n'est pas un refus : le compte est en règle, et l'onglet passkey reste ouvert
    // pour en **ajouter** un. Le peindre en alerte apprendrait à ignorer les alertes.
    setNotice({
      tone: result.outcome === 'already_enrolled' ? 'information' : 'refusal',
      message: result.message,
    })
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setNotice(undefined)

    const result = await confirmTotpEnrollment(code)
    setBusy(false)

    if (result.outcome === 'activated') {
      setTotp({ phase: 'activated', recoveryCodes: result.recoveryCodes })
      return
    }

    // **Un enrôlement expiré ramène à `idle`**, et pas au champ de code : le secret affiché ne vaut
    // plus rien, et laisser le champ ouvert inviterait à retaper indéfiniment un code que le serveur
    // ne peut plus vérifier.
    if (result.outcome === 'expired') {
      setTotp({ phase: 'idle' })
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
          <p>
            Scannez ce code avec votre application, ou saisissez la clé à la main si l’appareil ne
            peut pas scanner.
          </p>
          {/*
            Rendu en SVG **inline** : une image distante placerait le secret dans une requête sortante
            — donc dans les journaux d'un tiers — et la politique de sécurité du contenu la refuserait
            de toute façon.
          */}
          <div className="ui-enroll__qr">
            {/*
              Aucune couleur passée en propriété : elles vivent dans `components.css`, où une règle
              CSS l'emporte sur les attributs de présentation de la bibliothèque. Les écrire ici
              aurait posé deux littéraux dans un fichier d'écran, là où personne n'aurait su
              pourquoi ils ne suivent pas le thème — voir `--qr-paper` et `--qr-ink`.
            */}
            <QRCodeSVG
              level="M"
              marginSize={2}
              size={176}
              title="QR code d’enrôlement du second facteur"
              value={totp.uri}
            />
          </div>

          <p className="ui-enroll__secret">
            Clé de secours : <code>{totp.secret}</code>
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

      {totp.phase === 'activated' ? (
        <RecoveryCodes
          acknowledged={acknowledged}
          codes={totp.recoveryCodes}
          onAcknowledge={setAcknowledged}
        />
      ) : null}
    </div>
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ackId = useId()
  const [leaving, setLeaving] = useState(false)

  /**
   * La session vient de devenir complète côté serveur : le cache doit être relu **avant** de partir.
   *
   * `refetchQueries` et non `fetchQuery` — celui-ci rejoint une relecture déjà en vol et rendrait la
   * session d'avant l'enrôlement, ce qui renverrait l'opérateur au challenge en boucle. C'est le même
   * piège que dans `connexion.verification.tsx`, et la même sortie.
   */
  async function onContinue() {
    if (leaving) return
    setLeaving(true)

    await queryClient.refetchQueries({ queryKey: OPERATOR_QUERY_KEY, exact: true })
    await navigate({ to: '/', replace: true })
  }

  return (
    <>
      <p role="status">
        Second facteur activé. Voici vos codes de récupération : ils remplacent votre application le
        jour où vous perdez votre téléphone.
      </p>

      <ul className="ui-enroll__codes">
        {codes.map((recoveryCode) => (
          <li key={recoveryCode}>
            <code>{recoveryCode}</code>
          </li>
        ))}
      </ul>

      <p className="ui-auth__note">
        Ils ne seront plus jamais affichés — ni ici, ni ailleurs, ni sur demande. Conservez-les hors
        de cette machine.
      </p>

      <Checkbox
        checked={acknowledged}
        label="J’ai noté ces codes et les ai conservés en lieu sûr"
        onCheckedChange={(value) => onAcknowledge(value === true)}
      />

      {/*
        Un vrai `<button>` et non un lien habillé : `blocked` neutralise le clic sur un bouton, mais
        `aria-disabled` sur un `<a href>` n'empêche rien — l'opérateur partirait sans avoir noté ses
        codes, et ils seraient perdus. Le contrat de `PermissionGate` avait déjà buté là-dessus.
      */}
      <Button
        aria-describedby={acknowledged ? undefined : ackId}
        blocked={!acknowledged}
        loading={leaving}
        onClick={onContinue}
        type="button"
        variant="primary"
      >
        {leaving ? 'Ouverture de la console' : 'Continuer vers la console'}
      </Button>
      {acknowledged ? null : (
        <span className="ui-auth__note" id={ackId}>
          Cochez la case ci-dessus : ces codes ne seront plus affichés après cette page.
        </span>
      )}
    </>
  )
}

function PasskeyPanel() {
  const [name, setName] = useState('')
  const [passkeys, setPasskeys] = useState<readonly Passkey[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>()

  // La liste est un **confort** : `listPasskeys` se tait quand le serveur tombe, et l'onglet reste
  // utilisable pour enrôler. Une panne d'affichage ne doit pas fermer la seule porte d'entrée.
  useEffect(() => {
    let mounted = true
    void listPasskeys().then((known) => {
      if (mounted) setPasskeys(known)
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
      setPasskeys(result.passkeys)
      setName('')
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
      setPasskeys(result.passkeys)
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

      <p>
        Une passkey lie ce compte à cet appareil. Le navigateur refuse de signer pour une autre
        origine, ce qui rend la cérémonie inutilisable depuis une page qui imite celle-ci.
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

      {passkeys.length > 0 ? (
        <ul className="ui-enroll__devices">
          {passkeys.map((passkey) => (
            <li key={passkey.id}>
              <span>{passkey.name}</span>
              <Button
                onClick={() => revoke(passkey.id)}
                size="sm"
                type="button"
                variant="destructive"
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

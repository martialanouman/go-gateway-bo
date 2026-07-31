/**
 * `/connexion/verification` — le second facteur, **passkey d'abord, TOTP en repli**.
 *
 * ## L'ordre des onglets est une décision de sécurité
 *
 * La passkey résiste au hameçonnage parce que le navigateur refuse de signer pour une origine qui
 * n'est pas la sienne ; un code TOTP, lui, se recopie dans un faux formulaire. Mettre la passkey en
 * premier n'est donc pas une préférence d'ergonomie — c'est ce qui fait que le facteur le plus solide
 * est celui qu'on prend par défaut.
 *
 * ## « Aucun appareil » n'est pas un refus
 *
 * Le serveur répond 409 quand le compte n'a pas de passkey : la session est valide, il n'y a
 * simplement rien à vérifier par ce facteur. L'écran bascule alors sur le TOTP et le dit. Traiter ce
 * cas comme un refus laisserait un opérateur cliquer indéfiniment sur un bouton qui ne peut pas
 * aboutir.
 *
 * ## Ce que cet écran ne fait pas
 *
 * Il n'enrôle rien. Un opérateur sans aucun facteur — le premier administrateur, notamment — ne peut
 * pas franchir cette porte, et c'est la `step-028` qui lui ouvrira l'écran d'enrôlement. D'ici là,
 * l'écran **nomme la marche à suivre** plutôt que de le laisser devant un formulaire qui refuse.
 */

import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Navigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { verifyPasskey, verifyTotp } from '~/components/auth/api'
import { useFocusHeading } from '~/components/auth/focus-heading'
import { SessionBoundary } from '~/components/auth/session-boundary'
import { useSessionStatus } from '~/components/auth/session-gate'
import type { CurrentOperator } from '~/components/permission'
import { OPERATOR_QUERY_KEY, useCurrentOperator } from '~/components/permission'
import { Button, Tabs, TextField } from '~/components/primitives'

export const Route = createFileRoute('/connexion/verification')({
  component: MfaChallengeScreen,
})

/**
 * Le second facteur est passé, mais la console reste hors d'atteinte.
 *
 * Le dire explicitement, et dire quoi faire : sans cela, l'opérateur reprend une vérification qu'il
 * a déjà réussie, et se demande pourquoi rien ne change.
 */
const CONSOLE_UNREACHABLE_MESSAGE =
  'Second facteur accepté, mais la console n’a pas répondu. Réessayez dans un instant : la vérification, elle, est acquise.'

/** Un refus se lit en `alert`, une information en `status` : deux urgences, deux annonces. */
type Notice = { readonly tone: 'refusal' | 'information'; readonly message: string }

function MfaChallengeScreen() {
  const queryClient = useQueryClient()
  const { data: operator } = useCurrentOperator()
  const { status, retry } = useSessionStatus()
  const heading = useFocusHeading<HTMLHeadingElement>()
  const codeField = useRef<HTMLInputElement>(null)
  const [method, setMethod] = useState('passkey')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>()
  const [switched, setSwitched] = useState(false)

  // Le focus suit la bascule d'onglet. Sans cela, le panneau passkey se démontait **avec le bouton
  // qui portait le focus** : celui-ci retombait sur `body`, la seule annonce était un `status` poli,
  // et l'opérateur au clavier devait re-tabuler tout l'écran pour atteindre le champ qu'on venait de
  // lui ouvrir (WCAG 2.4.3).
  useEffect(() => {
    if (switched) codeField.current?.focus()
  }, [switched])

  /**
   * La session vient de devenir complète : le cache est relu, et **rien d'autre**.
   *
   * La relecture fait passer le statut à `complete`, et c'est le `<Navigate>` du corps de ce
   * composant qui emmène à la console. Une première version ajoutait ici un `navigate()` impératif :
   * les deux partaient ensemble, se disputaient la même transition, et le rendu ne se stabilisait
   * jamais — la suite de tests se bloquait sans message.
   *
   * `fetchQuery` et non `invalidateQueries` : invalider ne fait que marquer périmé. Et
   * `staleTime: 0` explicite, sans quoi le client de production rendrait la session partielle qu'il
   * tient encore pour fraîche — la coquille renverrait alors ici, en boucle.
   */
  async function enterConsole() {
    // **`refetchQueries` et non `fetchQuery`.** Le second déduplique : si une relecture de fond est
    // déjà en vol — la fenêtre reprend le focus après la boîte de dialogue système de la passkey,
    // ou les trente secondes de fraîcheur sont écoulées — il rejoint cette promesse-là et rend la
    // session **d'avant** la cérémonie. Rien ne lève, l'écran se re-rend identique, et l'opérateur
    // recommence une vérification déjà acquise. `refetchQueries` annule la requête en vol et en
    // lance une neuve.
    await queryClient.refetchQueries({ queryKey: OPERATOR_QUERY_KEY, exact: true })

    // Et l'on décide sur la **valeur obtenue**, pas sur l'absence d'exception : `refetchQueries`
    // avale les erreurs de chaque requête et ne rejette jamais. Un `try/catch` ici ne voyait donc
    // rien — c'était la seconde moitié du même défaut.
    const me = queryClient.getQueryData<CurrentOperator | null>(OPERATOR_QUERY_KEY)

    if (me?.mfaCompleted) return

    // Session perdue entre la vérification et la relecture : `sessionStatus` rend `anonymous` et le
    // corps de ce composant renvoie au login. Il n'y a rien de mieux à faire — la session n'existe
    // plus — et poser un message ici ne servirait qu'à le faire disparaître aussitôt.
    if (me === null) return

    // Reste le cas qui compte : le facteur est acquis côté serveur, et l'écran ne peut pas le
    // montrer. Le dire, plutôt que de re-rendre le même formulaire sans un mot.
    setBusy(false)
    setNotice({ tone: 'refusal', message: CONSOLE_UNREACHABLE_MESSAGE })
  }

  async function runPasskey() {
    if (busy) return
    setBusy(true)
    setNotice(undefined)

    const result = await verifyPasskey()

    // **`busy` tient jusqu'au bout de la relecture.** Le relâcher ici rouvrait le bouton pendant
    // l'aller-retour `/auth/me` — reprise comprise — sans qu'aucun message n'accompagne l'attente :
    // l'opérateur cliquait à nouveau sur une cérémonie qui avait déjà abouti.
    if (result.outcome === 'completed') return enterConsole()

    setBusy(false)

    if (result.outcome === 'no_passkey') {
      // Bascule et information, pas alerte : l'opérateur n'a rien fait de mal, il lui manque un
      // appareil sur ce compte. `switched` déclenche le déplacement du focus vers le champ de code.
      setMethod('totp')
      setSwitched(true)
      setNotice({ tone: 'information', message: result.message })
      return
    }

    // Une cérémonie abandonnée — fenêtre fermée, délai écoulé, biométrie refusée — n'est pas une
    // panne. Peindre une alerte à chaque hésitation apprendrait à les ignorer.
    setNotice({
      tone: result.outcome === 'cancelled' ? 'information' : 'refusal',
      message: result.message,
    })
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setNotice(undefined)

    const result = await verifyTotp(code)

    // Voir `runPasskey` : `busy` tient jusqu'à la fin de la relecture.
    if (result.outcome === 'completed') return enterConsole()

    setBusy(false)

    setNotice({ tone: 'refusal', message: result.message })
  }

  // **Une seule règle, lue par `sessionStatus`.** La version précédente testait `!isPending &&
  // !operator`, ce qui rangeait une requête **en erreur** avec « aucune session » : à chaque hoquet
  // de `/auth/me`, l'opérateur repartait au login, ressaisissait son mot de passe, revenait ici, et
  // recommençait — en consommant une tentative du compteur à chaque tour.
  if (status === 'unknown' || status === 'unavailable') {
    return (
      <SessionBoundary label="Chargement de la session" retry={retry} rows={3} status={status} />
    )
  }
  if (status === 'anonymous') return <Navigate replace to="/connexion" />
  if (status === 'complete') return <Navigate replace to="/" />

  return (
    <div className="ui-auth__form">
      <div className="ui-auth__heading">
        <h1 ref={heading} tabIndex={-1}>
          Vérification en deux étapes
        </h1>
        <p>
          Second facteur requis pour <span className="ui-auth__identity">{operator?.email}</span>.
        </p>
      </div>

      {notice ? (
        <p
          className={notice.tone === 'refusal' ? 'ui-auth__failure' : 'ui-auth__notice'}
          role={notice.tone === 'refusal' ? 'alert' : 'status'}
        >
          {notice.message}
        </p>
      ) : null}

      <Tabs
        onValueChange={(value) => setMethod(String(value))}
        tabs={[
          {
            value: 'passkey',
            label: 'Passkey',
            panel: (
              <div className="ui-auth__method">
                <p>
                  Approuvez sur cet appareil. Le navigateur ne signe que pour cette origine, ce qui
                  rend la cérémonie inutilisable depuis une page qui l’imite.
                </p>
                <Button loading={busy} onClick={runPasskey} type="button" variant="primary">
                  {busy ? 'Vérification en cours' : 'Utiliser la passkey'}
                </Button>
              </div>
            ),
          },
          {
            value: 'totp',
            label: 'Code TOTP',
            panel: (
              <form className="ui-auth__method" noValidate onSubmit={submitCode}>
                <TextField
                  ref={codeField}
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
                  {busy ? 'Vérification en cours' : 'Vérifier'}
                </Button>
              </form>
            ),
          },
        ]}
        value={method}
      />

      {/*
        Le cul-de-sac nommé. Un opérateur tout juste amorcé n'a ni appareil ni application, et aucun
        des deux onglets ne peut aboutir pour lui : le produit lui doit une conduite à tenir.
      */}
      {/*
        La conduite à tenir est **de ne rien promettre**. Une version précédente disait « signalez-le
        à l'administrateur de la console » — or le destinataire de cette phrase est justement le
        premier administrateur, celui qu'`installFirstAdministrator` crée sans facteur, et la
        réinitialisation par un tiers est renvoyée à la step-027. Il n'y avait personne à qui
        signaler. Nommer un remède inexistant est pire qu'un cul-de-sac reconnu.
      */}
      <p className="ui-auth__note">
        Aucun second facteur enrôlé ? Aucun des deux onglets ne peut alors aboutir : l’écran
        d’enrôlement arrive au jalon M1 (step-028), et rien ne permet encore d’en poser un depuis
        l’interface.
      </p>
    </div>
  )
}

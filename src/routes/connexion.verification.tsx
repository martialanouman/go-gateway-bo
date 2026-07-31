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
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { verifyPasskey, verifyTotp } from '~/components/auth/api'
import { OPERATOR_QUERY_KEY, useCurrentOperator } from '~/components/permission'
import { Button, Tabs, TextField } from '~/components/primitives'
import { Loading } from '~/components/states'

export const Route = createFileRoute('/connexion/verification')({
  component: MfaChallengeScreen,
})

/** Un refus se lit en `alert`, une information en `status` : deux urgences, deux annonces. */
type Notice = { readonly tone: 'refusal' | 'information'; readonly message: string }

function MfaChallengeScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: operator, isPending } = useCurrentOperator()
  const [method, setMethod] = useState('passkey')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>()

  // Rien à compléter : ni session, ou second facteur déjà franchi. Rester ici afficherait un
  // formulaire dont aucune soumission ne peut aboutir.
  if (!isPending && !operator) {
    void navigate({ to: '/connexion', replace: true })
    return null
  }

  if (!isPending && operator?.mfaCompleted) {
    void navigate({ to: '/', replace: true })
    return null
  }

  if (isPending) return <Loading label="Chargement de la session" rows={3} />

  /** La session vient de devenir complète : le cache doit être relu, sinon la coquille garderait
   * l'opérateur sans permission qu'elle a lu avant la cérémonie. */
  async function enterConsole() {
    await queryClient.invalidateQueries({ queryKey: OPERATOR_QUERY_KEY })
    await navigate({ to: '/', replace: true })
  }

  async function runPasskey() {
    if (busy) return
    setBusy(true)
    setNotice(undefined)

    const result = await verifyPasskey()
    setBusy(false)

    if (result.outcome === 'completed') return enterConsole()

    if (result.outcome === 'no_passkey') {
      // Bascule et information, pas alerte : l'opérateur n'a rien fait de mal, il lui manque un
      // appareil sur ce compte.
      setMethod('totp')
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
    setBusy(false)

    if (result.outcome === 'completed') return enterConsole()

    setNotice({ tone: 'refusal', message: result.message })
  }

  return (
    <div className="ui-auth__form">
      <header className="ui-auth__heading">
        <h1>Vérification en deux étapes</h1>
        <p>
          Second facteur requis pour <span className="ui-auth__identity">{operator?.email}</span>.
        </p>
      </header>

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
      <p className="ui-auth__note">
        Aucun second facteur enrôlé ? Aucun des deux onglets ne peut aboutir : l’écran d’enrôlement
        arrive au jalon M1 (step-028). Signalez-le à l’administrateur de la console.
      </p>
    </div>
  )
}

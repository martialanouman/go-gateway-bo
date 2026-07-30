/**
 * La confirmation d'un acte à conséquence.
 *
 * ## Ce qui la distingue d'une modale ordinaire
 *
 * Elle **nomme l'acte** dans son bouton — « Effectuer la rotation », « Déconnecter », « Lever le
 * désabonnement » — et jamais « OK » ni « Confirmer » seul. Un opérateur qui clique « OK » n'a pas
 * lu ; un opérateur qui clique « Déconnecter » sait ce qu'il fait.
 *
 * ## La saisie de confirmation, et quand elle sert
 *
 * Pour les actes **irréversibles** — effacement RGPD, destruction d'une clé de contenu — le bouton
 * reste inerte tant que l'opérateur n'a pas recopié une phrase. Ce n'est pas une friction
 * décorative : c'est ce qui distingue un clic de trop d'une décision. Elle ne s'active que quand
 * `confirmationPhrase` est fournie, parce qu'une friction posée partout se contourne mécaniquement.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import { Button, TextField } from '../primitives'
import { Dialog } from './dialog'

export type ConfirmDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: ReactNode
  /** **La conséquence en clair**, au présent, sans euphémisme. */
  readonly consequence: ReactNode
  /** Le verbe de l'acte. Jamais « OK », jamais « Confirmer » seul. */
  readonly confirmLabel: string
  readonly onConfirm: () => void
  /** Présente ⇒ acte irréversible : le bouton reste inerte tant qu'elle n'est pas recopiée. */
  readonly confirmationPhrase?: string
  readonly destructive?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  onConfirm,
  confirmationPhrase,
  destructive = true,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')

  const locked = confirmationPhrase !== undefined && typed.trim() !== confirmationPhrase

  /**
   * **Le seul chemin de fermeture.**
   *
   * Une première version appelait `onOpenChange(false)` directement depuis « Annuler », en laissant
   * la remise à zéro dans le gestionnaire de la modale. Résultat : fermer par le bouton ne
   * réinitialisait pas la saisie, et rouvrir présentait un bouton **déjà armé** — la friction ne
   * protégeait que la première tentative, c'est-à-dire celle où l'opérateur était le plus attentif.
   * Le test l'a trouvé.
   */
  function close() {
    setTyped('')
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      // La modale est **pilotée** et n'a pas de déclencheur interne : Base UI ne signale donc que la
      // fermeture (Escape, clic sur le voile). Écrire une branche pour l'ouverture aurait été du
      // code que rien n'atteint.
      onOpenChange={close}
      title={title}
      description={consequence}
    >
      {confirmationPhrase !== undefined ? (
        <TextField
          label={`Saisissez « ${confirmationPhrase} » pour confirmer`}
          hint="Le bouton s’active quand la phrase est recopiée à l’identique."
          value={typed}
          mono
          onChange={(event) => setTyped(event.target.value)}
        />
      ) : null}

      <div className="ui-dialog__footer">
        <Button onClick={close}>Annuler</Button>
        <Button
          variant={destructive ? 'destructive' : 'primary'}
          // `blocked` et non `disabled` : le dépôt a déjà tranché cette question dans `button.tsx`.
          // Un `disabled` nu retire le bouton du parcours clavier **et** de l'arbre
          // d'accessibilité : l'opérateur au lecteur d'écran ne saurait ni que l'action existe, ni
          // pourquoi elle est bloquée, ni ce qu'il faut faire — alors que la charte exige un
          // contrôle « désactivé **et expliqué** ».
          blocked={locked}
          onClick={() => {
            onConfirm()
            close()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

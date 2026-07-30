/**
 * Les toasts — et **l'invariant (a) posé au bon endroit**.
 *
 * ## Ce qu'un toast ne porte jamais
 *
 * Ni corps de message, ni secret. C'est le composant le plus exposé du produit sur ce point : il
 * apparaît après une action, souvent construit à partir de la réponse de la passerelle, il reste à
 * l'écran quelques secondes, et il finit dans les captures qu'on colle dans un ticket. « Le message
 * "RDV demain 14h" a été renvoyé » est exactement la phrase qu'un développeur pressé écrira.
 *
 * `notify()` refuse donc les deux, à l'exécution. Le refus est **bruyant** : filtrer en silence
 * laisserait le toast s'afficher amputé, et personne ne verrait le défaut.
 *
 * ## Une barre latérale par sévérité
 *
 * Charte §10. La couleur ne porte pas seule l'information — le titre la dit aussi — mais elle permet
 * de trier trois toasts empilés d'un coup d'œil.
 */

import { Toast as BaseToast } from '@base-ui/react/toast'
import type { ReactNode } from 'react'

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error'

/**
 * Une **valeur** opaque : au moins seize caractères de l'alphabet des identifiants, sans espace.
 *
 * ## Pourquoi la forme et non le mot
 *
 * La première version refusait les mots « secret », « password », « token ». Elle a immédiatement
 * rejeté une copie parfaitement correcte — « L'ancien secret cesse d'être accepté dans 24 heures » —
 * et la charte elle-même écrit « le nouveau secret ne sera affiché qu'une seule fois ». Le mot est
 * **légitime en français** ; c'est la valeur qui ne doit pas sortir.
 *
 * Une garde qui refuse la bonne copie se fait retirer dans la semaine. Celle-ci vise donc
 * `sk-live-0123456789`, une clé en base64, un identifiant de bind — des suites longues et sans
 * espace, que personne n'écrit dans une phrase.
 *
 * ## Ce qu'elle n'attrape pas
 *
 * Un corps de SMS court et anodin, ou un secret volontairement espacé. La défense reste que
 * l'appelant annonce **ce qui a eu lieu**, pas ce que cela contenait — voir l'en-tête.
 */
const OPAQUE_VALUE = /[A-Za-z0-9_\-+/=]{16,}/

/** Longueur au-delà de laquelle un texte n'est plus une notification mais un contenu. */
const MAX_TOAST_LENGTH = 200

export function assertToastText(field: 'title' | 'description', text: string): void {
  if (OPAQUE_VALUE.test(text)) {
    // La valeur n'est **pas** citée : c'est précisément parce qu'elle pourrait être un secret, et
    // le message d'erreur part au log.
    throw new Error(
      `Toast : le ${field} contient une suite opaque d'au moins seize caractères, qui a la forme ` +
        `d'un secret ou d'un identifiant. Un toast ne porte ni secret ni corps de message ` +
        `(invariants a et b) — dites ce qui a eu lieu, pas ce que cela contenait.`,
    )
  }

  if (text.length > MAX_TOAST_LENGTH) {
    throw new Error(
      `Toast : le ${field} dépasse ${MAX_TOAST_LENGTH} caractères. Un toast annonce un fait ; ` +
        `au-delà, c'est un contenu, et il a sa place dans l'écran plutôt que dans une bulle.`,
    )
  }
}

export type ToastInput = {
  readonly title: string
  readonly description?: string
  readonly severity?: ToastSeverity
}

/**
 * Le hook que les écrans appellent.
 *
 * Enveloppe `useToastManager` de Base UI pour poser la vérification **avant** l'affichage : mise
 * après, elle laisserait le toast paraître puis disparaître, et le refus arriverait trop tard.
 */
export function useToast() {
  const manager = BaseToast.useToastManager()

  return {
    notify({ title, description, severity = 'info' }: ToastInput) {
      assertToastText('title', title)
      if (description !== undefined) assertToastText('description', description)

      manager.add({ title, description, data: { severity } })
    },
  }
}

export const ToastProvider = BaseToast.Provider

/** La pile, à poser une fois dans l'AppShell (step-040). */
export function ToastStack() {
  const { toasts } = BaseToast.useToastManager()

  return (
    <BaseToast.Portal>
      <BaseToast.Viewport className="ui-toasts">
        {toasts.map((toast) => {
          const severity = (toast.data as { severity?: ToastSeverity } | undefined)?.severity
          return (
            <BaseToast.Root
              className={`ui-toast ui-toast--${severity ?? 'info'}`}
              key={toast.id}
              toast={toast}
            >
              <BaseToast.Title className="ui-toast__title" />
              <BaseToast.Description className="ui-toast__description" />
              {/*
                Un enfant visible plutôt qu'un `aria-label` : la charte n'a pas de glyphe de croix
                hors du jeu d'`Icon`, que la step-041 n'a pas porté, et le mot fait le travail.
                
                À savoir : **Base UI pose `aria-hidden` sur ce bouton** — constaté en inspectant le
                DOM rendu. Le toast est annoncé d'un bloc et la fermeture au clavier passe par leur
                parcours, plutôt que d'ajouter une cible dans l'arbre pour chaque toast empilé. Un
                `aria-label` ici n'aurait donc rien changé pour un lecteur d'écran.
              */}
              <BaseToast.Close className="ui-toast__close">Fermer</BaseToast.Close>
            </BaseToast.Root>
          )
        })}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  )
}

export type ToastStackProps = { readonly children?: ReactNode }

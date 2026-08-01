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
import { useMemo } from 'react'

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error'

/**
 * Longueur maximale d'un toast. **Sous la taille d'un SMS**, délibérément.
 *
 * Un SMS GSM-7 fait 160 caractères. Une borne à 200 — celle de la première version — laissait donc
 * passer un corps de message **entier**, alors que le commentaire du test affirmait le contraire.
 * 120 est au-dessus de toute annonce légitime (« Identifiant renouvelé. L'ancien secret cesse d'être
 * accepté dans 24 heures. » en fait 74) et en dessous du volume qu'on cite sans y penser.
 */
const MAX_TOAST_LENGTH = 120

/**
 * Un segment cité. **C'est le vrai signal**, et il vaut mieux que n'importe quelle heuristique de
 * forme : un toast annonce un fait, il ne rapporte jamais un contenu. La phrase que l'en-tête de ce
 * fichier dit vouloir empêcher — « Le message "RDV demain 14h" a été renvoyé » — se reconnaît à ses
 * guillemets, pas à la forme de ce qu'ils entourent.
 */
const QUOTED_SEGMENT = /[«"„][^»"]{3,}[»"]/

/**
 * ## Ce que cette garde peut, et ce qu'elle ne peut pas
 *
 * Elle ne peut **pas** décider si une chaîne est un corps de message : « RDV demain » et « Rotation
 * effectuée » ont la même forme. Une première version prétendait le contraire, par une heuristique
 * de « suite opaque de seize caractères », et se trompait dans les deux sens :
 *
 * - un MSISDN plafonne à quinze chiffres (E.164), donc **aucun** n'était jamais attrapé ;
 * - un corps de SMS est fait de mots séparés par des espaces, donc il passait ;
 * - un UUID en fait trente-six, tous dans la classe — et le contrat en déclare **125**. Le premier
 *   écran qui aurait écrit `notify({ title: \`Client ${id} suspendu\` })` aurait donc levé en plein
 *   gestionnaire de clic, sur une copie parfaitement conforme à CLAUDE.md.
 *
 * Elle protégeait donc l'inverse de ce qu'elle annonçait. Ce qui reste ici est ce qui se décide
 * vraiment : **la longueur** et **la citation**. Le reste tient à ce que l'appelant annonce ce qui a
 * eu lieu, et la seule défense qui le garantirait est un catalogue fermé de messages — à poser quand
 * les écrans existeront (step-06x), pas à simuler par une expression régulière.
 */
export function assertToastText(field: 'title' | 'description', text: string): void {
  if (QUOTED_SEGMENT.test(text)) {
    // La citation n'est **pas** reproduite dans l'erreur : c'est précisément parce qu'elle pourrait
    // être un corps de message, et le message d'erreur part au log.
    throw new Error(
      `Toast : le ${field} cite un contenu entre guillemets. Un toast annonce un fait, il ne ` +
        `rapporte jamais ce qu'un message contenait (invariants a et b).`,
    )
  }

  if (text.length > MAX_TOAST_LENGTH) {
    throw new Error(
      `Toast : le ${field} dépasse ${MAX_TOAST_LENGTH} caractères — un SMS en fait 160. ` +
        `Un toast annonce un fait ; au-delà, c'est un contenu, et sa place est dans l'écran.`,
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

  // Mémoïsé : sans cela `notify` change d'identité à chaque rendu, et un `useEffect` qui en dépend
  // boucle indéfiniment — le genre de défaut qui se découvre en production, jamais en test.
  return useMemo(
    () => ({
      notify({ title, description, severity = 'info' }: ToastInput) {
        assertToastText('title', title)
        if (description !== undefined) assertToastText('description', description)

        manager.add({ title, description, data: { severity } })
      },
    }),
    [manager],
  )
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
                
                Base UI pose `aria-hidden` sur ce bouton, mais **conditionnellement** —
                `!expanded && !hasFocus` dans `ToastClose.mjs`. Il retombe donc dans l'arbre dès
                qu'il reçoit le focus, et c'est ce texte qui lui donne alors son nom accessible. Une
                première version de ce commentaire le disait masqué en permanence : c'était faux, et
                cela dissuadait d'écrire le test clavier — qui existe désormais.
              */}
              <BaseToast.Close className="ui-toast__close">Fermer</BaseToast.Close>
            </BaseToast.Root>
          )
        })}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  )
}

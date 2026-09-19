import { Toast as BaseToast } from '@base-ui/react/toast'
import type { ReactNode } from 'react'
import { Icon } from './icon'

/**
 * Les toasts : éphémères, auto-disparaissants, toujours fermables.
 *
 * ## La source est la moitié de l'information
 *
 * Un toast dit **quoi**, et **qui l'a détecté**. Les deux étages ne se réparent pas pareil :
 * Alertmanager évalue les alertes d'infrastructure *indépendamment de la disponibilité du tableau de
 * bord*, le BFF évalue les alertes métier sur une source durable. Un opérateur réveillé à 3 h doit
 * savoir lequel des deux parle avant de savoir quoi faire — d'où le bleu et le violet, que la charte
 * fixe et que `--source-alertmanager` / `--source-bff` portaient sans qu'aucune règle ne les
 * consomme.
 *
 * ## Les rôles viennent de Base UI, et c'est un écart assumé avec le kit
 *
 * Le `Toast.jsx` de la charte pose `role="status"` sur le toast. Base UI suit le motif APG : le
 * **viewport** porte `role="region"` + `aria-live="polite"`, et chaque toast `role="dialog"` — ou
 * `alertdialog` en priorité haute, donc pour `critical`. C'est
 * ce motif qui rend le bouton Fermer atteignable au clavier — reposer `role="status"` par-dessus le
 * casserait, et « toujours fermable » cesserait d'être vrai pour qui n'a pas de souris. Le kit
 * `.jsx` n'est pas du code de production : il montre une apparence, et n'a jamais eu ni piège de
 * focus ni parcours clavier.
 *
 * Le viewport tient son nom, « Notifications », du défaut de Base UI — déjà du français. Le test de
 * la région le fixe, et rougira si une montée de version le change.
 */

/** Les quatre du kit. Pas de `danger` ni d'`error` : `critical` est le mot de la charte. */
export type ToastSeverity = 'info' | 'success' | 'warning' | 'critical'

/**
 * Qui a détecté.
 *
 * Union fermée, comme `GlyphName` : une valeur venue d'une charge utile n'atteint ce type qu'au prix
 * d'un `as` visible en revue. Le kit de la charte en emploie une troisième, `audit_log`, sur des
 * toasts de confirmation d'action — elle arrivera avec le centre de notifications, qui est le
 * premier à en avoir besoin, plutôt qu'en énumération devinée d'avance.
 */
export type ToastSource = 'alertmanager' | 'bff'

export type ToastData = {
  readonly source?: ToastSource
}

/** Neuf secondes pour une alerte critique, six pour le reste. La charte : « éphémères ». */
export const TOAST_TIMEOUT = { critical: 9000, default: 6000 } as const

/**
 * Pousse un toast, avec la durée que sa sévérité commande.
 *
 * Une fonction plutôt qu'une abstraction : c'est l'API que la WebSocket appellera quand elle
 * alimentera la pile, et elle n'a rien à porter de plus aujourd'hui.
 */
export function useToast() {
  const manager = BaseToast.useToastManager()

  return (toast: {
    readonly title: string
    readonly description?: string
    readonly severity?: ToastSeverity
    readonly source?: ToastSource
  }) => {
    const severity = toast.severity ?? 'info'

    return manager.add<ToastData>({
      data: { source: toast.source },
      description: toast.description,
      priority: severity === 'critical' ? 'high' : 'low',
      timeout: severity === 'critical' ? TOAST_TIMEOUT.critical : TOAST_TIMEOUT.default,
      title: toast.title,
      type: severity,
    })
  }
}

export type ToastStackProps = {
  /**
   * Ce que la pile surplombe. `useToast` n'est appelable que **sous** ce composant — c'est la
   * contrainte du fournisseur de Base UI, et la raison pour laquelle step-040 le monte au niveau de
   * la coquille et non dans un coin de l'écran.
   */
  readonly children?: ReactNode
}

/**
 * La pile, en bas à droite.
 *
 * Plafonnée à trois : au-delà, l'opérateur ne lit plus, il subit. Base UI marque les excédentaires
 * `data-limited` **sans cesser de les rendre** — c'est la feuille qui les retire, et sans cette
 * règle le plafond ne plafonnerait rien à l'écran.
 */
export function ToastStack({ children }: ToastStackProps) {
  return (
    <BaseToast.Provider limit={3}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="ui-toaststack">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager<ToastData>()

  return (
    <>
      {toasts.map((toast) => (
        <BaseToast.Root
          className={['ui-toast', `ui-toast--${toast.type ?? 'info'}`].join(' ')}
          key={toast.id}
          toast={toast}
        >
          <span className="ui-toast__dot" />

          <div className="ui-toast__body">
            <BaseToast.Title className="ui-toast__title" />
            <BaseToast.Description className="ui-toast__text" />
            {toast.data?.source === undefined ? null : (
              // `source · alertmanager` plutôt que `alertmanager` seul : le mot qualifie la valeur,
              // et sans lui la pastille colorée se lit comme un statut de plus.
              <span
                className={['ui-toast__source', `ui-toast__source--${toast.data.source}`].join(' ')}
              >
                source · {toast.data.source}
              </span>
            )}
          </div>

          <BaseToast.Close aria-label="Fermer" className="ui-toast__close">
            <Icon name="times" size={13} />
          </BaseToast.Close>
        </BaseToast.Root>
      ))}
    </>
  )
}

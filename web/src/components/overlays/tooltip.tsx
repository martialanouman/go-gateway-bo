/**
 * L'infobulle — **jamais porteuse d'une information nécessaire**.
 *
 * Elle n'apparaît ni au toucher ni au lecteur d'écran dans les mêmes conditions qu'à la souris. Ce
 * qu'un opérateur doit savoir pour agir vit donc dans le libellé ou dans l'aide du champ ; l'infobulle
 * ne porte que le complément — le nom complet d'un contrôle réduit à une icône, la valeur exacte
 * derrière un nombre arrondi.
 *
 * `Tooltip.Provider` doit envelopper l'application une fois (step-040) : il partage le délai
 * d'ouverture entre toutes les infobulles, de sorte que parcourir une barre d'outils n'ouvre pas six
 * bulles successives.
 */

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

export type TooltipProps = {
  readonly content: ReactNode
  /**
   * L'élément déclencheur — **il devient le déclencheur lui-même**, il n'est pas enveloppé.
   *
   * Une première version l'entourait d'un `<span>` : le `<span>` recevait alors les gestionnaires,
   * et l'élément réellement focusable de l'appelant restait à côté. L'infobulle ne s'ouvrait donc
   * qu'au survol — or la WCAG 1.4.13 demande que ce qui apparaît au survol apparaisse aussi au
   * focus, sans quoi elle n'existe pas pour qui navigue au clavier.
   *
   * Il doit donc être focusable : un `<button>`, un lien, ou un élément portant `tabIndex`.
   */
  readonly children: ReactElement
  readonly className?: string
}

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        className={['ui-tooltip__trigger', className].filter(Boolean).join(' ')}
        render={children}
      />

      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className="ui-tooltip__positioner" sideOffset={6}>
          <BaseTooltip.Popup className="ui-tooltip">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

/** À poser une fois autour de l'application — voir l'en-tête. */
export const TooltipProvider = BaseTooltip.Provider

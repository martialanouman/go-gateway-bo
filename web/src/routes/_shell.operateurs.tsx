/**
 * `/operateurs` — qui accède à la console, et avec quels droits.
 *
 * **La route déclare, le composant fait.** L’écran vit dans `~/components/admin/operators-screen.tsx` :
 * monté hors du routeur, il se teste avec ses modales, ce que `renderRoute` ne permet pas — son
 * arbre monte un document à deux racines, où une surface flottante de Base UI fait boucler le
 * processus. Ce fichier ne garde que ce qui donne son URL à l’écran.
 */

import { createFileRoute } from '@tanstack/react-router'
import { OperateursScreen } from '~/components/admin/operators-screen'

export const Route = createFileRoute('/_shell/operateurs')({
  component: OperateursScreen,
})

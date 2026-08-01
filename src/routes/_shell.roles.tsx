/**
 * `/roles` — les paquets de permissions, et qui les porte.
 *
 * **La route déclare, le composant fait.** L’écran vit dans `~/components/admin/roles-screen.tsx` :
 * monté hors du routeur, il se teste avec ses modales, ce que `renderRoute` ne permet pas — son
 * arbre monte un document à deux racines, où une surface flottante de Base UI fait boucler le
 * processus. Ce fichier ne garde que ce qui donne son URL à l’écran.
 */

import { createFileRoute } from '@tanstack/react-router'
import { RolesScreen } from '~/components/admin/roles-screen'

export const Route = createFileRoute('/_shell/roles')({
  component: RolesScreen,
})

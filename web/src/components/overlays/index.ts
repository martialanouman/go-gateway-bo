/**
 * Les surfaces flottantes (step-042).
 *
 * Elles ont un point commun qui justifie de les grouper : toutes vivent dans un portail, donc hors
 * de l'arbre du composant qui les ouvre. C'est ce qui rend leur accessibilité fragile — focus,
 * inertie du fond, retour au déclencheur — et c'est pourquoi aucune n'est écrite à la main.
 */

export { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog'
export { Dialog, type DialogProps } from './dialog'
export { DropdownMenu, type DropdownMenuProps, type MenuAction } from './dropdown-menu'
export { Popover, type PopoverProps } from './popover'
export {
  assertToastText,
  type ToastInput,
  ToastProvider,
  type ToastSeverity,
  ToastStack,
  useToast,
} from './toast'
export { Tooltip, type TooltipProps, TooltipProvider } from './tooltip'

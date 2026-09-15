/**
 * La façade des primitives.
 *
 * Un écran importe d'ici, jamais d'un fichier : le découpage en modules sert à écrire, pas à
 * consommer, et un import profond fige un chemin qu'on ne pourra plus déplacer sans toucher chaque
 * appelant.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './button'
export {
  type DataColumn,
  DataTable,
  type DataTableProps,
  type SortDirection,
} from './data-table'
export { Field, type FieldProps, Input, type InputProps } from './field'
export {
  Dot,
  type DotProps,
  type DotTone,
  GLYPH_NAMES,
  type GlyphName,
  Icon,
  type IconProps,
} from './icon'
export { Select, type SelectOption, type SelectProps } from './select'
export {
  type BreakerState,
  type DeliveryStatus,
  type EntityStatus,
  type LinkStatus,
  StatusPill,
  type StatusPillProps,
} from './status-pill'
export { type TabDefinition, Tabs, type TabsProps } from './tabs'

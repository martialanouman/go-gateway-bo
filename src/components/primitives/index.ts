/**
 * Les primitives du lot 1 (step-041).
 *
 * Un point d'entrée unique pour que les écrans écrivent `~/components/primitives` plutôt que sept
 * chemins de fichier — et surtout pour que l'ajout d'une primitive se voie ici, dans un diff court,
 * au lieu de se diluer dans un import de plus au milieu d'un écran.
 *
 * Les surfaces flottantes et les cinq états de contenu arrivent en step-042.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './button'
export { Checkbox, type CheckboxProps } from './checkbox'
export { RadioGroup, type RadioGroupProps, type RadioOption } from './radio-group'
export { Select, type SelectOption, type SelectProps } from './select'
export { type BreakerState, StatusPill, type StatusPillProps } from './status-pill'
export { Switch, type SwitchProps } from './switch'
export { type SortDirection, Table, type TableColumn, type TableProps } from './table'
export { type TabDefinition, Tabs, type TabsProps } from './tabs'
export { TextField, type TextFieldProps } from './text-field'

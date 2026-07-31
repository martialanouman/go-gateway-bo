/**
 * Le rendu par permission (step-040, remonté de step-026).
 *
 * Il vit ici plutôt qu'en step-026 parce que le rail de navigation en a besoin dès qu'il existe :
 * livrer une navigation qui montre des entrées inutilisables, puis la corriger, aurait été une
 * régression inscrite au plan.
 */

export { PermissionGate, type PermissionGateProps } from './permission-gate'
export {
  type CurrentOperator,
  OPERATOR_QUERY_KEY,
  type PermissionState,
  useCurrentOperator,
  usePermission,
} from './use-permission'

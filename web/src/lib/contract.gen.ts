/**
 * Ce fichier est engendré à partir des corps de requête d'api/openapi-bff.yaml, qui fait foi. Le
 * modifier à la main n'a aucun effet durable : la génération suivante l'écrase.
 *
 * Ce qu'il porte sont les **bornes du contrat**, celles qu'openapi-typescript jette en ne gardant
 * que la forme. Ce qui ne décrit aucun contrat — un format d'adresse, deux champs qui concordent —
 * s'écrit à la main, à côté du formulaire qui l'exige.
 *
 * Le régénérer :   make generate
 * Ou directement : go run ./cmd/zodgen api/openapi-bff.yaml web/src/lib/contract.gen.ts
 */

import { z } from 'zod'

export const AccessLinkUse = z.object({
  password: z.string().max(4096),
  token: z.string().max(64),
})

export const AccountChannels = z.object({
  restEnabled: z.boolean(),
  smppEnabled: z.boolean(),
})

export const AccountCreation = z.object({
  customerId: z.string(),
  name: z.string().min(1),
})

export const AccountSessionLimits = z.object({
  allowedBindTypes: z.enum(['tx', 'rx', 'trx']),
  maxSessions: z.number().int().min(0),
})

export const AccountSmppOps = z.object({
  cancelSmEnabled: z.boolean(),
  querySmEnabled: z.boolean(),
})

export const CredentialCreation = z.object({
  systemId: z.string().min(1).max(15).optional(),
  type: z.enum(['smpp_bind', 'api_key']),
})

export const CredentialRotation = z.object({
  gracePeriodSec: z.number().int().min(0).max(604800).optional(),
})

export const CustomerCreation = z.object({
  groupId: z.string().optional(),
  name: z.string().min(1),
})

export const CustomerGroupAssignment = z.object({
  groupId: z.string().optional(),
})

export const CustomerGroupCreation = z.object({
  description: z.string().optional(),
  name: z.string().min(1),
})

export const CustomerGroupUpdate = z.object({
  description: z.string().optional(),
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'archived']).optional(),
})

export const CustomerUpdate = z.object({
  name: z.string().min(1),
})

export const LoginRequest = z.object({
  email: z.string().max(320),
  password: z.string().min(1).max(4096),
})

export const MfaVerification = z.object({
  assertion: z.record(z.string(), z.unknown()).optional(),
  challenge: z.string().min(43).max(64),
  code: z.string().min(1).max(64).optional(),
  method: z.enum(['totp', 'recovery_code', 'webauthn']),
})

export const OperatorCreation = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().min(3).max(320),
})

export const OperatorRoles = z.object({
  roleIds: z.array(z.string()).max(100),
})

export const OperatorUpdate = z.object({
  status: z.enum(['active', 'disabled']),
})

export const RoleCreation = z.object({
  description: z.string().max(500),
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).max(100),
})

export const RoleUpdate = z.object({
  description: z.string().max(500),
  permissions: z.array(z.string()).max(100),
})

export const SenderIdCreation = z.object({
  address: z
    .string()
    .min(2)
    .max(11)
    .regex(/^[a-zA-Z0-9+\-\s]+$/),
})

export const SenderIdRateLimitSetting = z.object({
  burstCapacity: z.number().int().min(1).max(2.147483647e9).optional(),
  maxPerSec: z.number().int().min(1).max(2.147483647e9),
})

export const SenderIdUpdate = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  trafficCategory: z.enum(['otp', 'transactional', 'marketing']).optional(),
})

export const TotpConfirmation = z.object({
  code: z.string().min(1).max(64),
})

export const TotpEnrollmentRequest = z.object({
  code: z.string().min(1).max(64).optional(),
  method: z.enum(['totp', 'recovery_code']).optional(),
})

export const WebauthnRegistration = z.object({
  attestation: z.record(z.string(), z.unknown()),
  name: z.string().min(1).max(64),
})

export const WebhookCreation = z.object({
  eventType: z.enum(['mo', 'dlr']),
  url: z.string().regex(/^https?:\/\/[^\/]/),
})

export const WebhookUpdate = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  url: z
    .string()
    .regex(/^https?:\/\/[^\/]/)
    .optional(),
})

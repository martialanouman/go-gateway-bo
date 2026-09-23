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

export const LoginRequest = z.object({
  email: z.string().max(320),
  password: z.string().min(1).max(4096),
})

export const MfaVerification = z.object({
  assertion: z.record(z.string(), z.unknown()).optional(),
  challenge: z.string().min(43),
  code: z.string().min(1).max(64).optional(),
  method: z.enum(['totp', 'recovery_code', 'webauthn']),
})

export const OperatorCreation = z.object({
  displayName: z.string().min(1).max(200),
  email: z.string().min(3).max(320),
  password: z.string().min(12).max(4096),
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

export const TotpEnrollmentRequest = z.object({
  code: z.string().min(1).max(64).optional(),
  method: z.enum(['totp', 'recovery_code']).optional(),
})

export const WebauthnRegistration = z.object({
  attestation: z.record(z.string(), z.unknown()),
})

/**
 * Opérateurs, rôles et permissions — l'identité côté tableau de bord.
 *
 * Ces tables n'ont pas d'équivalent dans la passerelle : elle ne connaît qu'un client machine à
 * scopes fixes. Qui est un opérateur, ce qu'il a le droit de faire, et la trace de ce qu'il a fait
 * n'existent qu'ici (invariant c).
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/** Identifiant plateforme : UUIDv7, généré par PostgreSQL 18 qui l'expose en fonction native. */
export const uuidv7 = () => uuid().primaryKey().default(sql`uuidv7()`)

export const operatorStatus = pgEnum('operator_status', ['active', 'disabled'])

export const permissionCategory = pgEnum('permission_category', [
  'routing',
  'connectors',
  'sessions',
  'antispam',
  'accounts',
  'billing',
  'content',
  'compliance',
  'alerts',
  'audit',
  'admin',
])

export const operators = pgTable(
  'operators',
  {
    id: uuidv7(),
    email: text().notNull().unique(),
    displayName: text('display_name').notNull(),

    // ─── Colonnes de secret ───────────────────────────────────────────────────────────────────
    // Ces deux-là ne sortent jamais d'une fonction serveur. Un `SELECT *` qui remonterait jusqu'à
    // une réponse HTTP les emporterait avec lui : les lectures destinées à l'interface passent par
    // `operatorSafeColumns` ci-dessous, jamais par la table entière.
    passwordHash: text('password_hash').notNull(),
    mfaTotpSecret: text('mfa_totp_secret'),
    // ──────────────────────────────────────────────────────────────────────────────────────────

    /** Authentificateurs WebAuthn enregistrés (step-024). Aucune clé privée : que des clés publiques. */
    mfaWebauthnCredentials: jsonb('mfa_webauthn_credentials').notNull().default(sql`'[]'::jsonb`),
    status: operatorStatus().notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('operators_status_idx').on(table.status)],
)

/**
 * Les colonnes d'un opérateur qu'une réponse peut porter. À utiliser dans tout `select()` dont le
 * résultat quitte le BFF — c'est ce qui rend l'oubli visible à la relecture plutôt qu'invisible
 * dans un `select()` sans argument.
 */
export const operatorSafeColumns = {
  id: operators.id,
  email: operators.email,
  displayName: operators.displayName,
  status: operators.status,
  lastLoginAt: operators.lastLoginAt,
  createdAt: operators.createdAt,
} as const

/**
 * Catalogue figé, versionné avec les livraisons — jamais éditable depuis l'interface. Une
 * permission qui s'ajoute est une ligne de seed **et** une garde serveur **et** une ligne dans le
 * tableau des rôles par défaut : les trois dans la même PR, sinon la permission existe sans rien
 * garder.
 */
export const permissions = pgTable('permissions', {
  key: text().primaryKey(),
  category: permissionCategory().notNull(),
  description: text().notNull(),
})

export const roles = pgTable('roles', {
  id: uuidv7(),
  name: text().notNull().unique(),
  description: text().notNull(),
  /** Rôle livré avec le produit, par opposition à un rôle créé par un administrateur (step-020). */
  isDefault: boolean('is_default').notNull().default(false),
  createdBy: uuid('created_by').references(() => operators.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionKey] })],
)

export const operatorRoles = pgTable(
  'operator_roles',
  {
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.operatorId, table.roleId] })],
)

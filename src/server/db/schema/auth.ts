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
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
    /**
     * Identifiant de connexion. L'unicité est posée sur `lower(email)` plus bas, et non par un
     * `.unique()` sur la colonne : `Alice@corp.fr` et `alice@corp.fr` passeraient sinon pour deux
     * opérateurs distincts. Sur une colonne d'identité, c'est un défaut de sécurité — un doublon
     * peut masquer un compte existant, et l'opérateur qui tape une majuscule ne se connecte plus.
     */
    email: text().notNull(),
    displayName: text('display_name').notNull(),

    // ─── Colonnes de secret ───────────────────────────────────────────────────────────────────
    // Ces deux-là ne sortent jamais d'une fonction serveur. Un `SELECT *` qui remonterait jusqu'à
    // une réponse HTTP les emporterait avec lui : les lectures destinées à l'interface passent par
    // `operatorSafeColumns` ci-dessous, jamais par la table entière.
    passwordHash: text('password_hash').notNull(),
    /**
     * Secret TOTP partagé, **chiffré au repos** — l'enveloppe AES-256-GCM de `mfa-secret.ts`, jamais
     * la valeur nue. Contrairement à `password_hash`, ce n'est pas un condensat : il est exploitable
     * tel quel, et en clair une lecture de la base — dump, réplica, sauvegarde — donnerait des codes
     * valides pour tous les opérateurs.
     *
     * Non nul **ne veut pas dire enrôlé** : l'enrôlement écrit d'abord le secret, puis attend un
     * premier code valide. Seule `mfa_totp_activated_at` dit qu'un second facteur existe.
     */
    mfaTotpSecret: text('mfa_totp_secret'),
    // ──────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Non nul une fois l'enrôlement confirmé par un premier code. **C'est la seule marque qui
     * compte** : un secret écrit mais jamais confirmé ne vaut rien — l'application authenticator
     * n'a peut-être pas scanné le QR code, et exiger ce code-là est ce qui empêche d'enfermer
     * quelqu'un dehors avec un facteur qu'il ne détient pas.
     */
    mfaTotpActivatedAt: timestamp('mfa_totp_activated_at', { withTimezone: true }),

    /**
     * Dernier pas de temps TOTP consommé (RFC 6238 : `floor(temps unix / 30)`), et le seul état de
     * l'**anti-rejeu**.
     *
     * Sans lui, un code reste valide pendant toute sa fenêtre : qui le lit par-dessus une épaule ou
     * dans un canal de support le rejoue. En base plutôt qu'en mémoire de process parce que la
     * console tourne à ≥2 instances — un marqueur local se contournerait en changeant d'instance,
     * c'est-à-dire en rechargeant la page.
     *
     * `integer` suffit : le pas courant vaut environ 5,8 × 10⁷, et la borne de PostgreSQL est
     * atteinte au quarantième siècle.
     */
    mfaTotpLastStep: integer('mfa_totp_last_step'),

    /** Authentificateurs WebAuthn enregistrés (step-024). Aucune clé privée : que des clés publiques. */
    mfaWebauthnCredentials: jsonb('mfa_webauthn_credentials').notNull().default(sql`'[]'::jsonb`),
    status: operatorStatus().notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unicité insensible à la casse : voir le commentaire de `email`. Le faire maintenant coûte une
    // ligne ; après les seeds de step-020, ce serait une migration de données.
    uniqueIndex('operators_email_lower_idx').on(sql`lower(${table.email})`),
  ],
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
 * Les codes de récupération — la porte de sortie quand le téléphone est perdu, cassé ou volé.
 *
 * Sans eux, un opérateur qui perd son appareil perd la console, et il faut une intervention en base
 * pour l'y remettre. Autant dire qu'en pratique on créerait une commande de contournement, laquelle
 * deviendrait le vrai moyen d'entrer.
 *
 * ## Hachés, jamais chiffrés — et pas avec la même mécanique qu'un mot de passe
 *
 * Un HMAC-SHA-256 sous un poivre serveur (voir `mfa-secret.ts`), pas un scrypt. Deux raisons, et la
 * première suffit : un code fait cinquante bits tirés au hasard, il ne se casse pas par
 * dictionnaire — ce que scrypt existe pour ralentir n'existe pas ici. La seconde est
 * opérationnelle : un opérateur détient dix codes, et vérifier lequel il a saisi coûterait dix
 * scrypt, soit près de deux secondes par tentative. Le HMAC, lui, se retrouve par égalité, donc par
 * index.
 *
 * ## `used_at` plutôt qu'une suppression
 *
 * Un code consommé reste visible : « il en reste trois » est une information que l'interface doit
 * pouvoir donner, et la ligne datée est ce que le journal d'audit référencera (step-025). La
 * consommation est une écriture conditionnelle — c'est elle qui rend l'usage unique vrai entre
 * instances, pas une lecture suivie d'une écriture.
 */
export const operatorRecoveryCodes = pgTable(
  'operator_recovery_codes',
  {
    id: uuidv7(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    /** HMAC-SHA-256 du code normalisé, sous le poivre serveur. Jamais le code lui-même. */
    codeHash: text('code_hash').notNull(),
    /** Non nul dès la première utilisation. C'est ce qui rend le code à usage **unique**. */
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // La recherche se fait toujours par (opérateur, condensat) : l'unicité sert ici d'index et
    // interdit au passage qu'un même code soit inscrit deux fois pour le même opérateur — ce qui
    // ferait qu'un « usage unique » en vaudrait deux.
    uniqueIndex('operator_recovery_codes_operator_hash_idx').on(table.operatorId, table.codeHash),
  ],
)

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

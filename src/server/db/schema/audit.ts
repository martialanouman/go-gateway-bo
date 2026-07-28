/**
 * Journal d'audit.
 *
 * Toute mutation passant par le BFF y laisse une ligne — c'est la moitié « traçabilité » de
 * l'invariant (c), et la seule preuve de qui a fait quoi, la passerelle ne voyant qu'un client
 * machine anonyme. La lecture du corps d'un message (`content.read`) s'y inscrit comme une action
 * à part entière : c'est ce qui rend l'invariant (a) vérifiable après coup.
 *
 * **Cette table est partitionnée par mois**, ce que Drizzle ne sait pas déclarer : la définition
 * ci-dessous décrit la table *logique*, et le DDL réel vit dans une migration écrite à la main
 * (`drizzle/0001_audit_log_partitionne.sql`). Deux conséquences visibles ici :
 *
 * 1. **La clé primaire est composite `(id, created_at)`.** PostgreSQL impose que la clé de
 *    partitionnement figure dans toute contrainte d'unicité. `id` reste unique en pratique — c'est
 *    un UUIDv7 — mais le typage doit refléter la contrainte réelle, sinon il ment.
 * 2. `before_json` / `after_json` ne portent **jamais** le corps d'un message. Un diff d'entité de
 *    contrôle, jamais un contenu (invariant a).
 */

import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { operators } from './auth'

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().notNull().default(sql`uuidv7()`),
    /** Nullable : une action déclenchée par l'évaluateur d'alertes n'a pas d'opérateur. */
    operatorId: uuid('operator_id').references(() => operators.id, { onDelete: 'set null' }),
    /** Verbe stable et greppable : `route.update`, `credentials.rotate`, `content.read`. */
    action: text().notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /**
     * État avant / après de l'entité de contrôle touchée. Jamais un corps de message, jamais un
     * secret : une rotation d'identifiant journalise qu'elle a eu lieu, pas ce qu'elle a produit
     * (invariants a et b).
     */
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.createdAt] }),
    // L'écran de consultation (step-184) filtre par opérateur et par période, et lit toujours du
    // plus récent au plus ancien.
    index('audit_log_created_at_idx').on(table.createdAt.desc()),
    index('audit_log_operator_idx').on(table.operatorId, table.createdAt.desc()),
    index('audit_log_action_idx').on(table.action, table.createdAt.desc()),
  ],
)

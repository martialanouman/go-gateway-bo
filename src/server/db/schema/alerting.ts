/**
 * Règles d'alerte métier et notifications.
 *
 * `evaluation_owner` porte une frontière qui n'est pas négociable : les métriques d'infrastructure
 * sont évaluées par **Alertmanager**, indépendant du tableau de bord, et les métriques de domaine
 * par le BFF. Une panne du tableau de bord ne doit jamais faire taire la détection d'incident
 * (invariant e) — si tout était évalué ici, le silence de l'outil se lirait comme « tout va bien ».
 */

import { sql } from 'drizzle-orm'
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { operators, uuidv7 } from './auth'

export const alertScope = pgEnum('alert_scope', ['global', 'connector', 'account'])

/** Qui évalue la règle. Voir le docstring : cette colonne est une frontière de fiabilité. */
export const alertEvaluationOwner = pgEnum('alert_evaluation_owner', ['alertmanager', 'bff'])

export const alertRuleStatus = pgEnum('alert_rule_status', ['active', 'disabled'])

export const notificationSource = pgEnum('notification_source', [
  'alertmanager',
  'bff_evaluator',
  'billing_alert_stream',
])

export const notificationSeverity = pgEnum('notification_severity', ['info', 'warning', 'critical'])

export const alertRules = pgTable(
  'alert_rules',
  {
    id: uuidv7(),
    /** Identifiant technique verbatim : `connector.error_rate`, `billing.mt_balance_low`. */
    metric: text().notNull(),
    scope: alertScope().notNull().default('global'),
    /** Vide pour une règle globale ; l'identifiant du connecteur ou du compte sinon. */
    scopeId: text('scope_id'),
    evaluationOwner: alertEvaluationOwner('evaluation_owner').notNull(),
    conditionJson: jsonb('condition_json').notNull(),
    notifyChannelsJson: jsonb('notify_channels_json').notNull().default(sql`'[]'::jsonb`),
    status: alertRuleStatus().notNull().default('active'),
    createdBy: uuid('created_by').references(() => operators.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('alert_rules_scope_idx').on(table.scope, table.scopeId)],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuidv7(),
    /** Vide pour une notification qui ne vient pas d'une règle du tableau de bord. */
    alertRuleId: uuid('alert_rule_id').references(() => alertRules.id, { onDelete: 'set null' }),
    source: notificationSource().notNull(),
    severity: notificationSeverity().notNull(),
    message: text().notNull(),
    /** Opérateurs ayant marqué la notification comme lue (step-046). */
    readByOperators: jsonb('read_by_operators').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_created_at_idx').on(table.createdAt.desc())],
)

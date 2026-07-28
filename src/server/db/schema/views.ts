/**
 * Vues sauvegardées : les filtres qu'un opérateur veut retrouver d'un jour à l'autre.
 *
 * Ne contiennent que des **critères**, jamais de résultats. Une recherche CDR sauvegardée garde
 * « expéditeur = X, statut = échec, sur 24 h », et rien de ce que cette recherche a ramené — les
 * données de la passerelle se relisent à chaque affichage et ne se recopient jamais ici (§3.2).
 */

import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { operators, uuidv7 } from './auth'

export const savedViewType = pgEnum('saved_view_type', ['cdr_search', 'traffic_dashboard'])

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuidv7(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    viewType: savedViewType('view_type').notNull(),
    name: text().notNull(),
    filtersJson: jsonb('filters_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('saved_views_operator_idx').on(table.operatorId, table.viewType)],
)

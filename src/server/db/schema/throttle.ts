/**
 * Le compteur d'échecs d'authentification, partagé entre instances.
 *
 * En mémoire de process, ce compteur ne vaudrait rien : le tableau de bord tourne à **≥2 instances**
 * derrière un load balancer, et un attaquant qui alterne les instances multiplierait son quota par
 * leur nombre. Redis serait le magasin naturel, il n'arrive qu'à la step-044 — PostgreSQL fait donc
 * le travail, et il le fait bien : le volume est dérisoire et une transaction y est plus simple à
 * raisonner qu'un compteur distribué.
 *
 * ## Ce que `subject` contient, et pourquoi ce n'est pas la même chose selon la portée
 *
 * - portée `ip` : **l'adresse, en clair**. Un exploitant doit pouvoir lire quelles adresses sont
 *   bloquées, et `audit_log.ip_address` conserve déjà la même donnée.
 * - portée `operator` : un **HMAC-SHA-256 de l'identifiant normalisé**, sous une clé serveur qui ne
 *   vit pas en base. Jamais l'identifiant lui-même.
 *
 * Le HMAC, et pas un condensat nu : un SHA-256 d'adresse email se casse par dictionnaire en quelques
 * secondes, ce qui rendrait le hachage décoratif. La clé le rend inattaquable sans une lecture du
 * fichier d'environnement *en plus* de la base.
 *
 * Et pas l'identifiant en clair, pour une raison qui n'a rien de théorique : cette table accumule ce
 * qui a été **tenté**, pas ce qui existe. Elle recueillerait donc les suppositions d'un attaquant —
 * et, cas parfaitement banal, les mots de passe que des opérateurs tapent dans le champ email par
 * inadvertance. Une table de compteurs deviendrait un magasin de mots de passe en clair.
 *
 * L'asymétrie entre les deux portées est délibérée, et écrite ici pour qu'elle ne se lise pas comme
 * un oubli.
 */

import { integer, pgEnum, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

export const throttleScope = pgEnum('throttle_scope', ['operator', 'ip'])

export const loginAttempts = pgTable(
  'login_attempts',
  {
    scope: throttleScope().notNull(),
    /** Adresse IP en clair, ou HMAC-SHA-256 de l'identifiant — voir l'en-tête. */
    subject: text().notNull(),
    failures: integer().notNull().default(0),
    /**
     * Début de la fenêtre courante. C'est ce qui permet aux échecs de **s'oublier** : sans elle, un
     * opérateur qui se trompe trois fois en six mois finirait verrouillé.
     */
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Non nul tant que la porte est fermée. Le passé vaut ouvert : aucune tâche de nettoyage requise. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Clé composite naturelle : une ligne par (portée, sujet). Un `id` de substitution n'apporterait
  // qu'un index de plus à maintenir.
  (table) => [primaryKey({ columns: [table.scope, table.subject] })],
)

/**
 * Les sessions **d'opérateur** du tableau de bord.
 *
 * Le préfixe n'est pas décoratif : dans ce produit, « session » désigne déjà un **bind SMPP** — le
 * moniteur du §6.5, la permission `sessions:read`, l'action `sessions:disconnect`, l'écart
 * `max_sessions`. Une table nommée `sessions` aurait fait cohabiter deux sens du même mot dans le
 * même schéma, et la confusion se serait payée en revue, en requête d'exploitation et en incident.
 *
 * **En base, et pas seulement dans un jeton signé**, parce que le périmètre exige une **révocation
 * immédiate, y compris depuis une autre instance** (§4.1). Un JWT auto-porteur ne se révoque pas :
 * il faudrait une liste de refus, c'est-à-dire cette table, sans les avantages. Le cookie ne porte
 * donc qu'un identifiant signé ; l'autorité reste ici.
 *
 * ## Deux états, et c'est le cœur du modèle
 *
 * `mfa_completed_at` distingue une session **partielle** — le mot de passe est bon, le second
 * facteur non — d'une session **complète**. C'est ce qui donne enfin un état serveur au challenge
 * que la step-021 rendait sans lendemain : la connexion ouvre une session partielle, step-023 et
 * step-024 la promeuvent, et la garde de route n'accepte que les complètes.
 *
 * Une session partielle ne doit ouvrir **aucun écran** : elle ne sert qu'à porter la vérification du
 * second facteur. C'est une garde de route, pas une propriété de cette table — mais elle se lit ici.
 *
 * ## Ce que la table ne contient pas
 *
 * **Aucune permission.** Elles sont résolues à chaque requête depuis les rôles (step-020), pour
 * qu'un retrait de rôle prenne effet sans attendre une reconnexion. Une session qui figerait les
 * permissions ferait survivre un pouvoir révoqué aussi longtemps que le cookie.
 */

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { operators, uuidv7 } from './auth'

export const operatorSessions = pgTable(
  'operator_sessions',
  {
    /**
     * L'identifiant que le cookie transporte, signé. UUIDv7 comme partout — et l'ordonnancement
     * temporel n'est pas un inconvénient ici : la signature empêche de forger un identifiant, et
     * deviner un identifiant existant ne sert à rien sans elle.
     *
     * **Ne sort jamais dans un corps de réponse** : le rendre au navigateur autrement que par le
     * cookie le sortirait de `HttpOnly`, donc le mettrait à portée d'un script injecté.
     */
    id: uuidv7(),
    operatorId: uuid('operator_id')
      .notNull()
      // Supprimer un opérateur emporte ses sessions : sans cascade, un compte effacé garderait des
      // sessions ouvertes pointant dans le vide.
      .references(() => operators.id, { onDelete: 'cascade' }),

    /** Non nul une fois le second facteur passé. Nul = session partielle, qui n'ouvre aucun écran. */
    mfaCompletedAt: timestamp('mfa_completed_at', { withTimezone: true }),

    /**
     * Fin de validité absolue. Distincte du glissement : une session active indéfiniment finirait
     * par valoir un mot de passe permanent.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /**
     * Dernière requête vue. Porte le glissement — mais n'est pas réécrite à chaque requête : une
     * écriture par affichage d'écran ferait de cette table le point chaud du tableau de bord, pour
     * une précision dont personne n'a besoin.
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Le défi d'une cérémonie WebAuthn en cours, et sa date de péremption (step-024).
     *
     * **Côté serveur, et porté par la session** — pas par le client, pas en mémoire de process. Trois
     * propriétés en découlent, et elles sont toutes exigées par la cérémonie :
     *
     * 1. **Usage unique.** La consommation est une écriture conditionnelle qui le remet à `NULL` :
     *    deux réponses portant le même défi ne peuvent pas aboutir toutes les deux, y compris depuis
     *    deux instances.
     * 2. **Durée de vie courte.** L'échéance est vérifiée dans le `WHERE`, jamais après lecture : un
     *    défi périmé n'est pas rendu, il n'existe plus.
     * 3. **Lié à une session.** Un défi émis pour une session ne vaut pour aucune autre, ce qui
     *    interdit de faire valider ailleurs une cérémonie commencée ici.
     *
     * Une colonne plutôt qu'une table : le défi ne survit jamais à la session qui le porte, et une
     * table aurait demandé sa propre purge pour la même durée de vie de quelques minutes.
     */
    webauthnChallenge: text('webauthn_challenge'),
    webauthnChallengeExpiresAt: timestamp('webauthn_challenge_expires_at', { withTimezone: true }),

    /**
     * Non nul dès la déconnexion. On marque plutôt qu'on ne supprime : la ligne reste lisible le
     * temps que le journal d'audit y fasse référence, et la révocation devient un fait daté.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Déconnecter un opérateur de partout — désactivation, changement de rôle sensible — se fait par
    // `operator_id`. Sans cet index, l'opération scannerait la table entière.
    index('operator_sessions_operator_idx').on(table.operatorId),
    // La purge des sessions échues balaie par date ; l'index la garde bornée.
    index('operator_sessions_expires_idx').on(table.expiresAt),
  ],
)

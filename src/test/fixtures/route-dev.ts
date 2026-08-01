/**
 * Un handler h3 tel que le BFF en déclare, réduit à ce qui se vérifie de l'extérieur.
 *
 * Il sert à éprouver le plugin de développement (`src/server/dev-bff-plugin.ts`) sans démarrer le
 * vrai BFF : les vraies routes appellent toutes `getDatabase()` avant toute autre chose, ce qui
 * exige `DATABASE_URL` et joindrait la base à la première requête — le projet `unit` n'en a pas. Ce
 * qu'on veut prouver est ailleurs : qu'une requête atteint le module déclaré, avec sa méthode et sa
 * chaîne de requête.
 *
 * Il n'est déclaré dans aucun `BFF_ROUTES` : le test lui donne sa propre liste.
 */

import { defineEventHandler, getQuery } from 'h3'

export default defineEventHandler((event) => ({
  seen: 'route de développement',
  filter: getQuery(event).filter ?? null,
}))

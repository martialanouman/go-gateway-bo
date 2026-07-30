/**
 * Ce que le bout en bout exige avant de commencer : une base migrée et un compte pour entrer.
 *
 * ## Pourquoi ce fichier existe
 *
 * Les parcours d'authentification ne peuvent pas être simulés — c'est tout leur intérêt. Il faut donc
 * une vraie base, de vraies migrations et un vrai opérateur, ce que la suite de fumée n'avait jamais
 * demandé. Le `webServer` de Playwright reçoit la même `DATABASE_URL` (voir `playwright.config.ts`) :
 * c'est un process séparé, il ne peut pas partager un conteneur démarré depuis un test.
 *
 * La base est celle de `docker-compose.yml`, déjà lancée pour développer (`docker compose up -d`). En
 * CI, un service PostgreSQL du job « Bout en bout » l'expose à la même adresse.
 *
 * ## Le mot de passe est haché avec des paramètres rapides
 *
 * `hashPassword` inscrit ses paramètres **dans** l'empreinte, et la vérification les relit de là. Un
 * amorçage à coût réduit reste donc vérifiable par le vrai chemin de connexion, sans dépenser 166 ms et
 * 128 Mio pour un compte de test — et sans affaiblir quoi que ce soit en production, où les paramètres
 * viennent de la configuration.
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { installFirstAdministrator } from '../src/server/auth/bootstrap'
import { connect } from '../src/server/db/index'

/**
 * L'opérateur que les parcours utilisent.
 *
 * Le mot de passe ne partage **aucun** mot avec l'adresse ni le nom affiché : la politique de step-021
 * refuse le contraire, et elle a refusé la première version de ce fichier — ce qui est exactement son
 * travail.
 */
export const E2E_OPERATOR = {
  email: 'operatrice.e2e@example.test',
  displayName: 'Opératrice de test',
  password: 'cheval batterie agrafe correcte 42',
} as const

/** Paramètres scrypt réduits : voir l'en-tête. */
const FAST_SCRYPT = { N: 1024, r: 8, p: 1 } as const

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL est requise pour le bout en bout.')

  const { client, db } = connect(url, { poolSize: 2 })

  try {
    await migrate(db, { migrationsFolder: './drizzle' })

    // Repartir d'une table vide : l'amorçage refuse de s'exécuter dès qu'un opérateur existe, et c'est
    // une garde de production qu'on ne contourne pas — on lui rend simplement une installation neuve.
    await client`DELETE FROM operators`

    await installFirstAdministrator(db, { ...E2E_OPERATOR }, FAST_SCRYPT)
  } finally {
    await client.end({ timeout: 5 })
  }
}

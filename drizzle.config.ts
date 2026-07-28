import { defineConfig } from 'drizzle-kit'

// Les migrations sont **générées, relues et commitées**. Il n'y a volontairement aucun script
// `drizzle-kit push` dans ce dépôt : `push` compare le schéma TypeScript à la base et applique la
// différence sans laisser de trace, ce qui rendrait l'état de la production indéductible de
// l'historique — et détruirait la table `audit_log` partitionnée, dont le DDL réel est écrit à la
// main et que Drizzle ne sait pas exprimer.
export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://dashboard:dashboard@localhost:5432/dashboard',
  },
  casing: 'snake_case',
  verbose: true,
  strict: true,
})

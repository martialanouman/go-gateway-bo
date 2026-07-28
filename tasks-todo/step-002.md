# step-002 — PostgreSQL 18 + Drizzle : schéma propre au BFF, migrations, docker-compose

> **Jalon :** M0 (§3.1) · **Statut :** À FAIRE
> **Dépend de :** step-000 · **Bloque :** step-020, step-044, step-046, step-100

## But
Donner au BFF son petit magasin : les six tables qu'il possède réellement, avec migrations
reproductibles et un environnement local d'une commande.

## Périmètre (ce que fait CETTE PR)
- `docker-compose.yml` : PostgreSQL 18 + Redis (le Redis servira en step-044).
- Drizzle : `src/server/db/schema/` + `drizzle.config.ts` + migrations générées (`drizzle-kit`).
- Tables du §3.1, **sans** le contenu métier des steps suivantes : `operators`, `permissions`,
  `roles`, `role_permissions`, `operator_roles`, `audit_log`, `alert_rules`, `notifications`,
  `saved_views`.
- `audit_log` **partitionné par mois** (hygiène de rétention, §3.1).
- Pool de connexions + arrêt propre ; `pnpm db:migrate`, `pnpm db:studio`.

## Points d'implémentation clés
- **UUIDv7 partout** (cohérence plateforme, §3.1) : générer côté application ou via extension, mais
  un seul mécanisme, documenté.
- Le BFF ne possède **que** ces tables. Aucune copie de client, compte, connecteur, CDR ou solde :
  ces données viennent de l'API Admin à chaque lecture (§3.2). Le rappeler en tête du schéma.
- Migrations **versionnées et commitées** ; jamais de `push` de schéma en production.
- Colonnes de secrets (`password_hash`, `mfa_totp_secret`) : jamais dans un `SELECT *` exposé —
  prévoir des projections explicites dès maintenant.

## Tests (écrits dans la même PR)
- Les migrations s'appliquent sur une base vierge (Testcontainers ou service CI) et sont idempotentes.
- Une insertion dans `audit_log` atterrit dans la bonne partition mensuelle.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] `docker compose up` + `pnpm db:migrate` suffisent à un poste neuf
- [ ] aucune donnée du plan de contrôle de la passerelle dupliquée ici

## Hors périmètre
Seeds du catalogue de permissions et des rôles par défaut → step-020.

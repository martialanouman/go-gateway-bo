# step-005 — PostgreSQL : `pgx`, migrations, le schéma propre au BFF

> **Jalon :** M0 (§3.1) · **Statut :** À FAIRE
> **Dépend de :** step-000 · **Bloque :** step-006, M1 entier

## But
Le petit schéma dont le BFF est propriétaire — opérateurs, rôles, sessions, audit, alertes,
notifications, vues sauvegardées — avec ses migrations et une base jetable pour les tests. Le tableau
de bord ne lit **jamais** la base de la passerelle (§1.3).

## Périmètre (ce que fait CETTE PR)
- `internal/store/` : pool `pgx`, cycle de vie attaché au `context` racine, arrêt propre.
- Migrations versionnées et commitées, rejouables, avec le choix d'outil **tranché et justifié**
  (`plan.md` §19 laisse la question ouverte : `golang-migrate`, `goose`, ou SQL maison).
- Les tables du §3.1 : `operators`, `roles`, `permissions` et leurs jointures ; `sessions` ;
  `audit_log` **partitionné par mois** ; `alert_rules` ; `notifications` ; `saved_views` ; la table
  d'anti-brute-force.
- `docker-compose.yml` : PostgreSQL 18 + Redis.
- Base jetable pour les tests (testcontainers), et les migrations rejouées à chaque suite.

## Points d'implémentation clés
- **Partitionner `audit_log` n'a de sens que si quelque chose détache les partitions.** La v1.0 avait
  livré la création sans la rétention, et il a fallu une step ajoutée après coup pour la fermer. Ici,
  la création note explicitement que `step-187` en est le propriétaire — une dette écrite vaut mieux
  qu'une dette découverte.
- Le pool est configuré, pas laissé par défaut : nombre de connexions, durée de vie, délai
  d'acquisition. Deux instances partagent la même base (§4.1).
- Aucune requête n'est écrite ici. Les tables existent, elles ne servent encore personne.
- L'ordre des migrations est un contrat : elles ne se réécrivent jamais, elles s'ajoutent.

## Tests (écrits dans la même PR)
- **Scénario** `base.feature` : *Étant donné* une base vierge, *Quand* les migrations sont jouées,
  *Alors* le schéma attendu existe ; *Quand* elles sont rejouées, *Alors* rien ne change et rien
  n'échoue.
- Une partition d'`audit_log` est créée pour le mois courant et pour le suivant.
- Le pool se ferme sur annulation du `context` et aucune connexion ne reste ouverte.

## Definition of Done
- [ ] `make check` vert, base jetable comprise
- [ ] `docker compose up` + migrations suffit sur un poste neuf, et la procédure est dans le README
- [ ] le choix d'outil de migration est **écrit** avec sa raison, pas seulement fait
- [ ] la mutation « ne pas créer la partition du mois suivant » fait rougir la suite

## Hors périmètre
Le seed des permissions et des rôles → step-020. La rétention et le détachement des partitions →
step-187. Toute requête métier.

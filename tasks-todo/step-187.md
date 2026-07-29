# step-187 — Rétention d'`audit_log` : détachement et purge des partitions échues

> **Jalon :** M9 (§3.1, §1.3) · **Statut :** À FAIRE
> **Dépend de :** step-002, step-025 · **Bloque :** step-186

## But
Donner un propriétaire à la rétention du journal d'audit. La step-002 a livré la moitié créatrice du
mécanisme — `ensure_audit_log_partitions()` crée les mois à venir — et **rien ne détache ni ne
supprime**. C'est pourtant l'unique raison d'avoir partitionné : détacher un mois est instantané et ne
verrouille rien, là où un `DELETE ... WHERE created_at < ...` réécrit la table et fait gonfler le WAL.
Sans cette step, le partitionnement paie son coût sans rendre son bénéfice, et la table croît sans
borne jusqu'à ce que quelqu'un s'en aperçoive en production.

## Périmètre (ce que fait CETTE PR)
- Fonction `prune_audit_log_partitions(retain_months integer)` : détache puis supprime les partitions
  **entièrement** antérieures à la fenêtre de rétention. Mêmes garanties que sa jumelle créatrice —
  `SET timezone TO 'UTC'`, `SET search_path TO public`, sérialisation par verrou consultatif.
- Une seule entrée d'exploitation, `pnpm db:maintain`, qui enchaîne création puis purge en un passage
  idempotent et sûr quand deux instances le lancent en même temps.
- Fenêtre de rétention par variable d'environnement `AUDIT_LOG_RETENTION_MONTHS`. **Absence de
  variable = aucune suppression**, et une ligne de log qui le dit : le mode d'échec à éviter est de
  supprimer trop, jamais de garder trop. Une valeur dégénérée — `0`, négative, non entière — est
  **refusée au démarrage** plutôt qu'interprétée : une purge à zéro mois viderait la table au premier
  passage.
- Manifeste de la tâche planifiée qui appelle `pnpm db:maintain` (fréquence, politique de reprise sur
  échec, une seule exécution à la fois). Il est livré ici parce que sinon personne ne le porte : le
  périmètre de step-186 couvre la topologie de service, pas les tâches planifiées.
- Compteur `audit_log_default` exposé à la supervision (une seule ligne dans la partition par défaut
  empêche définitivement la création du mois correspondant) et procédure écrite de déplacement des
  lignes égarées.
- Runbook : qui déclenche la maintenance, à quelle fréquence, et quoi faire quand la partition par
  défaut n'est pas vide.

## Points d'implémentation clés
- **Le détachement est non concurrent, et ce n'est pas un choix.** `DETACH PARTITION CONCURRENTLY`
  est refusé sur une table partitionnée qui porte une partition `DEFAULT` — le détachement concurrent
  doit ajouter une contrainte à cette partition, et PostgreSQL ne le fait pas en ligne. Or
  `audit_log_default` est permanente (voir le point suivant). Le second angle mort est indépendant :
  `CONCURRENTLY` ne tourne pas dans un bloc de transaction, et une fonction PL/pgSQL s'exécute
  toujours dans la transaction appelante — la forme concurrente serait donc inaccessible même sans
  partition par défaut. Conclusion : `ALTER TABLE ... DETACH PARTITION` simple, qui prend un verrou
  `ACCESS EXCLUSIVE` bref sur la table parente, et `pg_advisory_xact_lock` reste utilisable tel quel,
  exactement comme dans la fonction jumelle.
- **Le calcul de la borne se fait en UTC**, pour la raison exacte qui a été documentée dans
  `0001_audit_log_partitions.sql` : `created_at` est un `timestamptz`, et une session en Europe/Paris
  et la CI ne calculent pas le même mois. Ici l'enjeu n'est plus un chevauchement mais une
  **suppression d'un mois encore dans la fenêtre**.
- Ne jamais considérer `audit_log_default` comme candidate, même vide. Sa suppression ferait échouer
  toute écriture destinée à un mois non couvert — et comme une mutation non auditée n'aboutit pas
  (invariant c), un oubli de maintenance bloquerait les mutations.
- Une partition qui **chevauche** la borne n'est pas purgée : seuls les mois entièrement échus le sont.
- La purge est irréversible. **Décision à confirmer avec le métier avant livraison :** la durée de
  conservation retenue, et s'il faut archiver hors ligne avant de supprimer. Aucune valeur par défaut
  n'est posée dans cette step précisément pour que le choix soit explicite.
- Ce que la maintenance journalise se limite aux **noms de partitions et aux comptages** — jamais un
  extrait de `before_json` / `after_json` (invariants a et b).

## Tests (écrits dans la même PR)
- Une partition entièrement hors fenêtre est détachée puis supprimée ; celle qui chevauche la borne
  reste. Cas de bordure vérifié au jour près, en UTC.
- Deux passages consécutifs de `pnpm db:maintain` donnent le même état (idempotence).
- `AUDIT_LOG_RETENTION_MONTHS` absent : le nombre de partitions est inchangé après passage.
- `AUDIT_LOG_RETENTION_MONTHS` à `0`, à une valeur négative ou non entière : refus explicite, aucune
  partition supprimée. C'est le test qui empêche qu'une configuration fautive vide la table.
- `audit_log_default` survit à une purge, y compris quand elle est vide.
- Deux maintenances concurrentes n'en font pas échouer une.
- **Mutation :** retirer `SET timezone TO 'UTC'` de la fonction de purge doit rendre un test rouge.
  Le test doit donc forcer la session à un fuseau non-UTC (`SET timezone TO 'Europe/Paris'`, le
  scénario réel décrit dans `0001_audit_log_partitions.sql`) : en CI le fuseau ambiant est UTC, et une
  mutation vérifiée depuis une session UTC ne changerait rien d'observable — le test resterait vert
  tout en paraissant mordre.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] la rétention a un propriétaire nommé dans le runbook · durée de conservation validée par le métier

## Hors périmètre
L'écran de consultation du journal et l'export gouverné de son résultat filtré → step-184. L'alerte
sur `audit_log_default` non vide → step-180 (cette step expose le compteur, elle ne câble pas la
règle). L'intégration du manifeste de tâche planifiée au déploiement lui-même → step-186.

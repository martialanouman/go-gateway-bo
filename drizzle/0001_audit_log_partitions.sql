-- Mécanique de partitionnement d'`audit_log`. Fichier écrit à la main de bout en bout : Drizzle ne
-- sait rien exprimer de tout ceci, et il ne le régénérera jamais — `drizzle-kit generate` compare le
-- schéma TypeScript à son propre snapshot, jamais à la base.
--
-- Pourquoi partitionner une table qui restera modeste (100 à 300 opérateurs internes) : la rétention.
-- Détacher puis supprimer un mois entier est instantané et ne verrouille rien, là où un
-- `DELETE ... WHERE created_at < ...` réécrit la table et fait gonfler le WAL. C'est de l'hygiène
-- d'archivage, pas de la performance de lecture.

--> statement-breakpoint

-- Crée les partitions mensuelles manquantes, du mois courant jusqu'à `months_ahead` mois en avant.
--
-- **Sûre à appeler depuis plusieurs instances à la fois.** `CREATE TABLE IF NOT EXISTS` ne protège
-- pas d'une course au niveau du catalogue — deux instances peuvent passer le test d'existence puis
-- échouer en `unique_violation`. Le verrou consultatif sérialise l'ensemble ; il est pris pour la
-- durée de la transaction et relâché avec elle, même en cas d'erreur.
--
-- **`SET timezone TO 'UTC'` porte sur la fonction, pas sur son corps.** `created_at` est un
-- `timestamptz` : le mois que `date_trunc` calcule et surtout la borne que `CREATE TABLE ... FOR
-- VALUES` fige en convertissant son littéral dépendent tous deux du fuseau de la session appelante.
-- Sans cette clause, une maintenance lancée depuis une session en Europe/Paris pose des bornes à
-- minuit heure de Paris là où la CI les pose à minuit UTC — et le mois suivant échoue en
-- « would overlap partition », ce qui bloque la migration donc le déploiement. Le fuseau de
-- l'appelant est restauré à la sortie.
--
-- `search_path` est figé pour la même raison : un appelant au chemin différent créerait la partition
-- dans un autre schéma, ou échouerait. `public` et lui seul — une table non qualifiée naît dans le
-- premier schéma du chemin, et y placer `pg_catalog` ferait échouer toutes les créations.
CREATE OR REPLACE FUNCTION ensure_audit_log_partitions(months_ahead integer DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
SET timezone TO 'UTC'
SET search_path TO public
AS $$
DECLARE
  month_start timestamptz;
  partition_name text;
  offset_months integer;
BEGIN
  -- Une clé arbitraire mais stable, propre à cette fonction.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_audit_log_partitions'));

  FOR offset_months IN 0..months_ahead LOOP
    month_start := date_trunc('month', now() + make_interval(months => offset_months));
    partition_name := format('audit_log_%s', to_char(month_start, 'YYYY_MM'));

    -- Un mois qui échoue ne doit pas emporter les autres, ni la migration qui appelle cette
    -- fonction. Le cas réel : des lignes ont atterri dans la partition par défaut pour ce mois, et
    -- PostgreSQL refuse alors de le détacher du défaut (« updated partition constraint for default
    -- partition would be violated by some row »). Sans ce garde-fou, un seul mois empoisonné rendrait
    -- tout déploiement impossible jusqu'à intervention manuelle — un mode de panne bien pire que
    -- celui que la partition par défaut cherchait à éviter.
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start,
        month_start + interval '1 month'
      );
    EXCEPTION WHEN check_violation THEN
      -- Et RIEN d'autre. `WHEN others` avalerait aussi une erreur de droits ou de chemin, et la
      -- fonction rendrait la main sans avoir rien créé, sans que personne ne le sache — c'est
      -- arrivé pendant l'écriture de ce fichier, et seul un test l'a rattrapé.
      RAISE WARNING 'Partition % non créée : des lignes de ce mois occupent déjà audit_log_default (%). À déplacer à la main avant que ce mois puisse être attaché.', partition_name, SQLERRM;
    END;
  END LOOP;
END;
$$;

--> statement-breakpoint

-- Filet de sécurité. Sans partition par défaut, une écriture destinée à un mois non couvert échoue —
-- et comme toute mutation du tableau de bord doit être auditée pour aboutir (invariant c), l'échec
-- se propagerait à l'action elle-même : un oubli de maintenance bloquerait les mutations.
--
-- Elle ne doit jamais servir, et sa surveillance n'est pas optionnelle : une ligne qui s'y trouve
-- empêche définitivement la création du mois correspondant (voir le garde-fou ci-dessus). Le suivi
-- `count(*) FROM audit_log_default > 0` est à brancher en alerte à step-180.
CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT;

--> statement-breakpoint

SELECT ensure_audit_log_partitions(3);

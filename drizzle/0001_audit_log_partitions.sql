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
-- Idempotente, et sûre à appeler depuis plusieurs instances à la fois : `CREATE TABLE IF NOT EXISTS`
-- ne protège pas d'une course au niveau du catalogue — deux instances peuvent passer le test
-- d'existence puis échouer en `unique_violation`. Le verrou consultatif sérialise l'ensemble ; il
-- est pris pour la durée de la transaction et relâché avec elle, même en cas d'erreur.
CREATE OR REPLACE FUNCTION ensure_audit_log_partitions(months_ahead integer DEFAULT 3)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  month_start date;
  partition_name text;
  offset_months integer;
BEGIN
  -- Une clé arbitraire mais stable, propre à cette fonction.
  PERFORM pg_advisory_xact_lock(hashtext('ensure_audit_log_partitions'));

  FOR offset_months IN 0..months_ahead LOOP
    month_start := date_trunc('month', now() + make_interval(months => offset_months))::date;
    partition_name := format('audit_log_%s', to_char(month_start, 'YYYY_MM'));

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      month_start,
      (month_start + interval '1 month')::date
    );
  END LOOP;
END;
$$;

--> statement-breakpoint

-- Filet de sécurité. Sans partition par défaut, une écriture destinée à un mois non couvert échoue —
-- et comme toute mutation du tableau de bord doit être auditée pour aboutir (invariant c), l'échec
-- se propagerait à l'action elle-même : un oubli de maintenance bloquerait les mutations.
--
-- Elle ne doit jamais servir. Une ligne qui s'y trouve signale que la maintenance n'a pas tourné, et
-- attacher plus tard le mois correspondant exigerait alors de déplacer ces lignes à la main, sous
-- verrou exclusif. `pnpm db:migrate` appelle la fonction ci-dessus, donc chaque déploiement repousse
-- l'horizon de trois mois.
CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT;

--> statement-breakpoint

SELECT ensure_audit_log_partitions(3);

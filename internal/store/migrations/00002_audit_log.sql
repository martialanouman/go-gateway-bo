-- Le journal d'audit, partitionné par mois sur `created_at` (§3.1, §6.14).
--
-- **Deux partitions existent, et rien dans ce dépôt ne les renouvelle.** Une version antérieure de
-- ce commentaire annonçait des partitions qui « s'accumulent indéfiniment » : c'est l'inverse qui a
-- été mesuré le 02/08/2026. `ensure_audit_log_partitions()` n'est appelée qu'ici, au moment où goose
-- applique cette migration ; goose ne rejoue jamais une migration appliquée, et `make migrate` sur
-- une base à jour rend « schéma déjà à jour » sans la rappeler. Ni `pg_cron`, ni ordonnanceur, ni
-- appel au démarrage n'existent — recherché sur tout l'arbre le même jour.
--
-- Mesuré sur `postgres:18` : une base migrée deux fois le 2 août porte `audit_log_2026_08` et
-- `audit_log_2026_09`, et une écriture datée du mois+2 échoue déjà —
-- `no partition of relation "audit_log" found for row`. Donc **le 1er octobre, toute écriture
-- d'audit est refusée**, et avec elle toute action tracée du BFF le jour où l'écriture d'audit
-- partage la transaction de l'action qu'elle trace.
--
-- La dette est double, et step-187 (« Rétention : partitions **détachées** ») n'en porte qu'une :
--   · **création glissante** — quelqu'un doit rappeler cette fonction chaque mois. Aucun
--     ordonnanceur n'existe encore dans ce dépôt, donc le mécanisme est hors du périmètre de
--     step-005. Élargir `ARRAY[0, 1]` à douze mois achèterait un an sans rien construire : ce n'est
--     **pas** fait ici, parce que cela déplacerait la date de la panne au lieu de créer ce qui
--     manque, et rendrait la dette moins visible en la rendant moins urgente.
--   · **détachement** — rien ici ne purge : c'est step-187, et cette moitié-là est bien écrite.

-- +goose Up

-- `PRIMARY KEY (id, created_at)` et non `PRIMARY KEY (id)` : sur une table partitionnée, PostgreSQL
-- exige que les colonnes d'une contrainte d'unicité incluent toutes celles de la clé de partition.
--
-- Deux conséquences :
--   · l'unicité d'`id` n'est plus garantie que par partition — négligeable pour un UUIDv7, qui porte
--     déjà l'horodatage de sa génération ;
--   · **aucune clé étrangère ne doit pointer vers `audit_log`** : elle devrait porter les deux
--     colonnes. Un journal d'audit est terminal.
CREATE TABLE audit_log (
    id          uuid NOT NULL DEFAULT uuidv7(),
    -- `RESTRICT` : le journal ne perd jamais son auteur. Un opérateur qui part se désactive
    -- (`status = 'disabled'`), il ne se supprime pas.
    operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT,
    action      text NOT NULL,
    target_type text,
    target_id   text,
    before_json jsonb,
    after_json  jsonb,
    ip_address  inet,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Créés sur la table mère, donc propagés à toute partition attachée ensuite — celles que la fonction
-- ci-dessous créera les mois prochains comprises.
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_operator_id_idx ON audit_log (operator_id);

-- PostgreSQL ne crée aucune partition de lui-même. Deux `CREATE TABLE` littéraux ici seraient vrais
-- le mois de leur écriture et faux le suivant ; la fonction dérive ses bornes de `now()`, donc elle
-- reste juste à toute date et la suite qui l'observe reste falsifiable.
--
-- **Le calcul se fait en `timestamp`, et ne devient un instant qu'à la sortie.** L'arithmétique de
-- `timestamptz` est faite par PostgreSQL dans le fuseau de la **session**, que ce dépôt ne contrôle
-- pas : `pgx` transmet tout paramètre de DSN inconnu comme paramètre d'exécution, `PGTZ` y est mappé
-- (v5.10.0, `pgconn/config.go:601` — `"PGTZ": "timezone"`), et un `ALTER DATABASE … SET timezone`
-- fait le reste. Mesuré le 02/08/2026 sous `America/New_York`,
-- `timestamptz + interval '1 month'` sortait faux **6 mois sur 12** ; en mars la borne haute tombait
-- le 28 à 23:00 UTC, le second tour de boucle retrouvait le même nom de partition, `IF NOT EXISTS`
-- l'avalait sans bruit, et toute écriture du 29 mars était refusée. Sous `Europe/Paris`, la même
-- borne tombait une heure trop tôt. `partitions_test.go` tient les deux fuseaux.
--
-- `anchor` a pour défaut `now()` — l'appel de cette migration ne le renseigne pas. Ce paramètre
-- existe parce que le défaut n'est observable qu'à certains mois : en août, l'arithmétique fautive
-- tombait juste, et une suite qui s'en remet à `now()` dit donc quelque chose de différent selon le
-- jour où elle tourne. Il servira aussi à qui rappellera cette fonction (voir l'en-tête).
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ensure_audit_log_partitions(anchor timestamptz DEFAULT now()) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    current_month timestamp := date_trunc('month', anchor AT TIME ZONE 'UTC');
    month_start   timestamp;
    month_offset  integer;
BEGIN
    FOREACH month_offset IN ARRAY ARRAY[0, 1] LOOP
        month_start := current_month + make_interval(months => month_offset);
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
            'audit_log_' || to_char(month_start, 'YYYY_MM'),
            month_start AT TIME ZONE 'UTC',
            (month_start + interval '1 month') AT TIME ZONE 'UTC'
        );
    END LOOP;
END;
$$;
-- +goose StatementEnd

SELECT ensure_audit_log_partitions();

-- +goose Down

DROP TABLE audit_log;
DROP FUNCTION ensure_audit_log_partitions(timestamptz);

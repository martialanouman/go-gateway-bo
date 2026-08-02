-- Le journal d'audit, partitionné par mois sur `created_at` (§3.1, §6.14).
--
-- **La rétention et le détachement des partitions appartiennent à step-187.** Cette migration crée,
-- elle ne purge pas : rien ici ne détache une partition ancienne, et sans step-187 les partitions
-- s'accumulent indéfiniment. La dette est écrite plutôt que découverte.

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
-- Les bornes sont calculées **en UTC** : un littéral de date passé à `FOR VALUES` est interprété dans
-- le fuseau de la session, et une partition créée depuis un poste en Europe/Paris ne couvrirait alors
-- pas le même intervalle absolu que la même commande lancée sur un serveur en UTC.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ensure_audit_log_partitions() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    current_month timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    month_start   timestamptz;
    month_offset  integer;
BEGIN
    FOREACH month_offset IN ARRAY ARRAY[0, 1] LOOP
        month_start := current_month + make_interval(months => month_offset);
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
            'audit_log_' || to_char(month_start AT TIME ZONE 'UTC', 'YYYY_MM'),
            month_start,
            month_start + interval '1 month'
        );
    END LOOP;
END;
$$;
-- +goose StatementEnd

SELECT ensure_audit_log_partitions();

-- +goose Down

DROP TABLE audit_log;
DROP FUNCTION ensure_audit_log_partitions();

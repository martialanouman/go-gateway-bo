-- Les trois dernières tables du §3.1 : les règles d'alerte métier, les notifications qu'elles et
-- Alertmanager produisent, et les vues que les opérateurs sauvegardent.

-- +goose Up

CREATE TABLE alert_rules (
    id                   uuid PRIMARY KEY DEFAULT uuidv7(),
    metric               text NOT NULL,
    scope                text NOT NULL CHECK (scope IN ('global', 'connector', 'account')),
    -- `text` et non `uuid` : cet identifiant désigne un connecteur ou un compte de la **passerelle**,
    -- dont la forme appartient à son contrat et non à ce schéma.
    scope_id             text,
    -- Qui évalue décide de ce qu'une panne du tableau de bord dégrade : les métriques d'infra
    -- restent chez Alertmanager, indépendant de notre disponibilité (invariant (e), §6.8).
    evaluation_owner     text NOT NULL CHECK (evaluation_owner IN ('alertmanager', 'bff')),
    condition_json       jsonb NOT NULL,
    notify_channels_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Sans `CHECK` : le §3.1 nomme la colonne sans énumérer ses valeurs, et les deviner ici en
    -- ferait une contrainte à corriger par une migration.
    status               text NOT NULL,
    created_by           uuid REFERENCES operators (id) ON DELETE SET NULL
);

CREATE TABLE notifications (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    -- `SET NULL` : supprimer une règle n'efface pas ce qu'elle a déjà signalé. C'est pourquoi le
    -- §3.1 déclare la colonne nullable.
    alert_rule_id     uuid REFERENCES alert_rules (id) ON DELETE SET NULL,
    source            text NOT NULL
        CHECK (source IN ('alertmanager', 'bff_evaluator', 'billing_alert_stream')),
    severity          text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    message           text NOT NULL,
    read_by_operators jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_created_at_idx ON notifications (created_at DESC);

CREATE TABLE saved_views (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    -- `CASCADE` : une vue sauvegardée n'appartient qu'à son opérateur et n'a pas de sens sans lui.
    operator_id  uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    view_type    text NOT NULL CHECK (view_type IN ('cdr_search', 'traffic_dashboard')),
    filters_json jsonb NOT NULL,
    name         text NOT NULL,
    UNIQUE (operator_id, view_type, name)
);

-- +goose Down

DROP TABLE saved_views;
DROP TABLE notifications;
DROP TABLE alert_rules;

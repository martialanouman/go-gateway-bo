-- Les cinq tables de l'autorisation : qui est opérateur, quelles permissions existent, quels rôles
-- les regroupent, et qui détient quoi. Le seed du catalogue et des rôles par défaut appartient à
-- step-020 — ici les tables existent, elles ne contiennent rien.

-- +goose Up

CREATE TABLE operators (
    id                       uuid PRIMARY KEY DEFAULT uuidv7(),
    email                    text NOT NULL,
    display_name             text NOT NULL,
    password_hash            text NOT NULL,
    mfa_totp_secret          text,
    mfa_webauthn_credentials jsonb NOT NULL DEFAULT '[]'::jsonb,
    status                   text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
    last_login_at            timestamptz
);

-- L'unicité porte sur `lower(email)` et non sur la colonne : deux opérateurs qui ne diffèrent que
-- par la casse de leur adresse sont la même personne, et le second masquerait le premier au moment
-- de l'authentification.
CREATE UNIQUE INDEX operators_email_lower_key ON operators (lower(email));

CREATE TABLE permissions (
    key         text PRIMARY KEY,
    category    text NOT NULL CHECK (category IN (
        'routing', 'connectors', 'sessions', 'antispam', 'accounts', 'billing',
        'content', 'compliance', 'alerts', 'audit', 'admin'
    )),
    description text NOT NULL
);

CREATE TABLE roles (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    name        text NOT NULL UNIQUE,
    description text NOT NULL,
    is_default  boolean NOT NULL DEFAULT false,
    -- Le départ de l'opérateur qui a créé un rôle ne supprime pas le rôle : les permissions qu'il
    -- accorde survivent à son auteur. La colonne est nullable au §3.1 pour cette raison.
    created_by  uuid REFERENCES operators (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
    role_id        uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    -- `RESTRICT` : retirer une permission du catalogue pendant que des rôles l'accordent doit
    -- échouer bruyamment au déploiement, plutôt que déposséder ces rôles en silence.
    permission_key text NOT NULL REFERENCES permissions (key) ON DELETE RESTRICT,
    PRIMARY KEY (role_id, permission_key)
);

-- « Quels rôles accordent cette permission ? » ne peut pas emprunter la clé primaire, dont
-- `permission_key` est la colonne de queue.
CREATE INDEX role_permissions_permission_key_idx ON role_permissions (permission_key);

CREATE TABLE operator_roles (
    operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    -- Même raison qu'au-dessus, à l'échelon du rôle : supprimer un rôle encore détenu doit échouer,
    -- pas retirer des permissions à des opérateurs actifs sans que personne ne le voie.
    role_id     uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
    PRIMARY KEY (operator_id, role_id)
);

CREATE INDEX operator_roles_role_id_idx ON operator_roles (role_id);

-- +goose Down

DROP TABLE operator_roles;
DROP TABLE role_permissions;
DROP TABLE roles;
DROP TABLE permissions;
DROP TABLE operators;

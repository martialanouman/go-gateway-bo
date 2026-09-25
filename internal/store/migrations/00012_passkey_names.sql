-- Le nom d'une passkey (dette 042) : c'est par lui qu'un opérateur reconnaît celle qu'il retire.
-- Le `DEFAULT` ne sert qu'à nommer les lignes existantes, puis il est retiré : un nom posé par le
-- schéma à la place de l'opérateur ne distinguerait plus rien.

-- +goose Up

ALTER TABLE webauthn_credentials
    ADD COLUMN name text NOT NULL DEFAULT 'Clé d''accès'
        CHECK (char_length(name) BETWEEN 1 AND 64);
ALTER TABLE webauthn_credentials ALTER COLUMN name DROP DEFAULT;

-- +goose Down

ALTER TABLE webauthn_credentials DROP COLUMN name;

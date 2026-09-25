-- Le nom d'une passkey (dette 042) : c'est par lui qu'un opérateur reconnaît celle qu'il retire.
-- Le `DEFAULT` ne sert qu'à nommer les lignes existantes, puis il est retiré : un nom posé par le
-- schéma à la place de l'opérateur ne distinguerait plus rien.
--
-- Un TOTP enrôlé sur un compte qu'un facteur confirmé garde déjà — TOTP confirmé ou passkey — attend
-- sa confirmation à côté, avec ses codes : le compte n'est jamais sans facteur confirmé. Seule la
-- confirmation les fait passer actifs.

-- +goose Up

ALTER TABLE webauthn_credentials
    ADD COLUMN name text NOT NULL DEFAULT 'Clé d''accès'
        CHECK (char_length(name) BETWEEN 1 AND 64);
ALTER TABLE webauthn_credentials ALTER COLUMN name DROP DEFAULT;

ALTER TABLE operators ADD COLUMN mfa_totp_pending_secret text;
ALTER TABLE mfa_recovery_codes ADD COLUMN pending boolean NOT NULL DEFAULT false;

-- +goose Down

ALTER TABLE mfa_recovery_codes DROP COLUMN pending;
ALTER TABLE operators DROP COLUMN mfa_totp_pending_secret;
ALTER TABLE webauthn_credentials DROP COLUMN name;

-- Un compte naît sans mot de passe : son titulaire le définit par le lien. La file ne porte que la
-- demande ; le jeton est tiré à l'envoi et seul son SHA-256 est gardé.

-- +goose Up

ALTER TABLE operators ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE access_links (
    operator_id     uuid PRIMARY KEY REFERENCES operators (id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('activation', 'reset')),
    token_hash      bytea UNIQUE,
    expires_at      timestamptz,
    sent_at         timestamptz,
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down

DROP TABLE access_links;
-- '!' n'est pas un hachage lisible : le compte reste fermé au lieu de faire échouer le retour arrière.
UPDATE operators SET password_hash = '!' WHERE password_hash IS NULL;
ALTER TABLE operators ALTER COLUMN password_hash SET NOT NULL;

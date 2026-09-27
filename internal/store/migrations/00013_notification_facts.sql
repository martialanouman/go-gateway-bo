-- Les faits d'une notification, rendus en copie à la lecture : une formulation corrigée vaut pour tout
-- l'historique, et les identifiants restent verbatim. `message` reste aux sources en texte libre (M9).

-- +goose Up

ALTER TABLE notifications
    ADD COLUMN kind text NOT NULL DEFAULT 'message',
    ADD COLUMN details jsonb,
    ALTER COLUMN message DROP NOT NULL,
    ADD CONSTRAINT notifications_has_content CHECK (message IS NOT NULL OR details IS NOT NULL);

ALTER TABLE notifications ALTER COLUMN kind DROP DEFAULT;

-- +goose Down

ALTER TABLE notifications
    DROP CONSTRAINT notifications_has_content,
    DROP COLUMN details,
    DROP COLUMN kind;

ALTER TABLE notifications ALTER COLUMN message SET NOT NULL;

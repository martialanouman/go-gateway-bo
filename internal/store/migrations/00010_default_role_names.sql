-- Les neuf rôles par défaut prennent des noms français d'un mot, comme ceux qu'un opérateur compose
-- à l'écran. Le seed identifie un rôle par son nom : sans ce renommage en place, il laisserait les
-- anciens rôles, et leurs détenteurs, à côté de neuf rôles neufs que personne ne détient.
--
-- Seules les lignes `is_default` sont touchées : un rôle personnalisé qui porterait déjà l'un des
-- nouveaux noms fait échouer la migration sur l'unicité de `roles.name`, bruyamment, plutôt que de
-- confisquer ce rôle.

-- +goose Up

UPDATE roles AS r
SET name = renamed.new_name
FROM (VALUES
    ('super_admin', 'Propriétaire'),
    ('ops', 'Exploitation'),
    ('script_author', 'Scripts'),
    ('support_readonly', 'Support'),
    ('billing_admin', 'Finance'),
    ('billing_readonly', 'Reporting'),
    ('account_manager', 'Clientèle'),
    ('compliance', 'Conformité'),
    ('auditor', 'Audit')
) AS renamed (old_name, new_name)
WHERE r.is_default AND r.name = renamed.old_name;

-- +goose Down

UPDATE roles AS r
SET name = renamed.old_name
FROM (VALUES
    ('super_admin', 'Propriétaire'),
    ('ops', 'Exploitation'),
    ('script_author', 'Scripts'),
    ('support_readonly', 'Support'),
    ('billing_admin', 'Finance'),
    ('billing_readonly', 'Reporting'),
    ('account_manager', 'Clientèle'),
    ('compliance', 'Conformité'),
    ('auditor', 'Audit')
) AS renamed (old_name, new_name)
WHERE r.is_default AND r.name = renamed.new_name;

-- Deux dimensions de plus, et elles ne comptent pas la même chose que les trois premières.
--
-- **`email`, `source` et `mfa` comptent des échecs** : le chemin de succès n'incrémente rien, et
-- efface même le compteur. C'est ce qui laisse trois routes sans aucune borne — l'enrôlement TOTP
-- (step-023) et les deux ouvertures de cérémonie WebAuthn (step-024). Elles **réussissent** à chaque
-- appel : une session de premier facteur suffit à les répéter, et rien ne les voit passer.
--
-- **`totp_enroll` et `webauthn_ceremony` comptent donc des appels**, réussis compris. La colonne
-- `failures` porte pour elles un nombre d'appels et `last_failure_at` la date du dernier : les noms
-- viennent des trois dimensions d'origine et ne décrivent plus qu'une partie de la table. Les
-- renommer toucherait le chemin de connexion pour un gain de vocabulaire, ce qui n'est pas de cette
-- step ; la divergence est écrite ici plutôt que laissée à découvrir.
--
-- **La même table et non une jumelle**, pour la raison qui a fait choisir une table unique en 00004
-- et l'a confirmée en 00007 : le mécanisme d'incrément atomique, la fenêtre d'oubli et la dérivation
-- du verrou depuis `(failures, last_failure_at)` sont déjà écrits et déjà éprouvés.
--
-- **Deux dimensions et non une**, parce que les deux coûts n'ont pas d'ordre de grandeur commun et
-- qu'un budget partagé serait trop lâche pour l'un ou trop serré pour l'autre :
--
--   * `totp_enroll` couvre `POST /auth/mfa/totp/enroll`, qui hache **dix argon2id** par appel — dix
--     fois le processeur d'une connexion, sur une porte qui n'est ouverte qu'à un premier facteur
--     franchi. Cinq par quart d'heure : un opérateur qui enrôle deux fois est déjà inhabituel.
--   * `webauthn_ceremony` couvre `register/begin` et `assert/begin`, qui n'écrivent qu'une ligne dans
--     `webauthn_challenges` — que rien ne purge avant step-187. Le coût est mille fois moindre et
--     l'usage légitime bien plus bavard : une clé qu'on cherche, un délai de cinq minutes qu'on
--     laisse filer, une seconde tentative. Vingt par quart d'heure.
--
-- **Les deux cérémonies partagent leur dimension.** Les séparer doublerait le budget d'un attaquant
-- pour la même protection, et un opérateur qui vient d'épuiser vingt enregistrements n'a aucune
-- raison d'avoir besoin de vingt assertions dans le même quart d'heure.
--
-- **Le prix, écrit plutôt que tu** : atteindre le seuil de `webauthn_ceremony` ferme aussi
-- l'élévation par passkey, donc le remède, un quart d'heure durant. Ce n'est pas une capacité neuve
-- — cinq codes faux ferment déjà tout le second facteur depuis 00007 — et l'alternative, laisser
-- `webauthn_challenges` croître sans borne sur une session volée, est pire.

-- +goose Up

ALTER TABLE login_attempt_counters DROP CONSTRAINT login_attempt_counters_scope_check;

ALTER TABLE login_attempt_counters
    ADD CONSTRAINT login_attempt_counters_scope_check
        CHECK (scope IN ('email', 'source', 'mfa', 'totp_enroll', 'webauthn_ceremony'));

-- +goose Down

-- Les lignes des dimensions retirées partent avec elles, comme en 00007 : la contrainte les
-- refuserait, et un `DOWN` qui échoue sur une donnée que l'`UP` a rendue légitime n'est pas
-- réversible.
DELETE FROM login_attempt_counters WHERE scope IN ('totp_enroll', 'webauthn_ceremony');

ALTER TABLE login_attempt_counters DROP CONSTRAINT login_attempt_counters_scope_check;

ALTER TABLE login_attempt_counters
    ADD CONSTRAINT login_attempt_counters_scope_check
        CHECK (scope IN ('email', 'source', 'mfa'));

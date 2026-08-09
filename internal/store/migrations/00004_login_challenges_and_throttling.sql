-- Les deux tables du premier facteur : le challenge de second facteur qu'un login réussi émet, et
-- les compteurs d'échecs que les ≥2 instances partagent.
--
-- **Le §3.1 ne les déclarait pas.** Il est amendé dans la même PR, comme step-020 avait amendé le
-- §6.10 : une table livrée sans que la spec la porte redevient une table que plus personne ne relit.
--
-- **Aucune clé étrangère vers `audit_log`** : sa clé primaire est `(id, created_at)` parce qu'elle
-- est partitionnée, donc toute référence devrait porter les deux colonnes. Un journal d'audit est
-- terminal (00002).
--
-- **L'arithmétique de temps se fait ici, sur l'horloge du serveur, et en secondes.** Sur l'horloge
-- du serveur parce que deux instances qui compareraient chacune la leur verraient deux verrous
-- différents sur la même ligne. En secondes — `make_interval(secs => …)` — parce que `timestamptz +
-- interval` porteur de jours ou de mois suit le fuseau de la **session** et non UTC : ce dépôt a
-- déjà payé ce piège en 00002, et un intervalle sans composante calendaire y échappe par
-- construction plutôt que par vigilance.

-- +goose Up

CREATE TABLE mfa_challenges (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    -- `CASCADE` et non `RESTRICT` : un challenge ne survit pas à l'opérateur qu'il désigne et ne vit
    -- que quelques minutes. Il n'y a rien à conserver, contrairement à `audit_log`.
    operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    -- L'**empreinte** du jeton, jamais le jeton : une lecture de la base ne permet pas de rejouer un
    -- challenge en vol. `bytea` et non `text` — 32 octets bruts, sans encodage à choisir.
    --
    -- SHA-256 et non argon2id, et c'est un arbitrage plutôt qu'un relâchement : le jeton est tiré
    -- d'un CSPRNG sur 256 bits, sans déficit d'entropie à compenser. Ce qu'argon2 achète sur un mot
    -- de passe — ralentir une recherche exhaustive dans un espace minuscule — n'a rien à acheter
    -- ici, et coûterait ses dizaines de millisecondes sur le chemin du second facteur.
    token_hash  bytea NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    -- Nullable, et c'est l'anti-rejeu : consommer est un `UPDATE … WHERE consumed_at IS NULL`, donc
    -- atomique. Un `DELETE` rendrait « déjà consommé » indiscernable de « n'a jamais existé » au
    -- moment où step-025 voudra écrire l'audit de la tentative.
    consumed_at timestamptz,
    -- Une échéance antérieure à l'émission rendrait le challenge inutilisable dès sa création : le
    -- symptôme serait un opérateur qui ne franchit jamais le second facteur, sans rien dans les logs.
    CONSTRAINT mfa_challenges_expires_after_creation CHECK (expires_at > created_at)
);

-- UNIQUE et non un index simple : c'est le chemin de lecture — on retrouve un challenge **par son
-- jeton** — et c'est aussi ce qui ferait échouer bruyamment un générateur qui répéterait une valeur.
CREATE UNIQUE INDEX mfa_challenges_token_hash_key ON mfa_challenges (token_hash);

-- La purge des challenges périmés appartient à step-187, avec les partitions détachées. L'index est
-- posé ici pour qu'elle n'ait pas à balayer la table entière le jour où elle arrivera.
CREATE INDEX mfa_challenges_expires_at_idx ON mfa_challenges (expires_at);

-- Un compteur par dimension surveillée. **Une seule table et non deux** : les deux dimensions se
-- lisent dans la même requête avant chaque tentative, et deux tables en feraient deux allers-retours
-- dont l'ordre serait observable de l'extérieur.
CREATE TABLE login_attempt_counters (
    -- `email` porte l'adresse **soumise**, en minuscules, qu'elle existe ou non — c'est la moitié qui
    -- ferme l'oracle d'énumération au niveau du stockage : une adresse inconnue est comptée comme les
    -- autres, donc « celle-ci ne verrouille jamais » n'est pas un signal exploitable.
    -- `source` porte le HMAC-SHA256 de l'adresse source, jamais l'adresse.
    scope           text NOT NULL CHECK (scope IN ('email', 'source')),
    subject         text NOT NULL,
    failures        integer NOT NULL CHECK (failures >= 0),
    -- **`locked_until` n'est pas une colonne**, et c'est la décision qui supprime une course. L'état
    -- de verrou se dérive de `(failures, last_failure_at)`, ce qui permet à tout l'incrément de tenir
    -- dans une seule expression, donc dans un seul `ON CONFLICT DO UPDATE`. Avec deux colonnes
    -- calculées il faudrait redire le `CASE` de la remise à zéro — et la façon évidente de l'éviter
    -- est une CTE qui lit sur le snapshot de la transaction et **perd des échecs** sous concurrence.
    last_failure_at timestamptz NOT NULL,
    PRIMARY KEY (scope, subject)
);

-- La clé primaire sert le chemin de lecture ; cet index-ci servira la purge des lignes oisives
-- (step-187). Ce qui borne réellement la croissance de la table n'est pas un index mais **l'ordre du
-- handler** : le verrou est consulté avant qu'un échec ne soit enregistré, donc une source ne peut
-- pas créer plus de lignes que son seuil par durée de verrou.
CREATE INDEX login_attempt_counters_last_failure_at_idx ON login_attempt_counters (last_failure_at);

-- +goose Down

DROP TABLE login_attempt_counters;
DROP TABLE mfa_challenges;

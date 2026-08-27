-- Ce que le second facteur WebAuthn exige du schéma : les passkeys enregistrées, et les défis des
-- deux cérémonies qui les posent et les exercent.
--
-- **Le §3.1 est amendé dans la même PR**, comme step-021, step-022 et step-023 l'ont fait pour leurs
-- tables.
--
-- **Une table et non la colonne `operators.mfa_webauthn_credentials`** que le §3.1 déclarait. La
-- raison est mécanique : le refus du compteur de signature qui recule s'écrit ici
-- `WHERE sign_count < $2`, et `RowsAffected()` est le verdict — le patron de 00006, déjà éprouvé.
-- Dans un tableau `jsonb` il faudrait un `jsonb_set` sur un chemin calculé, et l'atomicité se
-- raisonnerait au cas par cas plutôt qu'une fois. `mfa_recovery_codes` est le précédent : step-023 a
-- préféré une table à un tableau, et le §3.1 ne la déclarait pas non plus.
--
-- L'arithmétique de temps se fait sur l'horloge de **ce serveur de base**, en secondes — même raison
-- qu'en 00004 et 00005 : deux instances qui compareraient chacune la leur n'expireraient pas les
-- mêmes défis.

-- +goose Up

-- Une passkey enregistrée. Rien ici n'est un secret : la clé est **publique**, et c'est toute la
-- différence avec `operators.mfa_totp_secret`, que 00006 chiffre au repos. Une lecture de cette
-- table ne permet de forger aucune assertion — il y faudrait la clé privée, que l'authentificateur
-- ne rend jamais.
CREATE TABLE webauthn_credentials (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    -- `CASCADE` : supprimer un opérateur retire ses passkeys, comme ses sessions et ses codes de
    -- récupération. Il n'y a rien à conserver ici, contrairement à `audit_log`.
    operator_id     uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    -- L'identifiant que l'authentificateur s'est choisi, tel qu'il le rendra à chaque assertion.
    -- C'est par lui qu'on retrouve la ligne, et c'est pourquoi l'index est UNIQUE plus bas.
    credential_id   bytea NOT NULL,
    -- La clé **publique**, au format COSE. Elle vérifie la signature, elle n'en produit aucune.
    public_key      bytea NOT NULL,
    -- Le compteur de signature de l'authentificateur, et la garde du clonage. Il n'avance que :
    -- `RowsAffected() = 0` sur l'`UPDATE` monotone signale deux copies de la même clé privée.
    --
    -- `bigint` pour un `uint32` : la moitié haute ne tiendrait pas dans un `integer` signé.
    --
    -- Le défaut est zéro et le `CHECK` l'admet, parce que **certains authentificateurs rendent
    -- toujours zéro** — c'est le cas légitime que la garde doit laisser passer, et il est admis
    -- nommément plutôt qu'en désactivant le contrôle. Une garde qui refuse du légitime finit
    -- retirée.
    sign_count      bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
    -- Le modèle d'authentificateur. Il ne garde rien aujourd'hui ; il vient gratuitement de la
    -- cérémonie et c'est ce qui permettra à step-028 d'écrire « votre clé YubiKey » plutôt que « une
    -- passkey ».
    aaguid          bytea NOT NULL DEFAULT ''::bytea,
    -- Ce que le client a rapporté du transport (`usb`, `internal`, `hybrid`…). Restitué dans les
    -- options d'assertion, où il aide le navigateur à proposer le bon geste plutôt qu'une liste.
    transports      text[] NOT NULL DEFAULT '{}',
    attachment      text,
    -- `uvInitialized` de la spécification : **latché**, il n'avance jamais en arrière. Une fois
    -- qu'une cérémonie a vérifié l'utilisateur, la propriété est acquise pour cette passkey.
    user_verified   boolean NOT NULL DEFAULT false,
    -- BE ne change jamais ; BS change quand la passkey est synchronisée. Les deux sont relus à
    -- chaque assertion — depuis la v0.18.0 de la bibliothèque, l'enregistrement les contrôle.
    backup_eligible boolean NOT NULL,
    backup_state    boolean NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_used_at    timestamptz
);

-- UNIQUE et global, non pas par opérateur : un identifiant de credential ne peut appartenir qu'à un
-- seul. Deux lignes le portant rendraient l'assertion ambiguë — et c'est par cet index qu'on la
-- retrouve.
CREATE UNIQUE INDEX webauthn_credentials_credential_id_key
    ON webauthn_credentials (credential_id);

-- « Les passkeys de cet opérateur » est le chemin de trois gestes : composer les options
-- d'assertion, compter ce que `/auth/me` annonce, et refuser le retrait du dernier facteur.
CREATE INDEX webauthn_credentials_operator_id_idx ON webauthn_credentials (operator_id);

-- Le défi d'une cérémonie, et l'état que la bibliothèque exige de retrouver intact pour la finir.
--
-- **Lié à `sessions.id` et non à l'opérateur**, ce que 00005 avait annoncé en toutes lettres. C'est
-- plus étroit : une cérémonie commencée dans une session ne se finit pas dans une autre, même du
-- même opérateur. L'appartenance à l'opérateur en découle par jointure, elle n'a pas à être redite.
--
-- Une table distincte de `mfa_challenges` : les deux objets n'ont ni la même clé, ni la même durée,
-- ni le même contenu. Celui de 00004 porte l'empreinte d'un jeton rendu au client ; celui-ci porte
-- un état que le serveur seul relit.
CREATE TABLE webauthn_challenges (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    session_id  uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    -- Un défi d'assertion qui finirait un enregistrement contournerait la preuve de possession :
    -- l'opérateur enregistrerait une passkey neuve en présentant… rien. Le `CHECK` est ce qui rend
    -- l'oubli impossible à écrire.
    purpose     text NOT NULL CHECK (purpose IN ('registration', 'assertion')),
    -- L'état de cérémonie sérialisé : le défi tiré, l'utilisateur visé, les credentials admis et
    -- l'origine à laquelle la cérémonie est liée. `jsonb` parce que sa forme appartient à la
    -- bibliothèque et changera avec elle — la figer en colonnes ferait d'un bump une migration.
    ceremony    jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    -- Nullable = l'anti-rejeu, et `UPDATE` plutôt que `DELETE` pour la même raison qu'en 00004 :
    -- « déjà consommé » reste discernable de « n'a jamais existé », ce dont l'audit de step-025 aura
    -- besoin.
    consumed_at timestamptz,
    CONSTRAINT webauthn_challenges_expires_after_creation CHECK (expires_at > created_at)
);

-- « Le défi de cette session, pour cette cérémonie » est la seule lecture.
CREATE INDEX webauthn_challenges_session_id_idx ON webauthn_challenges (session_id);

-- La purge appartient à step-187, comme celle de `mfa_challenges` et des sessions.
CREATE INDEX webauthn_challenges_expires_at_idx ON webauthn_challenges (expires_at);

-- La colonne que le §3.1 déclarait, et qu'aucun code Go n'a jamais lue. La laisser en place ferait
-- coexister deux endroits qui prétendent porter les passkeys, dont un vide — exactement le genre de
-- texte qui ment sur le code.
ALTER TABLE operators DROP COLUMN mfa_webauthn_credentials;

-- +goose Down

ALTER TABLE operators
    ADD COLUMN mfa_webauthn_credentials jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP TABLE webauthn_challenges;
DROP TABLE webauthn_credentials;

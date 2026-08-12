-- Ce que le second facteur TOTP exige du schéma, et que le §3.1 ne déclarait pas : de quoi refuser
-- un code déjà servi, de quoi borner les essais, et où ranger les codes de récupération. Le §3.1 est
-- amendé dans la même PR, comme step-021 et step-022 l'ont fait pour leurs tables.
--
-- La colonne `operators.mfa_totp_secret`, elle, existe depuis 00001 : rien à créer, tout à remplir.

-- +goose Up

-- Le dernier pas de temps TOTP consommé par cet opérateur. `NULL` = aucun code n'a jamais été
-- accepté.
--
-- **C'est l'anti-rejeu, et il est monotone plutôt qu'à mémoire d'un seul code.** Refuser seulement le
-- code identique laisserait rejouer celui du pas précédent, qui est encore dans la fenêtre de dérive
-- de ±1 pas : le même code intercepté redeviendrait utilisable trente secondes plus tard. Un `<`
-- ferme les deux d'un coup.
--
-- `bigint` plutôt qu'`integer`, par cohérence avec l'`int64` que le code manipule. Ce n'est **pas**
-- une question de débordement : le pas vaut `epoch / 30`, soit ~6,0 × 10⁷ au 12/08/2026, et un
-- `integer` ne déborderait qu'en 4011. (Une rédaction précédente disait 7,3 × 10⁷ et 2038 : les deux
-- chiffres décrivent l'epoch en secondes, pas le pas — la mesure portait sur l'objet voisin.)
--
-- Le pas est calculé sur l'horloge de **ce serveur de base** (`extract(epoch from now())`), jamais en
-- Go : deux instances aux horloges décalées accepteraient un code que l'autre refuse, et compareraient
-- cette colonne à deux échelles différentes.
ALTER TABLE operators ADD COLUMN mfa_totp_last_step bigint;

-- Les codes de récupération : le chemin de sortie du jour où le téléphone est perdu.
CREATE TABLE mfa_recovery_codes (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    -- `CASCADE` : un code de récupération ne survit pas à l'opérateur qu'il dépanne.
    operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    -- Argon2id sous forme PHC, **et non SHA-256** — à l'inverse de ce que ce dépôt a tranché pour le
    -- jeton de challenge (00004) et pour celui de session (00005). La différence est réelle : ces
    -- deux-là font 256 bits tirés d'un CSPRNG, sans déficit d'entropie à compenser. Un code de
    -- récupération se tape à la main, donc il est court — cinquante bits ici. Cinquante bits se
    -- parcourent en quelques dizaines d'heures contre du SHA-256, et jamais contre argon2id.
    --
    -- `text` et non `bytea` : c'est l'encodage PHC qui est stocké, avec ses paramètres, pour qu'un
    -- relèvement du coût n'invalide pas les codes déjà remis (`internal/auth`).
    code_hash   text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Le seul chemin de lecture : « les codes de cet opérateur », tous, parce que la confrontation les
-- parcourt tous — s'arrêter au premier qui colle ferait de la durée de la réponse un indicateur du
-- rang du code employé.
--
-- Aucune unicité sur `code_hash` : deux hachages argon2id du même code diffèrent, leurs sels étant
-- tirés au hasard. Un index unique y serait une décoration qui ne refuse rien.
CREATE INDEX mfa_recovery_codes_operator_id_idx ON mfa_recovery_codes (operator_id);

-- +goose Down

DROP TABLE mfa_recovery_codes;

ALTER TABLE operators DROP COLUMN mfa_totp_last_step;

-- La session du tableau de bord : une ligne par session ouverte, et le cookie n'en porte que le
-- jeton.
--
-- **Le §3.1 ne la déclarait pas.** step-005 l'a explicitement renvoyée « à la step qui saura ce
-- qu'elle doit contenir » — c'est celle-ci, et elle amende le §3.1 dans la même PR, comme step-021
-- l'a fait pour ses deux tables.
--
-- **Avec état, et la raison n'est pas le confort.** Un jeton signé sans état ne se révoque pas avant
-- son échéance ; trois choses de ce jalon l'exigent : le logout, la désactivation d'un opérateur
-- (step-029), et l'élévation qui change **au milieu** d'une session (step-023, step-024).
--
-- L'arithmétique de temps se fait ici, sur l'horloge du serveur, et en secondes — même raison qu'en
-- 00002 et 00004 : deux instances qui compareraient chacune la leur résoudraient deux sessions
-- différentes sur la même ligne, et `timestamptz + interval` porteur de jours suit le fuseau de la
-- session et non UTC.

-- +goose Up

CREATE TABLE sessions (
    -- Stable pour toute la vie de la session, **y compris à travers l'élévation** : step-024 y liera
    -- ses défis WebAuthn. C'est `token_hash` qui tourne, jamais cette clé — la confondre avec le
    -- jeton rendrait la régénération impossible sans casser les références.
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    -- `CASCADE` : supprimer un opérateur ferme ses sessions. Il n'y a rien à conserver ici,
    -- contrairement à `audit_log`, qui est terminal.
    operator_id  uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    -- L'**empreinte** du jeton, jamais le jeton : une lecture de la base ne rend aucun cookie
    -- rejouable. SHA-256 et non argon2id, même arbitrage qu'en 00004 — 256 bits tirés d'un CSPRNG
    -- n'ont aucun déficit d'entropie à compenser, et ce hachage est sur le chemin de **chaque**
    -- requête.
    --
    -- Régénérée à l'élévation : sans ça, un jeton obtenu avant le second facteur reste valable
    -- après (fixation de session).
    token_hash   bytea NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- L'échéance **absolue**, posée une fois et que rien ne repousse — pas même l'élévation. Elle
    -- borne ce qu'un cookie volé vaut au maximum, indépendamment de l'activité de son voleur.
    expires_at   timestamptz NOT NULL,
    -- L'échéance **glissante**, repoussée à chaque requête résolue. Elle ferme le poste qu'on a
    -- quitté, ce que l'absolue ne fait pas. Vivante ⇔ les deux tiennent.
    --
    -- La fenêtre d'inactivité est appliquée par la requête et non figée ici : l'écrire dans le
    -- schéma obligerait une migration pour la changer.
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    -- Nullable : l'absence est « premier facteur seulement ». Non nul **et** session vivante = la
    -- session est élevée. Il n'y a pas de seconde échéance qui périmerait l'élévation seule —
    -- redemander un code au milieu d'une opération est ce qui fait desserrer une garde.
    --
    -- Un instant et non un booléen, pour que l'audit sache **quand**.
    elevated_at  timestamptz,
    -- Une échéance antérieure à la naissance rendrait la session inutilisable dès sa création : le
    -- symptôme serait un opérateur qui se reconnecte en boucle, sans rien dans les journaux.
    CONSTRAINT sessions_expires_after_creation CHECK (expires_at > created_at)
);

-- UNIQUE et non un index simple : c'est le chemin de lecture — on retrouve une session **par son
-- jeton** — et c'est aussi ce qui ferait échouer bruyamment un générateur qui répéterait une valeur.
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);

-- « Fermer toutes les sessions de cet opérateur » est le geste de step-029, et il ne peut pas
-- emprunter la clé primaire.
CREATE INDEX sessions_operator_id_idx ON sessions (operator_id);

-- La purge appartient à step-187, et cet index est ce qui lui suffit : `expires_at` est un plafond
-- absolu, donc `expires_at <= now()` borne à lui seul la croissance de la table. Une session oisive
-- traîne jusque-là sans rien ouvrir — la vivacité se décide à la lecture, pas à la présence de la
-- ligne.
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- +goose Down

DROP TABLE sessions;

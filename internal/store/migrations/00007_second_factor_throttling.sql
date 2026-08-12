-- Une troisième dimension comptée : les échecs de **second** facteur, par opérateur.
--
-- **Elle existe parce qu'une revue a montré que rien ne bornait la recherche exhaustive d'un code à
-- six chiffres.** Le compteur d'échecs du premier facteur (00004) ne borne que les tentatives qui
-- échouent : `RecordFailure` n'est appelé que depuis le chemin d'échec de la connexion, et le chemin
-- de succès efface le compteur d'adresse. Qui détient un mot de passe valide ne fait donc monter
-- aucun compteur, et peut émettre autant de challenges qu'il veut depuis une seule adresse — cinq
-- essais chacun, sur un espace de 10⁶ codes dont trois sont valables à la fois. De l'ordre de
-- 231 000 essais pour une chance sur deux, soit quelques heures, sans qu'aucun verrou ne le voie.
--
-- **La même table et non une quatrième**, et c'est la raison qui a fait choisir une table unique en
-- 00004 : le mécanisme d'incrément atomique, la fenêtre d'oubli et la dérivation du verrou depuis
-- `(failures, last_failure_at)` sont déjà écrits et déjà éprouvés. Une table jumelle en serait une
-- seconde rédaction, qui divergerait.
--
-- `subject` porte l'identifiant de l'opérateur, et non son adresse : à ce stade du parcours, il est
-- authentifié — le premier facteur est franchi. Il n'y a plus d'oracle d'énumération à fermer ici,
-- et compter sur l'identifiant survit à un changement d'adresse.
--
-- **Le prix, écrit plutôt que tu** : le verrou porte sur l'opérateur, et qui détient son mot de passe
-- peut donc le tenir hors de son propre second facteur, un quart d'heure à la fois. Ce n'est pas une
-- capacité neuve — cinq mots de passe faux verrouillent déjà son adresse depuis 00004 — et
-- l'alternative, ne rien borner, laisse forcer le facteur lui-même.

-- +goose Up

ALTER TABLE login_attempt_counters DROP CONSTRAINT login_attempt_counters_scope_check;

ALTER TABLE login_attempt_counters
    ADD CONSTRAINT login_attempt_counters_scope_check
        CHECK (scope IN ('email', 'source', 'mfa'));

-- +goose Down

-- Les lignes de la dimension retirée partent avec elle : la contrainte les refuserait, et un `DOWN`
-- qui échoue sur une donnée que l'`UP` a rendue légitime n'est pas réversible.
DELETE FROM login_attempt_counters WHERE scope = 'mfa';

ALTER TABLE login_attempt_counters DROP CONSTRAINT login_attempt_counters_scope_check;

ALTER TABLE login_attempt_counters
    ADD CONSTRAINT login_attempt_counters_scope_check
        CHECK (scope IN ('email', 'source'));

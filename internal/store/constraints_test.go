package store_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ce que ces deux suites tiennent est le **contenu** du schéma, que ni l'inventaire des neuf tables
// ni l'empreinte de `base_test.go` n'observent : l'empreinte se compare à elle-même avant et après
// rejeu, donc elle prouve l'idempotence et jamais qu'une contrainte existe. Mesuré le 02/08/2026,
// on pouvait retirer n'importe quel `CHECK`, n'importe quel `ON DELETE` et l'index unique sur
// `lower(email)` sans qu'une seule porte rougisse.
//
// La forme retenue est le **refus observé**, pas l'inventaire de `pg_constraint` : un `CHECK` est un
// refus (critère 3), et ce qu'on veut savoir est qu'une ligne fautive n'entre pas — pas qu'une ligne
// de catalogue porte le bon nom.

// `restrict_violation` et non `foreign_key_violation` : mesuré le 02/08/2026 sur `postgres:18`, un
// `ON DELETE RESTRICT` rend **23001**, là où une clé étrangère non satisfaite rend 23503. Les deux
// codes sont distingués ici parce qu'ils disent deux choses différentes à l'exploitation.
const (
	checkViolation      = "23514"
	uniqueViolation     = "23505"
	foreignKeyViolation = "23503"
	restrictViolation   = "23001"
)

// Les identifiants sont fixes et lisibles : ces bases sont jetées à la fin du test, et un UUID
// littéral se retrouve à l'œil dans le message d'un échec.
const (
	seedOperator  = "01900000-0000-7000-8000-000000000001"
	seedRole      = "01900000-0000-7000-8000-000000000002"
	seedAlertRule = "01900000-0000-7000-8000-000000000003"
)

// seedSQL pose une ligne légitime dans chacune des tables contraintes. Il est joué au début de
// **chaque** cas, et son succès est asserté : une contrainte trop serrée — celle qui refuserait du
// légitime — tombe ici, et non dans six mois sur un écran.
const seedSQL = `
	INSERT INTO operators (id, email, display_name, password_hash)
	VALUES ('` + seedOperator + `', 'alice@exemple.test', 'Alice', 'hash');

	INSERT INTO permissions (key, category, description)
	VALUES ('routing:read', 'routing', 'Lire le plan de routage');

	INSERT INTO roles (id, name, description, created_by)
	VALUES ('` + seedRole + `', 'exploitant', 'Exploitation courante', '` + seedOperator + `');

	INSERT INTO role_permissions (role_id, permission_key)
	VALUES ('` + seedRole + `', 'routing:read');

	INSERT INTO operator_roles (operator_id, role_id)
	VALUES ('` + seedOperator + `', '` + seedRole + `');

	INSERT INTO alert_rules (id, metric, scope, scope_id, evaluation_owner, condition_json, status,
		created_by)
	VALUES ('` + seedAlertRule + `', 'sms.throughput', 'connector', 'cnx-42', 'bff',
		'{"below": 10}'::jsonb, 'active', '` + seedOperator + `');

	INSERT INTO notifications (alert_rule_id, source, severity, message)
	VALUES ('` + seedAlertRule + `', 'bff_evaluator', 'warning', 'Le débit du connecteur a chuté');

	INSERT INTO saved_views (operator_id, view_type, filters_json, name)
	VALUES ('` + seedOperator + `', 'cdr_search', '{"status": "failed"}'::jsonb, 'Échecs du jour');`

func TestTheSchemaRefusesWhatItMustRefuse(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		arrange  string
		act      string
		sqlstate string
	}{
		{
			name: "deux adresses qui ne diffèrent que par la casse sont la même personne",
			act: `INSERT INTO operators (email, display_name, password_hash)
				VALUES ('Alice@Exemple.test', 'Alice bis', 'hash')`,
			sqlstate: uniqueViolation,
		},
		{
			name: "un opérateur n'a que deux états",
			act: `INSERT INTO operators (email, display_name, password_hash, status)
				VALUES ('bob@exemple.test', 'Bob', 'hash', 'suspendu')`,
			sqlstate: checkViolation,
		},
		{
			name:     "une permission appartient à une catégorie du catalogue",
			act:      `INSERT INTO permissions (key, category, description) VALUES ('x:read', 'divers', 'x')`,
			sqlstate: checkViolation,
		},
		{
			name:     "un rôle porte un nom unique",
			act:      `INSERT INTO roles (name, description) VALUES ('exploitant', 'doublon')`,
			sqlstate: uniqueViolation,
		},
		{
			name: "une règle d'alerte porte une portée connue",
			act: `INSERT INTO alert_rules (metric, scope, evaluation_owner, condition_json, status)
				VALUES ('m', 'client', 'bff', '{}'::jsonb, 'active')`,
			sqlstate: checkViolation,
		},
		{
			name: "l'évaluation d'une alerte appartient à Alertmanager ou au BFF",
			act: `INSERT INTO alert_rules (metric, scope, evaluation_owner, condition_json, status)
				VALUES ('m', 'global', 'prometheus', '{}'::jsonb, 'active')`,
			sqlstate: checkViolation,
		},
		{
			name: "une notification vient d'une des trois sources",
			act: `INSERT INTO notifications (source, severity, message)
				VALUES ('cron', 'info', 'msg')`,
			sqlstate: checkViolation,
		},
		{
			name: "une notification porte une des trois sévérités",
			act: `INSERT INTO notifications (source, severity, message)
				VALUES ('alertmanager', 'fatal', 'msg')`,
			sqlstate: checkViolation,
		},
		{
			name: "une vue sauvegardée porte un des deux types d'écran",
			act: `INSERT INTO saved_views (operator_id, view_type, filters_json, name)
				VALUES ('` + seedOperator + `', 'facturation', '{}'::jsonb, 'v')`,
			sqlstate: checkViolation,
		},
		{
			name: "un opérateur ne nomme pas deux fois la même vue",
			act: `INSERT INTO saved_views (operator_id, view_type, filters_json, name)
				VALUES ('` + seedOperator + `', 'cdr_search', '{}'::jsonb, 'Échecs du jour')`,
			sqlstate: uniqueViolation,
		},
		{
			name:     "un rôle n'accorde pas une permission absente du catalogue",
			act:      `INSERT INTO role_permissions (role_id, permission_key) VALUES ('` + seedRole + `', 'x:read')`,
			sqlstate: foreignKeyViolation,
		},
		{
			name:     "retirer une permission que des rôles accordent échoue bruyamment",
			act:      `DELETE FROM permissions WHERE key = 'routing:read'`,
			sqlstate: restrictViolation,
		},
		{
			name:     "supprimer un rôle encore détenu échoue bruyamment",
			act:      `DELETE FROM roles WHERE id = '` + seedRole + `'`,
			sqlstate: restrictViolation,
		},
		{
			name: "le journal ne perd jamais son auteur",
			arrange: `INSERT INTO audit_log (operator_id, action)
				VALUES ('` + seedOperator + `', 'operator.login')`,
			act:      `DELETE FROM operators WHERE id = '` + seedOperator + `'`,
			sqlstate: restrictViolation,
		},
	}

	ctx := t.Context()
	conn := migratedDatabase(ctx, t)

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			tx := seededTransaction(ctx, t, conn)

			if testCase.arrange != "" {
				_, err := tx.Exec(ctx, testCase.arrange)
				require.NoError(t, err, "préparer le cas")
			}

			_, err := tx.Exec(ctx, testCase.act)

			var pgErr *pgconn.PgError

			require.Errorf(t, err, "le schéma a accepté ce qu'il doit refuser : %s", testCase.name)
			require.ErrorAsf(t, err, &pgErr, "erreur inattendue : %v", err)
			assert.Equalf(t, testCase.sqlstate, pgErr.Code,
				"le refus vient de %s (%s) et non de la contrainte attendue", pgErr.Code, pgErr.Message)
		})
	}
}

// Ce qu'un `ON DELETE` décide n'est pas un refus mais une **conséquence**, et une conséquence
// silencieuse : un `CASCADE` posé là où le §3.1 veut un `SET NULL` effacerait des notifications
// déjà signalées sans qu'aucune erreur ne remonte.
func TestWhatADeletionCarriesAway(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		arrange string
		act     string
		probe   string
	}{
		{
			name:    "le départ d'un opérateur emporte ses vues et ses rôles détenus, jamais ce qu'il a créé",
			arrange: `DELETE FROM audit_log`,
			act:     `DELETE FROM operators WHERE id = '` + seedOperator + `'`,
			probe: `SELECT (SELECT count(*) FROM saved_views) = 0
				AND (SELECT count(*) FROM operator_roles) = 0
				AND (SELECT created_by IS NULL FROM roles WHERE id = '` + seedRole + `')
				AND (SELECT created_by IS NULL FROM alert_rules WHERE id = '` + seedAlertRule + `')`,
		},
		{
			name:    "supprimer un rôle libre emporte les permissions qu'il accordait",
			arrange: `DELETE FROM operator_roles`,
			act:     `DELETE FROM roles WHERE id = '` + seedRole + `'`,
			probe:   `SELECT (SELECT count(*) FROM role_permissions) = 0`,
		},
		{
			name:  "supprimer une règle d'alerte n'efface pas ce qu'elle a déjà signalé",
			act:   `DELETE FROM alert_rules WHERE id = '` + seedAlertRule + `'`,
			probe: `SELECT (SELECT count(*) FROM notifications WHERE alert_rule_id IS NULL) = 1`,
		},
	}

	ctx := t.Context()
	conn := migratedDatabase(ctx, t)

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			tx := seededTransaction(ctx, t, conn)

			if testCase.arrange != "" {
				_, err := tx.Exec(ctx, testCase.arrange)
				require.NoError(t, err, "préparer le cas")
			}

			_, err := tx.Exec(ctx, testCase.act)
			require.NoError(t, err, "la suppression a échoué")

			var asExpected bool

			require.NoError(t, tx.QueryRow(ctx, testCase.probe).Scan(&asExpected), "observer les restes")
			assert.True(t, asExpected, "la suppression n'a pas emporté ce qu'elle devait, ou a emporté "+
				"ce qu'elle devait laisser")
		})
	}
}

// migratedDatabase taille une base neuve, y joue les migrations et rend une connexion nue. Une base
// par test — les cas, eux, s'isolent dans une transaction annulée.
func migratedDatabase(ctx context.Context, t *testing.T) *pgx.Conn {
	t.Helper()

	dsn := freshDatabase(ctx, t)

	_, err := store.Migrate(ctx, dsn)
	require.NoError(t, err, "jouer les migrations")

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err, "se connecter à la base du test")

	t.Cleanup(func() { _ = conn.Close(context.WithoutCancel(ctx)) })

	return conn
}

// seededTransaction ouvre une transaction, y pose le jeu de lignes légitimes, et l'annule à la fin
// du cas. L'annulation est ce qui permet à tous les cas de partager une base : ils partent tous du
// même schéma peuplé de la même façon, et aucun ne voit ce que le précédent a écrit.
func seededTransaction(ctx context.Context, t *testing.T, conn *pgx.Conn) pgx.Tx {
	t.Helper()

	tx, err := conn.Begin(ctx)
	require.NoError(t, err, "ouvrir la transaction du cas")

	t.Cleanup(func() {
		if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			t.Errorf("annuler la transaction du cas : %v", err)
		}
	})

	_, err = tx.Exec(ctx, seedSQL)
	require.NoError(t, err, "le schéma refuse des lignes légitimes : une contrainte est trop serrée")

	return tx
}

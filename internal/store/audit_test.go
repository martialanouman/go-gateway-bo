package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func auditOn(t *testing.T) (*store.Audit, string) {
	t.Helper()

	pool, dsn := migratedPool(t)

	return store.NewAudit(pool), dsn
}

func TestUnEvenementSeRelitTelQuEcrit(t *testing.T) {
	t.Parallel()

	audit, dsn := auditOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	err := audit.Record(t.Context(), store.Event{
		OperatorID: operator,
		Action:     "passkey.remove",
		TargetType: "webauthn_credential",
		TargetID:   "0198f2c0-0000-7000-8000-000000000000",
		Before:     store.NewFields().Text("transports", "internal").Number("signCount", 42),
		IPAddress:  "203.0.113.7",
	})
	require.NoError(t, err)

	// L'aller-retour entier en une lecture : une colonne oubliée à l'écriture se verrait ici, là où
	// un contrôle sur le seul `action` laisserait passer six champs perdus.
	var written string

	queryOn(t, dsn, `
		SELECT jsonb_build_object(
			'action', action, 'targetType', target_type, 'targetId', target_id,
			'address', host(ip_address), 'before', before_json, 'after', after_json)::text
		FROM audit_log WHERE operator_id = $1`, &written, operator)

	assert.JSONEq(t, `{
		"action": "passkey.remove",
		"targetType": "webauthn_credential",
		"targetId": "0198f2c0-0000-7000-8000-000000000000",
		"address": "203.0.113.7",
		"before": {"transports": "internal", "signCount": 42},
		"after": null
	}`, written,
		"l'adresse va en clair, délibérément ; et un état absent laisse la colonne **nulle** plutôt "+
			"qu'un objet vide — « rien à dire » et « un objet sans champ » ne se lisent pas pareil")
}

func TestUnEvenementSansOperateurEstAccepte(t *testing.T) {
	t.Parallel()

	audit, dsn := auditOn(t)

	require.NoError(t, audit.Record(t.Context(), store.Event{Action: "system.start"}))

	var orphans int64

	queryOn(t, dsn, `SELECT count(*) FROM audit_log WHERE operator_id IS NULL`, &orphans)
	assert.EqualValues(t, 1, orphans, "un événement système n'a pas d'auteur, et la colonne l'admet")
}

func TestLeJournalNePerdJamaisSonAuteur(t *testing.T) {
	t.Parallel()

	audit, dsn := auditOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	require.NoError(t, audit.Record(t.Context(), store.Event{
		OperatorID: operator,
		Action:     "operator.login",
	}))

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	_, err = conn.Exec(t.Context(), `DELETE FROM operators WHERE id = $1`, operator)
	assert.Error(t, err,
		"supprimer un opérateur qui a laissé une trace doit échouer : un opérateur qui part se "+
			"désactive, il ne s'efface pas")
}

// L'audit d'une action locale partage sa transaction : ou les deux, ou aucune. C'est ce qui rend la
// trace non contournable — un chemin qui commiterait l'action et perdrait l'audit laisserait
// exactement le trou qu'une enquête cherche.
func TestUnAuditAnnuleAvecSaTransactionNeLaissePasDeTrace(t *testing.T) {
	t.Parallel()

	pool, dsn := migratedPool(t)
	audit := store.NewAudit(pool)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)

	require.NoError(t, audit.RecordTx(t.Context(), tx, store.Event{
		OperatorID: operator,
		Action:     "passkey.remove",
	}))

	require.NoError(t, tx.Rollback(t.Context()))

	var written int64

	queryOn(t, dsn, `SELECT count(*) FROM audit_log`, &written)
	assert.Zero(t, written, "l'action a été annulée : sa trace ne doit pas survivre")
}

func TestUnEtatVideNeLaissePasDObjetVide(t *testing.T) {
	t.Parallel()

	encoded, err := store.NewFields().JSON()
	require.NoError(t, err)
	assert.Nil(t, encoded)

	var absent *store.Fields

	encoded, err = absent.JSON()
	require.NoError(t, err)
	assert.Nil(t, encoded, "un état absent se sérialise comme un état vide : nul, pas `{}`")
}

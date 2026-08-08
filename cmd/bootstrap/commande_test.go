package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// La DoD de la fiche demande que « deux exécutions successives laissent la base **identique** —
// comparée, pas supposée ». Comparée ici, et sur la **commande** : l'empreinte inclut les
// identifiants `uuidv7()` et les dates de création, donc un seed qui supprimerait et recréerait les
// neuf rôles à l'identique se verrait.
func TestDeuxExecutionsLaissentLaBaseIdentique(t *testing.T) {
	ctx := t.Context()
	dsn := migratedDatabase(ctx, t)

	first := &bytes.Buffer{}
	require.NoError(t, start(strings.NewReader(dsn), first, &bytes.Buffer{}, nil))
	assert.Contains(t, first.String(), "44 permission(s) posée(s)")

	before := vocabularyFingerprint(ctx, t, dsn)

	second := &bytes.Buffer{}
	require.NoError(t, start(strings.NewReader(dsn), second, &bytes.Buffer{}, nil))

	assert.Contains(t, second.String(), "déjà à jour")
	assert.Equal(t, before, vocabularyFingerprint(ctx, t, dsn),
		"la seconde exécution a changé la base")
}

// Le contrôle de schéma est dans la commande, et non seulement dans le serveur : sans lui, semer une
// base non migrée échouerait sur « relation "permissions" does not exist » — vrai, et muet sur le
// remède.
func TestSemerUneBaseNonMigreeEstRefuseEnNommantLesDeuxVersions(t *testing.T) {
	ctx := t.Context()
	dsn := freshDatabase(ctx, t)

	err := start(strings.NewReader(dsn), &bytes.Buffer{}, &bytes.Buffer{}, nil)

	require.Error(t, err, "la commande a semé sur une base qu'aucune migration n'a touchée")

	var outdated store.OutdatedSchemaError

	require.ErrorAs(t, err, &outdated)
	assert.Contains(t, err.Error(), store.AppliedVersionPhrase(0))
	assert.Contains(t, err.Error(), store.ExpectedVersionPhrase(outdated.Embedded))
}

// La divergence part sur la **sortie d'erreur** et n'arrête pas le déploiement. Le cas voisin de
// `main_test.go` appelle `report` directement : intervertir les deux écrivains dans `start` lui
// échappait entièrement.
func TestUneDivergenceNArretePasLaCommandeEtNeSaliPasLeCompteRendu(t *testing.T) {
	ctx := t.Context()
	dsn := migratedDatabase(ctx, t)

	require.NoError(t, start(strings.NewReader(dsn), &bytes.Buffer{}, &bytes.Buffer{}, nil))

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	_, err = conn.Exec(ctx,
		"INSERT INTO permissions (key, category, description) VALUES ('legacy:read', 'audit', "+
			"'clé d’une release précédente')")
	require.NoError(t, err)

	out, errOut := &bytes.Buffer{}, &bytes.Buffer{}

	require.NoError(t, start(strings.NewReader(dsn), out, errOut, nil),
		"un reliquat de vocabulaire a arrêté le déploiement")

	assert.Contains(t, errOut.String(), "legacy:read")
	assert.NotContains(t, out.String(), "legacy:read",
		"l'avertissement s'est mêlé au compte rendu de la sortie standard")

	var stillThere bool

	require.NoError(t, conn.QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM permissions WHERE key = 'legacy:read')").Scan(&stillThere))
	assert.True(t, stillThere, "la commande a supprimé une clé qu'elle annonce conserver")
}

// vocabularyFingerprint relève le contenu semé, **identifiants et dates compris** — contrairement à
// l'empreinte de `internal/store`, qui les écarte parce qu'elle compare deux bases distinctes. Ici
// c'est la même base avant et après, donc ce sont précisément eux qui trahiraient un seed qui
// détruit puis recrée.
func vocabularyFingerprint(ctx context.Context, t *testing.T, dsn string) string {
	t.Helper()

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	const catalog = `
		SELECT coalesce(string_agg(entry, E'\n' ORDER BY entry), '')
		FROM (
			SELECT format('permission %s %s %s', key, category, description) AS entry FROM permissions
			UNION ALL
			SELECT format('role %s %s %s %s %s', id, name, is_default, description, created_at) FROM roles
			UNION ALL
			SELECT format('attribution %s %s', role_id, permission_key) FROM role_permissions
		) AS vocabulaire`

	var fingerprint string

	require.NoError(t, conn.QueryRow(ctx, catalog).Scan(&fingerprint))
	require.NotEmpty(t, fingerprint,
		"l'empreinte est vide : la comparaison « avant/après » serait vraie sans rien observer")

	return fingerprint
}

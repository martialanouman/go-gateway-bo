package main

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/permissions"
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
	require.NoError(t, start(strings.NewReader(dsn), first, &bytes.Buffer{}, nil, ownerEnv))

	// Le compte se dérive du catalogue : un `44` écrit ici serait la seconde déclaration tenue à la
	// main que `catalog.go` refuse explicitement, et son incrément 44 → 45 ne porterait aucune
	// information relisible.
	assert.Contains(t, first.String(),
		fmt.Sprintf("%d permission(s) posée(s)", len(permissions.All())))

	before := vocabularyFingerprint(ctx, t, dsn)

	second := &bytes.Buffer{}
	require.NoError(t, start(strings.NewReader(dsn), second, &bytes.Buffer{}, nil, ownerEnv))

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

	err := start(strings.NewReader(dsn), &bytes.Buffer{}, &bytes.Buffer{}, nil, ownerEnv)

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

	require.NoError(t, start(strings.NewReader(dsn), &bytes.Buffer{}, &bytes.Buffer{}, nil, ownerEnv))

	conn, err := pgx.Connect(ctx, dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	_, err = conn.Exec(ctx,
		"INSERT INTO permissions (key, category, description) VALUES ('legacy:read', 'audit', "+
			"'clé d’une release précédente')")
	require.NoError(t, err)

	out, errOut := &bytes.Buffer{}, &bytes.Buffer{}

	require.NoError(t, start(strings.NewReader(dsn), out, errOut, nil, ownerEnv),
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

// La ligne amendée de la fiche (DN-1) : la commande **se rejoue**, et c'est la création du compte
// qui ne se rejoue pas. Le mode d'échec que le « refuse » d'origine visait — un second compte
// propriétaire créé en douce par quelqu'un qui relance avec d'autres variables — est couvert à
// l'identique, sans casser la rejouabilité.
func TestUnSecondPassageNeCreeAucunSecondOperateur(t *testing.T) {
	t.Parallel()

	dsn := migratedDatabase(t.Context(), t)

	require.NoError(t, start(strings.NewReader(dsn), &bytes.Buffer{}, &bytes.Buffer{}, nil, ownerEnv))

	second := &bytes.Buffer{}
	require.NoError(t, start(strings.NewReader(dsn), second, &bytes.Buffer{}, nil, otherOwnerEnv),
		"le second passage a échoué : un déploiement qui rappelle la commande casserait")

	assert.Contains(t, second.String(), "aucun compte n'a été créé")

	assert.Equal(t, []string{"camille.durand@exemple.test"}, operatorEmails(t, dsn),
		"un second compte propriétaire a été créé, ou le premier a été remplacé")
}

// Sans les variables, une installation neuve doit **refuser** en les nommant : la laisser passer
// livrerait un vocabulaire complet et personne pour l'exercer, ce qui a l'air d'une réussite.
func TestUneInstallationNeuveSansVariablesRefuseEnLesNommant(t *testing.T) {
	t.Parallel()

	dsn := migratedDatabase(t.Context(), t)

	err := start(strings.NewReader(dsn), &bytes.Buffer{}, &bytes.Buffer{}, nil,
		func(string) (string, bool) { return "", false })

	require.Error(t, err)

	for _, name := range []string{
		config.EnvBootstrapOperatorEmail,
		config.EnvBootstrapOperatorName,
		config.EnvBootstrapOperatorPassword,
	} {
		assert.Contains(t, err.Error(), name, "le refus ne nomme pas %s", name)
	}
}

// Le compte propriétaire détient le rôle qui accorde tout. Sans lui il pourrait se connecter et ne
// rien faire — une installation qui a l'air bonne et dans laquelle personne ne peut travailler.
func TestLeCompteProprietaireDetientLeRoleQuiAccordeTout(t *testing.T) {
	t.Parallel()

	dsn := migratedDatabase(t.Context(), t)
	require.NoError(t, start(strings.NewReader(dsn), &bytes.Buffer{}, &bytes.Buffer{}, nil, ownerEnv))

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	var roles []string

	rows, err := conn.Query(t.Context(),
		`SELECT r.name FROM operator_roles orl JOIN roles r ON r.id = orl.role_id`)
	require.NoError(t, err)

	roles, err = pgx.CollectRows(rows, pgx.RowTo[string])
	require.NoError(t, err)

	assert.Equal(t, []string{permissions.SuperAdminRole}, roles)
}

// otherOwnerEnv est l'environnement d'un **second** administrateur qui relancerait la commande. Il
// diffère d'ownerEnv sur les trois valeurs : si la garde tombait, le compte créé porterait cette
// adresse-là, et le test le verrait.
func otherOwnerEnv(name string) (string, bool) {
	value, found := map[string]string{
		config.EnvBootstrapOperatorEmail:    "quelqun.dautre@exemple.test",
		config.EnvBootstrapOperatorName:     "Quelqu'un d'autre",
		config.EnvBootstrapOperatorPassword: "un autre mot de passe d'installation",
	}[name]

	return value, found
}

func operatorEmails(t *testing.T, dsn string) []string {
	t.Helper()

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	rows, err := conn.Query(t.Context(), `SELECT email FROM operators ORDER BY email`)
	require.NoError(t, err)

	emails, err := pgx.CollectRows(rows, pgx.RowTo[string])
	require.NoError(t, err)

	return emails
}

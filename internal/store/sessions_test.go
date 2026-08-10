package store_test

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	// Les deux échéances des tests sont larges : ce qu'ils observent est le verdict de vivacité, pas
	// l'écoulement du temps. Les cas qui font mourir une session reculent son horodatage en base
	// plutôt que d'attendre — précédent des verrous de step-021.
	testLifetime = 12 * time.Hour
	testIdle     = 2 * time.Hour
)

// sessionsOn taille une base neuve, la migre, et rend un accès prêt à servir avec le DSN qui a servi
// à l'ouvrir — les cas en ont besoin pour vieillir une ligne ou désactiver un compte.
func sessionsOn(t *testing.T) (*store.Sessions, string) {
	t.Helper()

	dsn, err := createDatabase(t.Context())
	require.NoError(t, err)

	_, err = store.Migrate(t.Context(), dsn)
	require.NoError(t, err)

	pool, err := store.NewPool(t.Context(), dsn)
	require.NoError(t, err)

	return store.NewSessions(pool), dsn
}

// tokenHash imite ce que fait `internal/session` : la base ne voit jamais qu'une empreinte.
func tokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))

	return sum[:]
}

func execOn(t *testing.T, dsn, query string, args ...any) int64 {
	t.Helper()

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	tag, err := conn.Exec(t.Context(), query, args...)
	require.NoError(t, err)

	return tag.RowsAffected()
}

// grantRole pose un rôle et ses permissions, puis l'attribue. Les migrations laissent ces trois
// tables vides — le catalogue est projeté par `Seed`, que ces tests n'exécutent pas : ce qu'ils
// observent est l'union, pas le contenu du catalogue.
func grantRole(t *testing.T, dsn, operatorID, role string, keys ...string) {
	t.Helper()

	for _, key := range keys {
		execOn(t, dsn, `INSERT INTO permissions (key, category, description)
			VALUES ($1, 'billing', 'permission d''essai') ON CONFLICT (key) DO NOTHING`, key)
	}

	var roleID string

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	require.NoError(t, conn.QueryRow(t.Context(),
		`INSERT INTO roles (name, description) VALUES ($1, 'rôle d''essai') RETURNING id::text`,
		role).Scan(&roleID))

	for _, key := range keys {
		_, err = conn.Exec(t.Context(),
			`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)`, roleID, key)
		require.NoError(t, err)
	}

	_, err = conn.Exec(t.Context(),
		`INSERT INTO operator_roles (operator_id, role_id) VALUES ($1, $2)`, operatorID, roleID)
	require.NoError(t, err)
}

// age recule les deux horodatages mobiles d'une session, comme le ferait le temps. Le compte de
// lignes touchées est asserté : un cas qui n'a rien vieilli passerait en silence.
func age(t *testing.T, dsn string, hash []byte, elapsed time.Duration) {
	t.Helper()

	touched := execOn(t, dsn, `
		UPDATE sessions
		SET last_seen_at = last_seen_at - make_interval(secs => $2),
		    created_at   = created_at   - make_interval(secs => $2),
		    expires_at   = expires_at   - make_interval(secs => $2)
		WHERE token_hash = $1`, hash, elapsed.Seconds())
	require.EqualValues(t, 1, touched, "aucune session vieillie : le cas ne prouverait rien")
}

func TestUneSessionOuverteSeRetrouveParSonEmpreinte(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "$argon2id$peu$importe")

	opened, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	resolved, alive, err := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	require.True(t, alive)

	assert.Equal(t, opened.ID, resolved.ID)
	assert.Equal(t, operator, resolved.OperatorID)
	assert.False(t, resolved.Elevated, "le premier facteur seul n'élève pas la session")
	assert.WithinDuration(t, opened.ExpiresAt, resolved.ExpiresAt, time.Second)
}

func TestUneEmpreinteInconnueNeResoutRienSansEtreUneErreur(t *testing.T) {
	t.Parallel()

	sessions, _ := sessionsOn(t)

	_, alive, err := sessions.Resolve(t.Context(), tokenHash("jamais émis"), testIdle)
	require.NoError(t, err, "un cookie inconnu est un cas normal du chemin, pas une panne")
	assert.False(t, alive)
}

// L'échéance absolue est ce qui borne ce qu'un cookie volé vaut au maximum. Sans elle, une session
// qu'on utilise sans arrêt ne meurt jamais.
func TestUneSessionAuDelaDeSonEcheanceAbsolueNEstPlusVivante(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	_, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	age(t, dsn, tokenHash("jeton"), testLifetime+time.Minute)

	_, alive, err := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	assert.False(t, alive)
}

// La fenêtre glissante est ce qui ferme le poste qu'on a quitté. L'absolue ne le fait pas : elle
// tiendrait encore dix heures.
func TestUneSessionOisiveAuDelaDeLaFenetreNEstPlusVivante(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	_, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	// Reculer de trois heures laisse l'échéance absolue à neuf heures devant : seule la fenêtre
	// glissante peut refuser.
	age(t, dsn, tokenHash("jeton"), testIdle+time.Hour)

	_, alive, err := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	assert.False(t, alive)
}

// Un refus ne touche pas la ligne : sans ça, chaque tentative sur une session oisive repousserait sa
// fenêtre, et la session finirait par se rouvrir toute seule sous les tentatives d'un attaquant.
func TestUnRefusNeProlongeJamaisLaSession(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	_, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	age(t, dsn, tokenHash("jeton"), testIdle+time.Hour)

	for range 3 {
		_, alive, resolveErr := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
		require.NoError(t, resolveErr)
		require.False(t, alive)
	}

	var seenMinutesAgo float64

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	require.NoError(t, conn.QueryRow(t.Context(),
		`SELECT EXTRACT(EPOCH FROM (now() - last_seen_at)) / 60 FROM sessions WHERE token_hash = $1`,
		tokenHash("jeton")).Scan(&seenMinutesAgo))

	assert.Greater(t, seenMinutesAgo, 120.0,
		"un refus a repoussé la fenêtre : la session morte ressuscite en se faisant refuser")
}

// L'activité repousse la glissante et **jamais** l'absolue. La confusion est facile à écrire et
// invisible en exploitation : la session deviendrait éternelle tant qu'on s'en sert.
func TestLEcheanceAbsolueNEstJamaisRepoussee(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	opened, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	age(t, dsn, tokenHash("jeton"), time.Hour)

	first, alive, err := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	require.True(t, alive)

	age(t, dsn, tokenHash("jeton"), time.Hour)

	second, alive, err := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	require.True(t, alive, "une heure d'inactivité tient dans la fenêtre de deux heures")

	assert.WithinDuration(t, opened.ExpiresAt.Add(-2*time.Hour), second.ExpiresAt, time.Second,
		"l'échéance absolue a bougé : la session n'expirera jamais tant qu'on s'en sert")
	assert.WithinDuration(t, first.ExpiresAt.Add(-time.Hour), second.ExpiresAt, time.Second)
}

// Sans régénération, un jeton obtenu avant le second facteur reste valable après : celui qui l'a
// intercepté hérite de l'élévation qu'un autre vient de franchir.
func TestLElevationInvalideLeJetonPrecedent(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	opened, err := sessions.Create(t.Context(), operator, tokenHash("avant"), testLifetime)
	require.NoError(t, err)

	elevated, err := sessions.Elevate(t.Context(), tokenHash("avant"), tokenHash("après"), testIdle)
	require.NoError(t, err)
	require.True(t, elevated)

	_, alive, err := sessions.Resolve(t.Context(), tokenHash("avant"), testIdle)
	require.NoError(t, err)
	assert.False(t, alive, "le jeton d'avant le second facteur vaut encore : c'est la fixation de session")

	renewed, alive, err := sessions.Resolve(t.Context(), tokenHash("après"), testIdle)
	require.NoError(t, err)
	require.True(t, alive)

	assert.Equal(t, opened.ID, renewed.ID, "la ligne doit survivre : step-024 y liera ses défis")
	assert.True(t, renewed.Elevated)
	assert.WithinDuration(t, opened.ExpiresAt, renewed.ExpiresAt, time.Second,
		"l'élévation n'achète pas du temps, elle change ce que la session autorise")
}

func TestUneSessionMorteNeSEleveJamais(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	_, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	age(t, dsn, tokenHash("jeton"), testLifetime+time.Minute)

	elevated, err := sessions.Elevate(t.Context(), tokenHash("jeton"), tokenHash("neuf"), testIdle)
	require.NoError(t, err)
	assert.False(t, elevated)
}

// Fermer la session est ce que le logout fait vraiment : expirer le cookie ne protège rien, il
// suffit de le rejouer.
func TestFermerUneSessionEmpecheDeLaRejouer(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	_, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	require.NoError(t, sessions.Delete(t.Context(), tokenHash("jeton")))

	_, alive, err := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	assert.False(t, alive)
}

// Le produit tourne à ≥2 instances derrière un load balancer : une session ouverte par l'une doit
// être résolue par l'autre. C'est la raison pour laquelle elle vit en base et non en mémoire.
func TestDeuxPoolsDistinctsResolventLaMemeSession(t *testing.T) {
	t.Parallel()

	first, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	pool, err := store.NewPool(t.Context(), dsn)
	require.NoError(t, err)

	second := store.NewSessions(pool)

	opened, err := first.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	resolved, alive, err := second.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	require.True(t, alive)
	assert.Equal(t, opened.ID, resolved.ID)

	require.NoError(t, second.Delete(t.Context(), tokenHash("jeton")))

	_, alive, err = first.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	assert.False(t, alive, "une déconnexion servie par une instance doit fermer la session pour l'autre")
}

func TestLesPermissionsSontLUnionDesRolesDetenusSansDoublon(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	grantRole(t, dsn, operator, "facturation", "billing:read", "billing:write")
	grantRole(t, dsn, operator, "lecture", "billing:read", "accounts:read")

	grants, err := sessions.GrantsOf(t.Context(), operator)
	require.NoError(t, err)

	assert.Equal(t, []string{"accounts:read", "billing:read", "billing:write"}, grants.Permissions,
		"`billing:read` est détenue deux fois et ne doit être rendue qu'une")
	assert.Equal(t, "camille@exemple.test", grants.Email)
	assert.Equal(t, "Opérateur d'essai", grants.DisplayName)
}

// Un opérateur sans rôle existe dès step-029. Rendre une absence plutôt qu'un ensemble vide ferait
// dire « pas de session » là où le fait est « aucune permission ».
func TestUnOperateurSansAucunRoleRendUnEnsembleVide(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	grants, err := sessions.GrantsOf(t.Context(), operator)
	require.NoError(t, err)
	assert.Empty(t, grants.Permissions)
}

// La révocation au moment de la désactivation appartient à step-029 ; ce que garde cette ligne-ci
// est la porte passive : un compte désactivé ne résout plus, même avec un cookie encore valide.
func TestUnOperateurDesactiveNeResoutPlusSaSession(t *testing.T) {
	t.Parallel()

	sessions, dsn := sessionsOn(t)
	operator := insertOperator(t, dsn, "camille@exemple.test", "hash")

	_, err := sessions.Create(t.Context(), operator, tokenHash("jeton"), testLifetime)
	require.NoError(t, err)

	execOn(t, dsn, `UPDATE operators SET status = 'disabled' WHERE id = $1`, operator)

	_, alive, err := sessions.Resolve(t.Context(), tokenHash("jeton"), testIdle)
	require.NoError(t, err)
	assert.False(t, alive)
}

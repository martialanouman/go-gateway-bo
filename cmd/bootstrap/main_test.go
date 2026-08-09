package main

import (
	"bytes"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ce que le seed fait est prouvé contre un PostgreSQL réel dans `internal/store`. Ce qui se tient
// ici est ce que cette commande ajoute : par où le DSN entre, et ce que l'exploitant lit en sortie.

// Le DSN porte le mot de passe de la base, et `ps aux` affiche la ligne de commande de tout
// processus de la machine.
func TestLeDSNSeLitSurLEntreeStandard(t *testing.T) {
	t.Parallel()

	const password = "tr0p-secret"

	// Un DSN illisible : la commande ne joint aucune base, et le refus prouve à lui seul qu'elle a lu
	// l'entrée standard — sans lui, elle se serait arrêtée sur « aucun DSN ».
	err := start(strings.NewReader("password = '"+password+"' host=localhost sslmode=zzz\n"),
		io.Discard, io.Discard, nil, ownerEnv)

	require.Error(t, err, "un DSN illisible a été accepté")
	assert.NotContains(t, err.Error(), password,
		"le mot de passe de la base est reparti dans l'erreur que `make bootstrap` imprime")
}

// L'entrée standard porte un DSN elle aussi : sans cela, retirer la garde laisserait la commande se
// plaindre d'une entrée vide — un refus qui parle bien de l'« entrée standard » et prouverait donc
// n'importe quoi.
func TestUnDSNPasseEnArgumentEstRefuse(t *testing.T) {
	t.Parallel()

	err := start(strings.NewReader("host=localhost sslmode=zzz\n"), io.Discard, io.Discard,
		[]string{"postgres://dashboard:secret@localhost/dashboard"}, ownerEnv)

	require.Error(t, err, "un DSN passé en argument a été accepté : il s'afficherait dans `ps aux`")
	assert.Contains(t, err.Error(), "ne prend aucun argument")
	assert.Contains(t, err.Error(), "entrée standard", "le refus ne dit pas par où passer à la place")
}

func TestUneEntreeStandardVideDitCommentPasserLeDSN(t *testing.T) {
	t.Parallel()

	err := start(strings.NewReader("  \n"), io.Discard, io.Discard, nil, ownerEnv)

	require.Error(t, err, "un DSN vide a été accepté")
	assert.Contains(t, err.Error(), "entrée standard")
}

func TestUneBaseDejaSemeeNAnnonceAucunChangement(t *testing.T) {
	t.Parallel()

	out, errOut := &bytes.Buffer{}, &bytes.Buffer{}

	report(out, errOut, store.SeedOutcome{}, store.FirstOperatorOutcome{})

	assert.Contains(t, out.String(), "déjà à jour")
	assert.Empty(t, errOut.String(), "une base sans divergence a fait écrire un avertissement")
}

func TestLaPremiereExecutionCompteCeQuElleAPose(t *testing.T) {
	t.Parallel()

	out, errOut := &bytes.Buffer{}, &bytes.Buffer{}

	report(out, errOut, store.SeedOutcome{
		PermissionsInserted: []permissions.Key{permissions.AuditRead, permissions.RolesManage},
		RolesInserted:       []string{"auditor", "ops"},
		GrantsAdded:         []store.Grant{{Role: "auditor", Key: permissions.AuditRead}},
	}, store.FirstOperatorOutcome{})

	printed := out.String()

	assert.Contains(t, printed, "2 permission(s)")
	assert.Contains(t, printed, "auditor")
	assert.Contains(t, printed, "1 attribution(s)")
	// Le compte rendu dit **aussi** ce qui est arrivé au compte propriétaire, y compris quand rien
	// n'est arrivé : c'est la ligne qui garantit à l'exploitant que personne n'a été créé en douce.
	assert.Contains(t, printed, "aucun compte n'a été créé")
	assert.Empty(t, errOut.String())
}

// Une divergence part sur la sortie d'erreur et n'arrête pas le déploiement (DN-4) : ce qu'on refuse
// est le silence, pas la livraison. Elle doit dire pourquoi la clé n'est pas supprimée, sinon la
// prochaine session le fera à la main et se heurtera au RESTRICT sans comprendre.
func TestUneDivergenceEstDiteSurLaSortieDErreurEtNArretePasLeDeploiement(t *testing.T) {
	t.Parallel()

	out, errOut := &bytes.Buffer{}, &bytes.Buffer{}

	report(out, errOut, store.SeedOutcome{
		UnknownPermissions: []permissions.Key{"legacy:read"},
		UnknownRoles:       []string{"night_ops"},
	}, store.FirstOperatorOutcome{})

	warned := errOut.String()

	assert.Contains(t, warned, "legacy:read")
	assert.Contains(t, warned, "night_ops")
	assert.Contains(t, warned, "migration",
		"l'avertissement ne dit pas par quoi passe le retrait, donc quelqu'un le fera à la main")
	assert.NotContains(t, out.String(), "legacy:read",
		"la divergence est partie sur la sortie standard, où elle se mêle au compte rendu normal")
}

// ownerEnv est l'environnement du compte propriétaire pour les tests qui n'exercent pas sa création :
// il est complet, donc il ne provoque jamais le refus « variables manquantes », et il n'a rien d'un
// secret d'installation.
func ownerEnv(name string) (string, bool) {
	value, found := map[string]string{
		config.EnvBootstrapOperatorEmail:    "camille.durand@exemple.test",
		config.EnvBootstrapOperatorName:     "Camille Durand",
		config.EnvBootstrapOperatorPassword: "un mot de passe d'installation",
	}[name]

	return value, found
}

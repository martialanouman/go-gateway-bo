package mfa_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// closedPool rend un pool fermé : toute requête qui l'atteint échoue bruyamment. C'est ce qui rend
// observable un **ordre** — « refusé sur la forme » et « arrivé jusqu'à la base » deviennent deux
// résultats distincts. Même construction qu'en step-022 pour le sceau du cookie.
func closedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	pool, err := pgxpool.New(context.Background(),
		"postgres://personne@127.0.0.1:1/rien?sslmode=disable")
	require.NoError(t, err)

	pool.Close()

	return pool
}

// **Ce que ce test garde est un ordre**, que rien d'autre n'observe : une valeur qui n'a pas la forme
// d'un challenge est refusée **avant** que la base soit interrogée, sans quoi n'importe qui s'offre un
// aller-retour PostgreSQL par requête.
//
// Le témoin n'est pas décoratif : sans lui, un `Challenge` qui ne ferait jamais rien passerait.
func TestUnChallengeMalFormeNAtteintPasLaBase(t *testing.T) {
	t.Parallel()

	manager, err := mfa.NewManager(store.NewMFA(closedPool(t)),
		store.NewCounter(closedPool(t), store.ScopeTOTPEnroll), []byte(testPassphrase), testIssuer)
	require.NoError(t, err)

	_, live, err := manager.Challenge(context.Background(), "ceci n'est pas un challenge")
	require.NoError(t, err, "une valeur mal formée a quand même interrogé la base")
	assert.False(t, live)

	_, _, err = manager.Challenge(context.Background(), canonicalChallenge)
	require.Error(t, err, "témoin : un challenge bien formé doit, lui, atteindre la base")
}

// `TestUnManagerSeConstruitAvecSaClef` vivait ici. Il affirmait que `NewManager` échoue sur une clé
// qui ne mènerait nulle part — et il était **toujours vrai** : `hkdf.Key` avec SHA-256 et trente-deux
// octets demandés n'échoue pour aucune phrase secrète, quelle qu'elle soit. Aucune mutation ne le
// faisait rougir, parce qu'il n'y avait rien à casser. Retiré plutôt que réparé : ce qu'il prétendait
// garder n'existe pas.
//
// Ce qui garde vraiment la clé est ailleurs : la borne d'entropie de `internal/config` refuse une
// phrase posée à la main, et `cipher_test.go` éprouve le chiffrement de bout en bout.

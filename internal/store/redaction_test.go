package store_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Un DSN mal formé remonte jusqu'à `cmd/migrate`, qui l'imprime sur stderr — donc dans les journaux
// de CI. La rédaction de pgx n'est pas hermétique : mesuré le 02/08/2026 sur v5.10.0, ses deux
// expressions rationnelles couvrent `postgres://u:xxxxx@…` et `password=xxxxx`, mais laissent passer
// `password = 'secret'` avec espaces — une forme que PostgreSQL accepte.
func TestMigrateNeverEchoesTheDatabasePassword(t *testing.T) {
	t.Parallel()

	const secret = "s3cr3t-avec-espaces"

	_, err := store.Migrate(context.Background(), "password = '"+secret+"' host=localhost sslmode=zzz")

	require.Error(t, err)
	assert.NotContains(t, err.Error(), secret, "le mot de passe de la base est parti dans une erreur")
}

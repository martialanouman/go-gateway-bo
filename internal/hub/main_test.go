package hub

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"testing"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

var redisURL string

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	if shared, ok := bddtest.SharedRedisURL(); ok {
		redisURL = shared

		return m.Run()
	}

	container, err := tcredis.Run(ctx, "redis:8-alpine")
	defer func() { _ = testcontainers.TerminateContainer(container) }()

	if err != nil {
		fmt.Fprintf(os.Stderr, "démarrer Redis de test : %v\nRien ne se saute ici : soit un Docker "+
			"joignable, soit un Redis désigné par %s\n", err, bddtest.EnvRedisURL)

		return 1
	}

	if redisURL, err = container.ConnectionString(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "lire l'adresse de Redis de test :", err)

		return 1
	}

	return m.Run()
}

// redisFor rend un client et un espace de noms propre au test : le Redis est partagé entre tests et
// entre paquets, et son Pub/Sub ne connaît pas les bases.
func redisFor(t *testing.T) (*redis.Client, string) {
	t.Helper()

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("adresse de Redis de test : %v", err)
	}

	client := redis.NewClient(options)
	t.Cleanup(func() { _ = client.Close() })

	return client, "test-" + rand.Text()
}

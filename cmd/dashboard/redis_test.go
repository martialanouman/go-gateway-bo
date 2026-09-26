package main

import (
	"context"
	"fmt"

	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

// suiteRedisURL est le Redis que la configuration complète désigne. Chaque configuration y prend son
// propre espace de noms : le Pub/Sub de Redis ignore les bases, et deux scénarios qui partageraient
// un bail se voleraient la passerelle.
var suiteRedisURL string

// startRedis ouvre le Redis de la suite et rend la fonction qui jette le conteneur, quand c'est elle
// qui l'a monté.
func startRedis(ctx context.Context) (func(), error) {
	if shared, ok := bddtest.SharedRedisURL(); ok {
		suiteRedisURL = shared

		return func() {}, nil
	}

	container, err := tcredis.Run(ctx, "redis:8-alpine")
	release := func() { _ = testcontainers.TerminateContainer(container) }

	if err != nil {
		return release, fmt.Errorf("démarrer Redis de test : %w\n\nRien ne se saute ici : soit un "+
			"Docker joignable, soit un Redis désigné par %s", err, bddtest.EnvRedisURL)
	}

	if suiteRedisURL, err = container.ConnectionString(ctx); err != nil {
		return release, fmt.Errorf("lire l'adresse de Redis de test : %w", err)
	}

	return release, nil
}

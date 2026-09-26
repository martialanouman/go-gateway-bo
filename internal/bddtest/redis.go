package bddtest

import "os"

// EnvRedisURL désigne un Redis de test partagé : le service de la CI, ou celui de
// `docker compose` sur un poste. Sans elle, chaque paquet monte son conteneur, dans son `_test.go`,
// pour la même raison que PostgreSQL (voir `SharedAdminDSN`).
//
// Le nom est distinct de `DASHBOARD_REDIS_URL`, que le binaire lit. Le Pub/Sub de Redis ignore le
// numéro de base : l'isolation entre suites passe par l'espace de noms, jamais par la base.
const EnvRedisURL = "DASHBOARD_TEST_REDIS_URL"

// SharedRedisURL rend le Redis que l'environnement désigne, s'il y en a un.
func SharedRedisURL() (string, bool) {
	//nolint:forbidigo // La désignation du Redis de test, comme `SharedAdminDSN`, et non une
	// configuration du produit.
	url := os.Getenv(EnvRedisURL)

	return url, url != ""
}

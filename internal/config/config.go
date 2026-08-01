// Package config charge la configuration du tableau de bord depuis l'environnement et la valide une
// fois pour toutes, au démarrage.
//
// Aucun autre package ne lit l'environnement : une variable lue ailleurs se découvrirait manquante à
// la première requête qui l'emprunte, c'est-à-dire en production, sur un serveur qu'on croyait en
// bon état.
package config

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// Noms des variables d'environnement. Chaque step ajoute les siennes ici, en même temps que le code
// qui les lit et que la ligne correspondante de `.env.example`.
const (
	EnvAddr            = "DASHBOARD_ADDR"
	EnvShutdownTimeout = "DASHBOARD_SHUTDOWN_TIMEOUT"
)

// defaultShutdownTimeout laisse aux requêtes en vol de quoi se terminer pendant un déploiement
// roulant. Un délai a une valeur par défaut, un secret n'en a jamais.
const defaultShutdownTimeout = 15 * time.Second

// Config est la configuration validée. Elle se construit une fois, dans main, et descend par
// injection.
type Config struct {
	// Addr est l'adresse d'écoute du BFF, au format `host:port` accepté par net.Listen.
	Addr string
	// ShutdownTimeout est le délai laissé aux requêtes en vol après un signal d'arrêt.
	ShutdownTimeout time.Duration
}

// Lookup a la signature de os.LookupEnv. La passer en paramètre est ce qui rend le chargeur testable
// sans toucher à l'environnement du process de test.
type Lookup func(name string) (value string, found bool)

// Load lit et valide toute la configuration. L'erreur retournée rassemble **tous** les problèmes
// rencontrés et nomme chaque variable fautive.
func Load(lookup Lookup) (Config, error) {
	r := reader{lookup: lookup}

	cfg := Config{
		Addr:            r.listenAddr(EnvAddr),
		ShutdownTimeout: r.positiveDuration(EnvShutdownTimeout, defaultShutdownTimeout),
	}

	if err := errors.Join(r.problems...); err != nil {
		return Config{}, fmt.Errorf("configuration invalide :\n%w", err)
	}

	return cfg, nil
}

// Variables énumère les variables que lit Load. La liste est produite par Load elle-même : une
// variable ajoutée au chargeur y apparaît sans qu'il faille tenir une seconde liste — laquelle
// finirait par diverger, et c'est de cette liste que dépend le test de `.env.example`.
func Variables() []string {
	var (
		names []string
		seen  = map[string]bool{}
	)

	_, _ = Load(func(name string) (string, bool) {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}

		return "", false
	})

	return names
}

type reader struct {
	lookup   Lookup
	problems []error
}

func (r *reader) reject(name string, format string, args ...any) {
	r.problems = append(r.problems, fmt.Errorf("%s : %s", name, fmt.Sprintf(format, args...)))
}

// required rend la valeur et un drapeau plutôt qu'une erreur : une variable absente a déjà été
// signalée, et la valider en plus produirait deux lignes pour un seul problème.
func (r *reader) required(name string) (string, bool) {
	value, found := r.lookup(name)
	if value = strings.TrimSpace(value); !found || value == "" {
		r.reject(name, "variable obligatoire absente")

		return "", false
	}

	return value, true
}

func (r *reader) listenAddr(name string) string {
	value, ok := r.required(name)
	if !ok {
		return ""
	}

	host, port, err := net.SplitHostPort(value)
	if err != nil {
		r.reject(name, "adresse d'écoute attendue au format host:port, reçu %q", value)

		return ""
	}

	// Un nom de service (`:http`) est accepté par net.Listen mais dépend de /etc/services, donc du
	// conteneur : le refuser ici évite un démarrage qui échoue seulement en production.
	number, err := strconv.Atoi(port)
	if err != nil {
		r.reject(name, "port numérique attendu, reçu %q", port)

		return ""
	}

	if number < 0 || number > 65535 {
		r.reject(name, "port hors bornes : %d", number)

		return ""
	}

	return net.JoinHostPort(host, port)
}

func (r *reader) positiveDuration(name string, fallback time.Duration) time.Duration {
	raw, found := r.lookup(name)
	if raw = strings.TrimSpace(raw); !found || raw == "" {
		return fallback
	}

	value, err := time.ParseDuration(raw)
	if err != nil {
		r.reject(name, "durée attendue (par exemple 15s), reçu %q", raw)

		return fallback
	}

	if value <= 0 {
		r.reject(name, "durée strictement positive attendue, reçu %q", raw)

		return fallback
	}

	return value
}

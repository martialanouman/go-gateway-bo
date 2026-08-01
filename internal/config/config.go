// Package config lit et valide la configuration du tableau de bord.
package config

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"
)

// Noms des variables d'environnement lues par Load.
const (
	EnvAddr            = "DASHBOARD_ADDR"
	EnvShutdownTimeout = "DASHBOARD_SHUTDOWN_TIMEOUT"
)

const defaultShutdownTimeout = 15 * time.Second

// Variable décrit une entrée de configuration.
type Variable struct {
	Name     string
	Required bool
	Example  string
}

// Variables fait foi : `.env.example` et les tests s'y comparent plutôt que de
// relire le corps de Load. Chercher des noms dans le texte source ne garde rien
// — un renommage passerait, et le test resterait vert.
var Variables = []Variable{
	{Name: EnvAddr, Required: true, Example: ":3000"},
	{Name: EnvShutdownTimeout, Required: false, Example: "15s"},
}

// Config est validée une fois, au démarrage, puis passée par injection.
type Config struct {
	Addr            string
	ShutdownTimeout time.Duration
}

// Load lit la configuration et rend **tous** les problèmes d'un coup : qui
// répare une installation neuve veut la liste, pas la première erreur puis un
// nouveau démarrage.
//
// getenv est un paramètre pour que les tests n'aient pas à muter l'environnement
// du process — et parce qu'aucun autre package ne doit lire l'environnement.
func Load(getenv func(string) string) (*Config, error) {
	var problems []error

	addr := getenv(EnvAddr)
	if addr == "" {
		problems = append(problems, fmt.Errorf("%s est obligatoire et n'a pas de valeur par défaut", EnvAddr))
	} else if err := validateAddr(addr); err != nil {
		problems = append(problems, fmt.Errorf("%s : %w", EnvAddr, err))
	}

	shutdownTimeout := defaultShutdownTimeout
	if raw := getenv(EnvShutdownTimeout); raw != "" {
		parsed, err := time.ParseDuration(raw)
		switch {
		case err != nil:
			problems = append(problems, fmt.Errorf("%s : %q n'est pas une durée valide", EnvShutdownTimeout, raw))
		case parsed <= 0:
			problems = append(problems, fmt.Errorf("%s : %s doit être strictement positif", EnvShutdownTimeout, parsed))
		default:
			shutdownTimeout = parsed
		}
	}

	if len(problems) > 0 {
		return nil, errors.Join(problems...)
	}

	return &Config{Addr: addr, ShutdownTimeout: shutdownTimeout}, nil
}

func validateAddr(addr string) error {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("%q n'est pas une adresse de la forme hôte:port", addr)
	}

	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return fmt.Errorf("le port %q est hors des bornes 1–65535", port)
	}

	return nil
}

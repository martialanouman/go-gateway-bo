package config_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

func lookupFrom(vars map[string]string) config.Lookup {
	return func(name string) (string, bool) {
		value, ok := vars[name]

		return value, ok
	}
}

// minimalEnv est le plus petit environnement que Load accepte : le mode `mock` n'exige de la
// passerelle que son adresse. Les cas qui portent sur une autre variable partent de là et surchargent
// ce qu'ils exercent, pour qu'ajouter une obligation demain ne demande pas de retoucher vingt cas.
func minimalEnv() map[string]string {
	return map[string]string{
		config.EnvAddr:           ":3001",
		config.EnvGatewayMode:    string(config.GatewayModeMock),
		config.EnvGatewayBaseURL: "http://127.0.0.1:4010",
		config.EnvDatabaseURL:    localDatabaseURL,
		config.EnvBruteForceSalt: testBruteForceSalt,
		config.EnvSessionSecret:  testSessionSecret,
	}
}

// testBruteForceSalt et testSessionSecret ont la longueur qu'exige Load, et rien d'un secret
// d'installation : ces tests ne signent rien, ils vérifient que la variable est exigée et bornée.
const (
	testBruteForceSalt = "un-sel-de-test-assez-long-pour-passer-la-borne"
	testSessionSecret  = "une-cle-de-test-assez-longue-pour-passer-la-borne"
)

// localDatabaseURL est le DSN du `docker-compose.yml` de développement : ni un secret d'installation,
// ni une base que ces tests joignent — rien ici n'ouvre de connexion.
const localDatabaseURL = "postgres://dashboard:dashboard@127.0.0.1:5432/dashboard"

// realGatewayEnv est un environnement complet en mode `real` : tout ce qu'exige une passerelle
// jointe pour de vrai, sans aucune valeur qui ressemble à un secret d'installation.
func realGatewayEnv() map[string]string {
	return map[string]string{
		config.EnvAddr:                ":3001",
		config.EnvGatewayMode:         string(config.GatewayModeReal),
		config.EnvGatewayBaseURL:      "https://admin.gateway.internal/v1",
		config.EnvGatewayTokenURL:     "https://auth.gateway.internal/oauth2/token",
		config.EnvGatewayClientID:     "dashboard",
		config.EnvGatewayClientSecret: "un-secret-de-test",
		config.EnvGatewayClientCert:   "/etc/dashboard/tls/client.crt",
		config.EnvGatewayClientKey:    "/etc/dashboard/tls/client.key",
		config.EnvGatewayCACert:       "/etc/dashboard/tls/ca.crt",
		config.EnvGatewayTimeout:      "5s",
		config.EnvShutdownTimeout:     "30s",
		config.EnvDatabaseURL:         localDatabaseURL,
		config.EnvBruteForceSalt:      testBruteForceSalt,
		config.EnvSessionSecret:       testSessionSecret,
	}
}

func envWith(base map[string]string, overrides map[string]string) map[string]string {
	for name, value := range overrides {
		base[name] = value
	}

	return base
}

func TestLoad(t *testing.T) {
	t.Parallel()

	t.Run("charge une configuration complète", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvAddr:            "127.0.0.1:3001",
			config.EnvShutdownTimeout: "30s",
		})))

		require.NoError(t, err)
		assert.Equal(t, "127.0.0.1:3001", cfg.Addr)
		assert.Equal(t, 30*time.Second, cfg.ShutdownTimeout)
	})

	t.Run("applique le délai de grâce par défaut quand il est absent", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(minimalEnv()))

		require.NoError(t, err)
		assert.Equal(t, 15*time.Second, cfg.ShutdownTimeout)
	})

	t.Run("normalise le port plutôt que de le reprendre verbatim", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvAddr: "127.0.0.1:0080",
		})))

		require.NoError(t, err)
		assert.Equal(t, "127.0.0.1:80", cfg.Addr)
	})

	t.Run("ignore les espaces autour d'une valeur", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvAddr:            " :3001 ",
			config.EnvShutdownTimeout: " 30s ",
			config.EnvGatewayMode:     " mock ",
			config.EnvGatewayBaseURL:  " http://127.0.0.1:4010 ",
		})))

		require.NoError(t, err)
		assert.Equal(t, ":3001", cfg.Addr)
		assert.Equal(t, 30*time.Second, cfg.ShutdownTimeout)
		assert.Equal(t, config.GatewayModeMock, cfg.Gateway.Mode)
		assert.Equal(t, "http://127.0.0.1:4010", cfg.Gateway.BaseURL)
	})

	t.Run("traite une variable facultative blanche comme absente", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvShutdownTimeout: "   ",
		})))

		require.NoError(t, err)
		assert.Equal(t, 15*time.Second, cfg.ShutdownTimeout)
	})

	t.Run("nomme chaque variable obligatoire absente", func(t *testing.T) {
		t.Parallel()

		_, err := config.Load(lookupFrom(map[string]string{}))

		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvAddr+" : variable obligatoire absente")
	})

	// Le motif est assez précis pour distinguer « absente » de « malformée » : sans lui, une valeur
	// blanche traverserait et échouerait plus loin sur la validation d'adresse, avec un message qui
	// nomme la même variable — le test resterait vert pour la mauvaise raison.
	t.Run("refuse une variable obligatoire blanche", func(t *testing.T) {
		t.Parallel()

		_, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvAddr: "   ",
		})))

		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvAddr+" : variable obligatoire absente")
	})
}

func TestLoadGateway(t *testing.T) {
	t.Parallel()

	t.Run("charge une passerelle réelle", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(realGatewayEnv()))

		require.NoError(t, err)
		assert.Equal(t, config.GatewayModeReal, cfg.Gateway.Mode)
		assert.Equal(t, "https://admin.gateway.internal/v1", cfg.Gateway.BaseURL)
		assert.Equal(t, "https://auth.gateway.internal/oauth2/token", cfg.Gateway.TokenURL)
		assert.Equal(t, "dashboard", cfg.Gateway.ClientID)
		assert.Equal(t, "un-secret-de-test", cfg.Gateway.ClientSecret)
		assert.Equal(t, "/etc/dashboard/tls/client.crt", cfg.Gateway.ClientCert)
		assert.Equal(t, "/etc/dashboard/tls/client.key", cfg.Gateway.ClientKey)
		assert.Equal(t, "/etc/dashboard/tls/ca.crt", cfg.Gateway.CACert)
		assert.Equal(t, 5*time.Second, cfg.Gateway.Timeout)
	})

	// La vraie API porte le préfixe `/v1` (servers[0].url du contrat) là où le mock Prism sert sans
	// préfixe : l'URL de base est rendue telle qu'elle est écrite, et rien ici ne la réécrit. Le
	// schéma en capitales est la seule entrée qui distingue ce rendu de `parsed.String()` : net/url
	// minuscule le schéma ($GOROOT/src/net/url/url.go:454, mesuré en go1.26.5), et laisse tout le
	// reste identique sur une URL bien formée.
	t.Run("rend l'URL de base verbatim plutôt que la forme reconstruite", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvGatewayBaseURL: "HTTP://127.0.0.1:4010/v1",
		})))

		require.NoError(t, err)
		assert.Equal(t, "HTTP://127.0.0.1:4010/v1", cfg.Gateway.BaseURL)
	})

	// Le pendant du refus de `http://` en mode `real` : la garde compare le schéma comme le fait
	// net/url, sans casse. Plus stricte, elle refuserait une URL que le reste du programme joint
	// parfaitement — et une garde qui refuse du légitime finit par être retirée.
	t.Run("accepte une URL de base en https quelle qu'en soit la casse", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(envWith(realGatewayEnv(), map[string]string{
			config.EnvGatewayBaseURL: "HTTPS://admin.gateway.internal/v1",
		})))

		require.NoError(t, err)
		assert.Equal(t, "HTTPS://admin.gateway.internal/v1", cfg.Gateway.BaseURL)
	})

	// La polarité de DN-9 : une production qui oublie la variable tombe du côté strict. Le défaut
	// inverse rendrait une passerelle jointe en mock invisible dans l'environnement.
	t.Run("un mode absent vaut real", func(t *testing.T) {
		t.Parallel()

		env := realGatewayEnv()
		delete(env, config.EnvGatewayMode)

		cfg, err := config.Load(lookupFrom(env))

		require.NoError(t, err)
		assert.Equal(t, config.GatewayModeReal, cfg.Gateway.Mode)
	})

	t.Run("applique le délai d'appel par défaut quand il est absent", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(minimalEnv()))

		require.NoError(t, err)
		assert.Equal(t, 10*time.Second, cfg.Gateway.Timeout)
	})

	t.Run("n'exige que l'adresse du mock en mode mock", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(minimalEnv()))

		require.NoError(t, err)
		assert.Equal(t, config.GatewayModeMock, cfg.Gateway.Mode)
		assert.Equal(t, "http://127.0.0.1:4010", cfg.Gateway.BaseURL)
	})

	// L'adresse du mock reste obligatoire : sans elle, le BFF n'a personne à joindre dans aucun mode.
	t.Run("exige l'URL de base même en mode mock", func(t *testing.T) {
		t.Parallel()

		env := minimalEnv()
		delete(env, config.EnvGatewayBaseURL)

		_, err := config.Load(lookupFrom(env))

		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvGatewayBaseURL+" : variable obligatoire absente")
	})

	// Découvrir un identifiant manquant par redémarrage successif coûte un cycle par variable, sur
	// une mise en service où l'exploitant les a justement toutes sous la main.
	t.Run("nomme chaque variable que le mode real exige et qui manque", func(t *testing.T) {
		t.Parallel()

		_, err := config.Load(lookupFrom(map[string]string{
			config.EnvAddr:           ":3001",
			config.EnvGatewayMode:    string(config.GatewayModeReal),
			config.EnvGatewayBaseURL: "https://admin.gateway.internal/v1",
		}))

		require.Error(t, err)
		for _, name := range []string{
			config.EnvGatewayTokenURL,
			config.EnvGatewayClientID,
			config.EnvGatewayClientSecret,
			config.EnvGatewayClientCert,
			config.EnvGatewayClientKey,
			config.EnvGatewayCACert,
		} {
			assert.Contains(t, err.Error(), name)
		}
	})

	t.Run("refuse un mode inconnu en nommant les valeurs admises", func(t *testing.T) {
		t.Parallel()

		_, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvGatewayMode: "prod",
		})))

		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvGatewayMode)
		assert.Contains(t, err.Error(), string(config.GatewayModeReal))
		assert.Contains(t, err.Error(), string(config.GatewayModeMock))
	})

	// Un secret nommé dans un message d'erreur finit dans le journal de l'orchestrateur, que bien plus
	// de monde peut lire que le fichier d'environnement.
	t.Run("ne recopie jamais le secret client dans le message", func(t *testing.T) {
		t.Parallel()

		const secret = "s3cr3t-qui-ne-doit-pas-fuiter"

		_, err := config.Load(lookupFrom(envWith(realGatewayEnv(), map[string]string{
			config.EnvGatewayClientSecret: secret,
			config.EnvGatewayTokenURL:     "pas-une-url",
		})))

		require.Error(t, err)
		assert.NotContains(t, err.Error(), secret)
	})
}

func TestLoadDatabase(t *testing.T) {
	t.Parallel()

	t.Run("charge le DSN verbatim", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(minimalEnv()))

		require.NoError(t, err)
		assert.Equal(t, localDatabaseURL, cfg.DatabaseURL)
	})

	// Le DSN est exigé alors qu'aucune route ne lit encore la base (DN-5) : une installation à qui
	// personne n'a donné de base doit s'arrêter au démarrage, pas au premier écran qui la demande.
	t.Run("exige le DSN de la base", func(t *testing.T) {
		t.Parallel()

		env := minimalEnv()
		delete(env, config.EnvDatabaseURL)

		_, err := config.Load(lookupFrom(env))

		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvDatabaseURL+" : variable obligatoire absente")
	})

	// Un DSN PostgreSQL s'écrit aussi en `clé=valeur` (`host=… user=…`), forme que la validation d'URL
	// du reste du fichier refuserait — et une garde qui refuse du légitime finit par être retirée.
	t.Run("accepte la forme clé=valeur", func(t *testing.T) {
		t.Parallel()

		const keywordValue = "host=127.0.0.1 port=5432 user=dashboard dbname=dashboard sslmode=disable"

		cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvDatabaseURL: keywordValue,
		})))

		require.NoError(t, err)
		assert.Equal(t, keywordValue, cfg.DatabaseURL)
	})

	// Le mot de passe de la base vit dans le DSN. Mesuré sur pgx v5.10.0 : la rédaction de la
	// bibliothèque (`pgconn/errors.go:230`, deux expressions rationnelles sur `password=`) ne couvre
	// pas `password = '…'` avec espaces — son propre message d'erreur rend alors le mot de passe en
	// clair. C'est pourquoi le nôtre ne cite ni la valeur, ni le message de la bibliothèque.
	t.Run("ne recopie jamais le mot de passe de la base dans le message", func(t *testing.T) {
		t.Parallel()

		const password = "s3cr3t-de-la-base"

		_, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
			config.EnvDatabaseURL: "password = '" + password + "' host",
		})))

		require.Error(t, err)
		assert.NotContains(t, err.Error(), password)
	})
}

func TestLoadRejectsMalformedValues(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		base      map[string]string
		overrides map[string]string
		mention   string
	}{
		"une adresse sans port": {
			overrides: map[string]string{config.EnvAddr: "127.0.0.1"},
			mention:   config.EnvAddr,
		},
		"un port hors bornes": {
			overrides: map[string]string{config.EnvAddr: ":65536"},
			mention:   config.EnvAddr,
		},
		"un port négatif": {
			overrides: map[string]string{config.EnvAddr: ":-1"},
			mention:   config.EnvAddr,
		},
		"un port qui n'est pas un nombre": {
			overrides: map[string]string{config.EnvAddr: "127.0.0.1:http"},
			mention:   config.EnvAddr,
		},
		"un délai négatif": {
			overrides: map[string]string{config.EnvShutdownTimeout: "-1s"},
			mention:   config.EnvShutdownTimeout,
		},
		"un délai nul": {
			overrides: map[string]string{config.EnvShutdownTimeout: "0s"},
			mention:   config.EnvShutdownTimeout,
		},
		"un délai illisible": {
			overrides: map[string]string{config.EnvShutdownTimeout: "quinze secondes"},
			mention:   config.EnvShutdownTimeout,
		},
		"un délai d'appel illisible": {
			overrides: map[string]string{config.EnvGatewayTimeout: "cinq secondes"},
			mention:   config.EnvGatewayTimeout,
		},
		// `host:port` est ce qu'on tape par réflexe après DASHBOARD_ADDR, et une URL sans schéma
		// traverserait pour échouer au premier appel sortant.
		"une URL de base sans schéma": {
			overrides: map[string]string{config.EnvGatewayBaseURL: "127.0.0.1:4010"},
			mention:   config.EnvGatewayBaseURL,
		},
		"une URL de base relative": {
			overrides: map[string]string{config.EnvGatewayBaseURL: "/v1"},
			mention:   config.EnvGatewayBaseURL,
		},
		"une URL de base sans hôte": {
			overrides: map[string]string{config.EnvGatewayBaseURL: "https:///v1"},
			mention:   config.EnvGatewayBaseURL,
		},
		"une URL de base dans un autre protocole": {
			overrides: map[string]string{config.EnvGatewayBaseURL: "ftp://admin.gateway.internal/v1"},
			mention:   config.EnvGatewayBaseURL,
		},
		// http.Transport ne consulte pas son tls.Config quand le schéma est `http` : le mTLS
		// disparaîtrait sans un mot, et le jeton machine partirait en clair sur chaque appel à l'API
		// Admin — le même jeton que la ligne ci-dessous protège à son obtention.
		"une URL de base en clair en mode real": {
			base:      realGatewayEnv(),
			overrides: map[string]string{config.EnvGatewayBaseURL: "http://admin.gateway.internal/v1"},
			mention:   config.EnvGatewayBaseURL,
		},
		"une URL de jeton sans schéma": {
			base:      realGatewayEnv(),
			overrides: map[string]string{config.EnvGatewayTokenURL: "auth.gateway.internal/token"},
			mention:   config.EnvGatewayTokenURL,
		},
		// Le jeton machine traverse le réseau : l'obtenir en clair le donne à qui écoute.
		"une URL de jeton en clair": {
			base:      realGatewayEnv(),
			overrides: map[string]string{config.EnvGatewayTokenURL: "http://auth.gateway.internal/token"},
			mention:   config.EnvGatewayTokenURL,
		},
		// Ni une URL `postgres://`, ni une forme `clé=valeur` : c'est l'adresse de la passerelle
		// recopiée d'une ligne à l'autre du `.env`, et rien ne la refuserait avant la première requête.
		"un DSN qui n'est pas un DSN": {
			overrides: map[string]string{config.EnvDatabaseURL: "http://127.0.0.1:4010"},
			mention:   config.EnvDatabaseURL,
		},
		"un DSN dont l'hôte est illisible": {
			overrides: map[string]string{
				config.EnvDatabaseURL: "postgres://dashboard@127.0.0.1:5432:9/dashboard",
			},
			mention: config.EnvDatabaseURL,
		},
		// Les réglages de pool voyagent dans le DSN, et seul le parseur du pool les lit : validé par
		// celui de la connexion seule, ce DSN passerait ici pour échouer à la création du pool.
		"un DSN dont un réglage de pool est illisible": {
			overrides: map[string]string{
				config.EnvDatabaseURL: localDatabaseURL + "?pool_max_conns=beaucoup",
			},
			mention: config.EnvDatabaseURL,
		},
	}

	for name, tc := range cases {
		t.Run("refuse "+name, func(t *testing.T) {
			t.Parallel()

			base := tc.base
			if base == nil {
				base = minimalEnv()
			}

			_, err := config.Load(lookupFrom(envWith(base, tc.overrides)))

			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.mention)
		})
	}
}

func TestLoadReportsEveryProblemAtOnce(t *testing.T) {
	t.Parallel()

	// Corriger une variable pour découvrir la suivante au redémarrage suivant fait perdre un cycle
	// par variable — sur une installation neuve, c'est la moitié de la mise en service.
	_, err := config.Load(lookupFrom(map[string]string{config.EnvShutdownTimeout: "-1s"}))

	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvAddr)
	assert.Contains(t, err.Error(), config.EnvShutdownTimeout)
	assert.Contains(t, err.Error(), config.EnvGatewayBaseURL)
}

// Les trois dernières ne sont pas lues par le serveur mais par `cmd/bootstrap` : depuis step-021,
// `Variables` sonde les **deux** chargeurs, parce que `.env.example` documente les deux programmes.
func TestVariablesListsEveryNameLoadReads(t *testing.T) {
	t.Parallel()

	assert.ElementsMatch(t, []string{
		config.EnvAddr,
		config.EnvShutdownTimeout,
		config.EnvGatewayMode,
		config.EnvGatewayBaseURL,
		config.EnvGatewayTokenURL,
		config.EnvGatewayClientID,
		config.EnvGatewayClientSecret,
		config.EnvGatewayClientCert,
		config.EnvGatewayClientKey,
		config.EnvGatewayCACert,
		config.EnvGatewayTimeout,
		config.EnvDatabaseURL,
		config.EnvBruteForceSalt,
		config.EnvSessionSecret,
		config.EnvTrustedProxies,
		config.EnvBootstrapOperatorEmail,
		config.EnvBootstrapOperatorName,
		config.EnvBootstrapOperatorPassword,
	}, config.Variables())
}

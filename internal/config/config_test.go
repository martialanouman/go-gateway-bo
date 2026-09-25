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
		config.EnvAddr:              ":3001",
		config.EnvProductName:       testProductName,
		config.EnvGatewayMode:       string(config.GatewayModeMock),
		config.EnvGatewayBaseURL:    "http://127.0.0.1:4010",
		config.EnvDatabaseURL:       localDatabaseURL,
		config.EnvBruteForceSalt:    testBruteForceSalt,
		config.EnvSessionSecret:     testSessionSecret,
		config.EnvTOTPEncryptionKey: testTOTPEncryptionKey,
		config.EnvWebauthnRPID:      testWebauthnRPID,
		config.EnvWebauthnOrigin:    testWebauthnOrigin,
		config.EnvTrustedProxies:    config.NoTrustedProxy,
		config.EnvSMTPAddr:          testSMTPAddr,
		config.EnvSMTPFrom:          testSMTPFrom,
		config.EnvPublicURL:         testPublicURL,
	}
}

// Rien d'un secret d'installation : le worker les compose dans chaque lien, le navigateur et
// Mailpit les voient tous les deux.
const (
	testSMTPAddr  = "127.0.0.1:1025"
	testSMTPFrom  = "cockpit@exemple.test"
	testPublicURL = "https://dashboard.exemple.test"
)

// Les trois ont la longueur qu'exige Load, et rien d'un secret d'installation : ces tests ne signent
// ni ne chiffrent rien, ils vérifient que la variable est exigée et bornée.
const (
	testBruteForceSalt    = "un-sel-de-test-assez-long-pour-passer-la-borne"
	testSessionSecret     = "une-cle-de-test-assez-longue-pour-passer-la-borne"
	testTOTPEncryptionKey = "une-cle-de-chiffrement-de-test-assez-longue"
)

// testProductName diffère du nom de production : un nom recodé en dur passerait sinon les tests.
const testProductName = "Cockpit de test"

// Les deux valeurs WebAuthn ne sont pas des secrets — le navigateur les voit — et rien ici n'ouvre de
// cérémonie : `Load` n'exige que leur présence, et c'est `webauthn.New` qui juge le domaine.
const (
	testWebauthnRPID   = "localhost"
	testWebauthnOrigin = "http://localhost:3001"
)

// localDatabaseURL est le DSN du `docker-compose.yml` de développement : ni un secret d'installation,
// ni une base que ces tests joignent — rien ici n'ouvre de connexion.
const localDatabaseURL = "postgres://dashboard:dashboard@127.0.0.1:5432/dashboard"

// realGatewayEnv est un environnement complet en mode `real` : tout ce qu'exige une passerelle
// jointe pour de vrai, sans aucune valeur qui ressemble à un secret d'installation.
func realGatewayEnv() map[string]string {
	return map[string]string{
		config.EnvAddr:                ":3001",
		config.EnvProductName:         testProductName,
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
		config.EnvTOTPEncryptionKey:   testTOTPEncryptionKey,
		config.EnvWebauthnRPID:        testWebauthnRPID,
		config.EnvWebauthnOrigin:      testWebauthnOrigin,
		config.EnvTrustedProxies:      config.NoTrustedProxy,
		config.EnvSMTPAddr:            testSMTPAddr,
		config.EnvSMTPFrom:            testSMTPFrom,
		config.EnvPublicURL:           testPublicURL,
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

func TestLoadMail(t *testing.T) {
	t.Parallel()

	t.Run("charge l'adresse SMTP, l'expéditeur et l'URL publique", func(t *testing.T) {
		t.Parallel()

		cfg, err := config.Load(lookupFrom(minimalEnv()))

		require.NoError(t, err)
		assert.Equal(t, testSMTPAddr, cfg.Mail.Addr)
		assert.Equal(t, testSMTPFrom, cfg.Mail.From)
		assert.Equal(t, testPublicURL, cfg.Mail.PublicURL)
	})

	for _, name := range []string{config.EnvSMTPAddr, config.EnvSMTPFrom, config.EnvPublicURL} {
		t.Run("exige "+name, func(t *testing.T) {
			t.Parallel()

			env := minimalEnv()
			delete(env, name)

			_, err := config.Load(lookupFrom(env))

			require.Error(t, err)
			assert.Contains(t, err.Error(), name+" : variable obligatoire absente")
		})
	}
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
		"une adresse SMTP sans port": {
			overrides: map[string]string{config.EnvSMTPAddr: "127.0.0.1"},
			mention:   config.EnvSMTPAddr,
		},
		// Un hôte vide dirait « toutes les interfaces » à un serveur d'écoute, jamais à une adresse
		// qu'on compose : il n'y a rien à joindre à l'autre bout.
		"une adresse SMTP sans hôte": {
			overrides: map[string]string{config.EnvSMTPAddr: ":1025"},
			mention:   config.EnvSMTPAddr,
		},
		"une adresse SMTP dont le port n'est pas un nombre": {
			overrides: map[string]string{config.EnvSMTPAddr: "127.0.0.1:smtp"},
			mention:   config.EnvSMTPAddr,
		},
		"une URL publique sans schéma": {
			overrides: map[string]string{config.EnvPublicURL: "dashboard.exemple.test"},
			mention:   config.EnvPublicURL,
		},
		// Le worker compose le lien en concaténant directement "/access#" + jeton : une barre finale y
		// ferait un double « / ».
		"une URL publique avec une barre oblique finale": {
			overrides: map[string]string{config.EnvPublicURL: testPublicURL + "/"},
			mention:   config.EnvPublicURL,
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

// Les trois dernières ne sont pas lues par le serveur mais par `cmd/bootstrap` : `Variables` sonde
// les **deux** chargeurs, parce que `.env.example` documente les deux programmes.
func TestVariablesListsEveryNameLoadReads(t *testing.T) {
	t.Parallel()

	assert.ElementsMatch(t, []string{
		config.EnvAddr,
		config.EnvShutdownTimeout,
		config.EnvProductName,
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
		config.EnvTOTPEncryptionKey,
		config.EnvTrustedProxies,
		config.EnvWebauthnRPID,
		config.EnvWebauthnOrigin,
		config.EnvSMTPAddr,
		config.EnvSMTPFrom,
		config.EnvPublicURL,
		config.EnvBootstrapOperatorEmail,
		config.EnvBootstrapOperatorName,
		config.EnvBootstrapOperatorPassword,
	}, config.Variables())
}

// Cette origine est celle des cérémonies WebAuthn **et** celle dont le BFF exige que vienne toute
// mutation. En clair sur un vrai domaine, les deux se lisent et se rejouent sur le fil ; sur le poste
// de développement, il n'y a pas de réseau à écouter.
func TestUneOrigineEnClairNEstAcceptéeQueSurLePosteLocal(t *testing.T) {
	t.Parallel()

	for origin, accepted := range map[string]bool{
		"http://localhost:3000":          true,
		"http://127.0.0.1:3000":          true,
		"http://[::1]:3000":              true,
		"https://dashboard.exemple.test": true,
		"http://dashboard.exemple.test":  false,
		"http://192.168.1.10:3000":       false,
	} {
		t.Run(origin, func(t *testing.T) {
			t.Parallel()

			_, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
				config.EnvWebauthnOrigin: origin,
			})))

			if accepted {
				require.NoError(t, err)

				return
			}

			require.Error(t, err)
			assert.Contains(t, err.Error(), config.EnvWebauthnOrigin)
			assert.Contains(t, err.Error(), "https attendu")
		})
	}
}

// Ce qui empêche `mock` d'atteindre la production, et la seule chose qui le puisse sans variable
// supplémentaire : un mock est un processus lancé à côté, jamais un mode d'exploitation.
func TestLeModeMockExigeUnePasserelleSurLePosteLocal(t *testing.T) {
	t.Parallel()

	_, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
		config.EnvGatewayBaseURL: "https://admin.gateway.internal/v1",
	})))

	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvGatewayMode)
	assert.Contains(t, err.Error(), "adresse de bouclage")
}

// Le refus doit nommer la variable pour être actionnable, et ne peut pas citer sa valeur pour l'être
// sans danger. Le découpage est textuel parce qu'une URL qu'on refuse est précisément celle que
// `net/url` peut refuser d'abord — un repli sur la valeur intacte rendrait le mot de passe.
func TestUneURLCitéeDansUnRefusPerdSesIdentifiants(t *testing.T) {
	t.Parallel()

	for raw, expected := range map[string]string{
		"postgres://dashboard:tres-secret@base.exemple.test/db": "postgres://…@base.exemple.test/db",
		"https://client:secret@api.exemple.test/v1?a=b@c":       "https://…@api.exemple.test/v1?a=b@c",
		"https://api.exemple.test/v1":                           "https://api.exemple.test/v1",
		"https://api.exemple.test/chemin@bizarre":               "https://api.exemple.test/chemin@bizarre",
		// La forme **opaque**, sans les deux barres qui annoncent l'autorité : `net/url` la lit
		// (`Scheme="dashboard"`, `Host=""`), `absoluteURL` la refuse pour son hôte vide, et le refus
		// citait alors la valeur entière. C'est le schéma oublié au copier-coller.
		"dashboard:tres-secret@passerelle.exemple.test/v1": "dashboard:…@passerelle.exemple.test/v1",
		"u:p@h:443": "u:…@h:443",
		// Ce qui n'est pas une URL et ne porte aucun identifiant traverse inchangé : `127.0.0.1:4010`
		// se coupe sur son `:` sans qu'aucun `@` ne suive.
		"127.0.0.1:4010": "127.0.0.1:4010",
		// Un port démesuré, que `url.Parse` **accepte** — `validOptionalPort` n'exige que des
		// chiffres. Il est ici pour la forme, pas comme témoin du découpage
		// textuel : ce témoin-là est la forme opaque ci-dessous, que `absoluteURL` refuse pour son
		// hôte vide et que le refus citait alors en entier.
		"http://u:p@hôte.test:99999999999/x": "http://…@hôte.test:99999999999/x",
		"pas-une-url":                        "pas-une-url",
	} {
		t.Run(raw, func(t *testing.T) {
			t.Parallel()

			assert.Equal(t, expected, config.RedactURL(raw))
		})
	}
}

// Le refus nomme la variable **et** dit comment l'écrire sur un poste sans proxy : un refus qui
// nommerait seulement la variable ferait chercher une valeur qui n'existe pas.
func TestUnReseauDeConfianceNonDeclaréEstRefuséEnNommantSaSortie(t *testing.T) {
	t.Parallel()

	env := minimalEnv()
	delete(env, config.EnvTrustedProxies)

	_, err := config.Load(lookupFrom(env))

	require.Error(t, err)
	assert.Contains(t, err.Error(), config.EnvTrustedProxies)
	assert.Contains(t, err.Error(), config.NoTrustedProxy)
}

func TestAucunProxyDeConfianceSeDeclareEtNeFaitCroireAAucun(t *testing.T) {
	t.Parallel()

	cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
		config.EnvTrustedProxies: config.NoTrustedProxy,
	})))

	require.NoError(t, err)
	assert.Empty(t, cfg.Auth.TrustedProxies)
}

// Une liste qui ne porte que des séparateurs rendait `nil` sans un mot — c'est-à-dire exactement le
// silence que l'obligation venait de fermer, atteignable depuis n'importe quel gabarit qui joint sur
// des virgules.
func TestUneListeDeProxysSansAucunReseauEstRefusee(t *testing.T) {
	t.Parallel()

	for _, value := range []string{",", ",,", " , "} {
		t.Run(value, func(t *testing.T) {
			t.Parallel()

			_, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
				config.EnvTrustedProxies: value,
			})))

			require.Error(t, err)
			assert.Contains(t, err.Error(), config.EnvTrustedProxies)
			assert.Contains(t, err.Error(), config.NoTrustedProxy)
		})
	}
}

// Une origine n'a **que** un schéma et un hôte. Un chemin y passait la configuration et ne cassait
// qu'à moitié : les navigateurs modernes annoncent `Sec-Fetch-Site` et passaient, ceux qui ne
// l'annoncent pas se faisaient refuser par une comparaison d'origine que le chemin faisait échouer.
func TestUneOrigineNaNiCheminNiIdentifiants(t *testing.T) {
	t.Parallel()

	for _, origin := range []string{
		"https://dashboard.exemple.test/app",
		"https://dashboard.exemple.test?a=b",
		"https://dashboard.exemple.test#ancre",
		"https://operateur:secret@dashboard.exemple.test",
	} {
		t.Run(origin, func(t *testing.T) {
			t.Parallel()

			_, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
				config.EnvWebauthnOrigin: origin,
			})))

			require.Error(t, err)
			assert.Contains(t, err.Error(), config.EnvWebauthnOrigin)
		})
	}
}

// La barre oblique finale et la casse de l'hôte sont **normalisées**, pas refusées : les deux
// désignent la même origine, et un refus ferait chercher une faute là où il n'y en a pas. La
// normalisation vit ici, à l'entrée de la valeur, et non dans la garde qui la consomme.
func TestUneOrigineEstRendueSousSaFormeCanonique(t *testing.T) {
	t.Parallel()

	for raw, canonical := range map[string]string{
		"https://Dashboard.Exemple.TEST/": "https://dashboard.exemple.test",
		"https://dashboard.exemple.test":  "https://dashboard.exemple.test",
		"http://LOCALHOST:3000":           "http://localhost:3000",
	} {
		t.Run(raw, func(t *testing.T) {
			t.Parallel()

			cfg, err := config.Load(lookupFrom(envWith(minimalEnv(), map[string]string{
				config.EnvWebauthnOrigin: raw,
			})))

			require.NoError(t, err)
			assert.Equal(t, canonical, cfg.Auth.WebauthnOrigin)
		})
	}
}

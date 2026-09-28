package gateway

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

// mockAccessToken n'est pas un secret et doit se lire comme tel. Prism applique le `security` global
// du contrat et répond 401 sans en-tête `Authorization`, mais accepte n'importe quel `Bearer`, et il
// n'y a pas de `tokenUrl` en face — le mode `mock` n'en appelle aucun. C'est l'inverse d'un
// identifiant en dur : une valeur qui n'ouvre rien, et qui se lit comme telle.
//
//nolint:gosec // G101 : voir juste au-dessus.
const mockAccessToken = "jeton-factice-du-mock-prism"

// NewAdminClient rend le client engendré déjà gréé : mTLS, jeton machine mis en cache, timeout et
// rejeu timide. Il n'y a pas de couche par-dessus — le client engendré *est* l'interface, et
// réenvelopper ses 134 méthodes n'ajouterait qu'un endroit où elles peuvent diverger du contrat.
//
// Le client rendu vaut pour toute la vie du process : c'est lui qui porte le jeton en cache, et en
// reconstruire un par requête relancerait une obtention de jeton à chaque appel.
func NewAdminClient(cfg config.GatewayConfig) (*ClientWithResponses, error) {
	httpClient, err := authenticatedClient(cfg)
	if err != nil {
		return nil, err
	}

	client, err := NewClientWithResponses(cfg.BaseURL, WithHTTPClient(httpClient))
	if err != nil {
		return nil, fmt.Errorf("client de l'API Admin : %w", err)
	}

	return client, nil
}

// NewStreamClient rend le client qui ouvre les flux temps réel, avec les gardes, le mTLS et le jeton de
// NewAdminClient. `ForceAttemptHTTP2` ne le gêne pas : net/http passe en HTTP/1.1 toute demande de
// montée en WebSocket (`Request.requiresHTTP1`, Go 1.26).
func NewStreamClient(cfg config.GatewayConfig) (*http.Client, error) {
	return authenticatedClient(cfg)
}

func authenticatedClient(cfg config.GatewayConfig) (*http.Client, error) {
	if err := knownMode(cfg.Mode); err != nil {
		return nil, err
	}

	if err := encryptedEndpoints(cfg); err != nil {
		return nil, err
	}

	transport, err := outboundTransport(cfg)
	if err != nil {
		return nil, err
	}

	// Un seul transport mTLS pour l'API et le tokenUrl : deux clients configurés séparément
	// laisseraient le jeton s'obtenir hors mTLS, une authentification sortante à moitié protégée que
	// rien ne signalerait. Le Timeout borne l'appel à l'API comme l'obtention du jeton.
	outbound := &http.Client{Transport: transport, Timeout: cfg.Timeout}

	if cfg.Mode == config.GatewayModeMock {
		return &http.Client{
			Transport: &oauth2.Transport{Source: mockToken(), Base: transport},
			Timeout:   cfg.Timeout,
		}, nil
	}

	credentials := machineCredentials(cfg)
	fetch := func(ctx context.Context) (*oauth2.Token, error) {
		return credentials.Token(context.WithValue(ctx, oauth2.HTTPClient, outbound))
	}

	return &http.Client{Transport: newTokenTransport(transport, fetch), Timeout: cfg.Timeout}, nil
}

// knownMode refuse tout mode que ce package ne connaît pas, **la valeur zéro comprise**. La polarité
// stricte de config.Load — l'absence repliée sur `real`, tout autre littéral refusé — s'arrête à
// l'environnement : NewAdminClient prend une struct nue, que les tests construisent déjà à la main
// et qu'un helper de route construira partiellement. Sans ce refus, une `GatewayConfig` sans `Mode`
// prendrait le chemin `mock` : aucun mTLS, et le jeton factice en en-tête vers une passerelle de
// production.
//
// Les deux branches qui suivent testent alors `== mock` et non `!= real`. La porte les rend
// équivalentes, donc aucun test ne peut les distinguer ; la forme positive est là pour qu'un
// troisième mode ajouté un jour tombe du côté strict, y compris de la main de quelqu'un qui aurait
// oublié cette porte.
func knownMode(mode config.GatewayMode) error {
	switch mode {
	case config.GatewayModeReal, config.GatewayModeMock:
		return nil
	default:
		return fmt.Errorf("mode de passerelle %q inconnu, %s ou %s attendu",
			mode, config.GatewayModeReal, config.GatewayModeMock)
	}
}

// encryptedEndpoints refuse une passerelle réelle jointe en clair, des **deux** côtés. C'est la même
// frontière que knownMode : `config.Load` pose déjà ce refus sur DASHBOARD_GATEWAY_BASE_URL, et sa
// polarité s'arrête à l'environnement — NewAdminClient reçoit une struct nue, que les tests
// construisent à la main et qu'un helper de route construira partiellement.
//
// Un `http://` qui traverse ne casse rien de visible : http.Transport ne consulte pas son tls.Config
// quand l'URL est en clair, si bien que le matériel mTLS est chargé, posé et jamais présenté.
// Mesuré avec un matériel valide et les deux bouts en clair : l'API reçoit `Bearer …` et zéro
// certificat pair, le tokenUrl reçoit le secret client en `Basic` — et les cinq scopes,
// `gdpr:erase` compris, partent avec.
//
// La comparaison ignore la casse, comme net/url qui minuscule le schéma à l'analyse :
// `HTTPS://` désigne une passerelle parfaitement joignable, et
// une garde qui refuse du légitime finit par être retirée.
func encryptedEndpoints(cfg config.GatewayConfig) error {
	if cfg.Mode != config.GatewayModeReal {
		return nil
	}

	for _, endpoint := range []struct{ name, rawURL string }{
		{name: "URL de base", rawURL: cfg.BaseURL},
		{name: "tokenUrl", rawURL: cfg.TokenURL},
	} {
		if scheme, _, _ := strings.Cut(endpoint.rawURL, ":"); !strings.EqualFold(scheme, "https") {
			return fmt.Errorf("%s de la passerelle : https attendu en mode %s, reçu %q",
				endpoint.name, config.GatewayModeReal, config.RedactURL(endpoint.rawURL))
		}
	}

	return nil
}

func mockToken() oauth2.TokenSource {
	return oauth2.StaticTokenSource(&oauth2.Token{AccessToken: mockAccessToken, TokenType: "Bearer"})
}

// machineCredentials décrit le jeton machine. `defaultExpiryDelta` d'oauth2 v0.36.0 (token.go:22) le
// fait tenir pour expiré dix secondes avant l'échéance annoncée ; tokenTransport le renouvelle alors.
func machineCredentials(cfg config.GatewayConfig) clientcredentials.Config {
	return clientcredentials.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		TokenURL:     cfg.TokenURL,
		// Ces scopes sont **cinq des sept** que le contrat catalogue, codés ici et non configurables.
		// Le jeton machine porte donc `content:read` en permanence : ce qu'un opérateur a le droit de
		// voir est **entièrement** à la charge du BFF, et le rendre réglable ici laisserait croire
		// qu'on peut restreindre par là ce qui doit l'être par `requirePermission` (`internal/bff`) —
		// c'est l'origine de l'invariant (c).
		//
		// **Ce qui manque est un choix, et aucune porte ne le voit** — oapi-codegen n'engendre rien du
		// `security`, donc le symptôme sera un **403 à l'exécution** sur du code qui compile :
		//
		//   - `msisdn:reveal` est catalogué et absent de cette liste. Voir les numéros d'abonnés en
		//     clair là où le contrat les masque par défaut est une frontière qu'il a posée ; la
		//     déplacer pour du code qui n'existe pas ne se justifie pas.
		//   - `audit:read` (catalogué depuis 6.8.0) n'ouvre que `list-audit-log`, le journal des opérateurs
		//     de la passerelle, qu'aucun écran ne lit.
		//   - `cdr:export_bulk` est exigé par `security:` sur `create-message-export` et
		//     `get-message-export` mais **n'est catalogué nulle part** — le bloc `scopes` du
		//     `securitySchemes` ne le contient pas, en 6.9.0 encore. C'est un manque du contrat amont,
		//     à corriger par une PR dans `go-gateway/api/` plutôt qu'en le devinant ici.
		//
		// Aucune de ces opérations n'est appelée par ce dépôt : les ajouter élargirait le jeton
		// machine pour personne. C'est à la step qui livrera l'export de décider, sachant ce qu'elle
		// sert — step-104, prévenue dans `tasks/todo.md`.
		Scopes: []string{"admin:read", "admin:write", "content:read", "content:erase", "gdpr:erase"},
	}
}

// maxConnsPerHost borne la pression d'une instance sur l'API Admin (invariant e). La passerelle ne
// parle que HTTP/1.1 (`go-gateway`, cmd/admin-api-svc/wiring.go:450) : une connexion porte une requête,
// donc la borne est celle des requêtes en vol. Mesure dans tasks/steps/done/step-059.md.
const maxConnsPerHost = 64

func outboundTransport(cfg config.GatewayConfig) (http.RoundTripper, error) {
	clientTLS, err := mutualTLS(cfg)
	if err != nil {
		return nil, err
	}

	return replayReadsOnce{base: &http.Transport{
		TLSClientConfig:     clientTLS,
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: 5 * time.Second,
		IdleConnTimeout:     90 * time.Second,
		// Le BFF ne parle qu'à un seul hôte, et le défaut de net/http (2) y ferait rouvrir une
		// connexion sur trois requêtes concurrentes — poignée de main TLS comprise.
		MaxIdleConnsPerHost: 32,
		MaxConnsPerHost:     maxConnsPerHost,
		Proxy:               http.ProxyFromEnvironment,
	}}, nil
}

// mutualTLS rend nil en mode `mock` : le mock n'authentifie personne, et lui exiger un certificat
// empêcherait le développement local de démarrer.
func mutualTLS(cfg config.GatewayConfig) (*tls.Config, error) {
	if cfg.Mode == config.GatewayModeMock {
		// Pas de configuration TLS est ici une réponse, pas un manque : nil laisse net/http servir
		// http:// comme https:// selon l'URL, ce dont le mock local a besoin.
		return nil, nil
	}

	certificate, err := tls.LoadX509KeyPair(cfg.ClientCert, cfg.ClientKey)
	if err != nil {
		return nil, fmt.Errorf("paire certificat/clé client de la passerelle : %w", err)
	}

	encoded, err := os.ReadFile(cfg.CACert)
	if err != nil {
		return nil, fmt.Errorf("autorité de certification de la passerelle : %w", err)
	}

	authorities := x509.NewCertPool()
	if !authorities.AppendCertsFromPEM(encoded) {
		return nil, fmt.Errorf(
			"autorité de certification de la passerelle : %s ne contient aucun certificat PEM",
			cfg.CACert)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{certificate},
		RootCAs:      authorities,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

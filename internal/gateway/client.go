package gateway

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/token"
)

// NewAdminClient rend le client engendré déjà gréé : mTLS, jeton signé par appelant, timeout et
// rejeu timide. Il n'y a pas de couche par-dessus — le client engendré *est* l'interface, et
// réenvelopper ses 134 méthodes n'ajouterait qu'un endroit où elles peuvent diverger du contrat.
//
// Le client rendu vaut pour toute la vie du process : le jeton se signe par requête, au nom de
// l'appelant que le contexte porte (WithOperator, WithSystem).
func NewAdminClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*ClientWithResponses, error) {
	httpClient, err := authenticatedClient(cfg, issuer, logger)
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
func NewStreamClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*http.Client, error) {
	return authenticatedClient(cfg, issuer, logger)
}

func authenticatedClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*http.Client, error) {
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

	return &http.Client{
		Transport: signedTransport{base: transport, issuer: issuer, logger: logger},
		Timeout:   cfg.Timeout,
		// L'API Admin ne redirige jamais ; signedTransport rejouerait le jeton de l'opérateur vers
		// n'importe quelle Location, y compris en clair.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}, nil
}

// knownMode refuse tout mode que ce package ne connaît pas, **la valeur zéro comprise**. La polarité
// stricte de config.Load — l'absence repliée sur `real`, tout autre littéral refusé — s'arrête à
// l'environnement : NewAdminClient prend une struct nue, que les tests construisent déjà à la main
// et qu'un helper de route construira partiellement. Sans ce refus, une `GatewayConfig` sans `Mode`
// prendrait le chemin `mock` : aucun mTLS vers une passerelle de production.
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

// encryptedEndpoints refuse une passerelle réelle jointe en clair. C'est la même frontière que
// knownMode : `config.Load` pose déjà ce refus sur DASHBOARD_GATEWAY_BASE_URL, et sa polarité
// s'arrête à l'environnement — NewAdminClient reçoit une struct nue, que les tests construisent à la
// main.
//
// Un `http://` qui traverse ne casse rien de visible : http.Transport ne consulte pas son tls.Config
// quand l'URL est en clair, si bien que le matériel mTLS est chargé, posé et jamais présenté, et que
// le jeton signé part en clair.
//
// La comparaison ignore la casse, comme net/url qui minuscule le schéma à l'analyse :
// `HTTPS://` désigne une passerelle parfaitement joignable, et
// une garde qui refuse du légitime finit par être retirée.
func encryptedEndpoints(cfg config.GatewayConfig) error {
	if cfg.Mode != config.GatewayModeReal {
		return nil
	}

	if scheme, _, _ := strings.Cut(cfg.BaseURL, ":"); !strings.EqualFold(scheme, "https") {
		return fmt.Errorf("URL de base de la passerelle : https attendu en mode %s, reçu %q",
			config.GatewayModeReal, config.RedactURL(cfg.BaseURL))
	}

	return nil
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

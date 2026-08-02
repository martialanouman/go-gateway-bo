package gateway

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"os"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"

	"github.com/martialanouman/go-gateway-bo/internal/config"
)

// mockAccessToken n'est pas un secret et doit se lire comme tel. Mesuré sur Prism le 01/08/2026 : il
// applique le `security` global du contrat et répond 401 sans en-tête `Authorization`, mais accepte
// n'importe quel `Bearer`. Il n'y a pas de `tokenUrl` en face — le mode `mock` n'en appelle aucun.
// C'est l'inverse d'un identifiant en dur : une valeur qui n'ouvre rien, et qui se lit comme telle.
//
//nolint:gosec // G101 : voir juste au-dessus.
const mockAccessToken = "jeton-factice-du-mock-prism"

// NewAdminClient rend le client engendré déjà gréé : mTLS, jeton machine mis en cache, timeout et
// rejeu timide. Il n'y a pas de couche par-dessus — le client engendré *est* l'interface, et
// réenvelopper ses 133 méthodes n'ajouterait qu'un endroit où elles peuvent diverger du contrat.
//
// Le client rendu vaut pour toute la vie du process : c'est lui qui porte le jeton en cache, et en
// reconstruire un par requête relancerait une obtention de jeton à chaque appel.
func NewAdminClient(cfg config.GatewayConfig) (*ClientWithResponses, error) {
	transport, err := outboundTransport(cfg)
	if err != nil {
		return nil, err
	}

	// Le contexte porte le client sortant : `clientcredentials` obtient le jeton par lui, et
	// oauth2.NewClient en reprend le transport pour joindre l'API. Un seul client mTLS couvre donc
	// les deux appels — lu dans oauth2@v0.36.0/oauth2.go:353-367 et internal/transport.go:21-28.
	// Deux clients configurés séparément laisseraient le jeton s'obtenir hors mTLS, c'est-à-dire une
	// authentification sortante à moitié protégée que rien ne signalerait.
	//
	// Le Timeout est posé ici et nulle part ailleurs, et c'est ce qui le fait borner **aussi**
	// l'obtention du jeton : oauth2.NewClient recopie le Timeout du client du contexte dans celui
	// qu'il rend (oauth2.go:365).
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{
		Transport: transport,
		Timeout:   cfg.Timeout,
	})

	client, err := NewClientWithResponses(
		cfg.BaseURL,
		WithHTTPClient(oauth2.NewClient(ctx, machineToken(ctx, cfg))),
	)
	if err != nil {
		return nil, fmt.Errorf("client de l'API Admin : %w", err)
	}

	return client, nil
}

// machineToken rend la source du jeton machine.
//
// En mode `real`, c'est `clientcredentials` qui la porte, et c'est lui qui tient les deux exigences
// de la step — source lue dans oauth2@v0.36.0 : `Config.TokenSource` rend
// `oauth2.ReuseTokenSource(nil, source)` (clientcredentials.go:79-85), dont le `Token()` prend un
// `sync.Mutex` sur tout le corps, appel réseau compris (oauth2.go:308-321) ; deux appels concurrents
// trouvant le jeton expiré ne déclenchent donc qu'une seule requête. Et `defaultExpiryDelta =
// 10 * time.Second` (token.go:22) fait renouveler dix secondes avant l'expiration annoncée.
func machineToken(ctx context.Context, cfg config.GatewayConfig) oauth2.TokenSource {
	if cfg.Mode != config.GatewayModeReal {
		return oauth2.StaticTokenSource(&oauth2.Token{
			AccessToken: mockAccessToken,
			TokenType:   "Bearer",
		})
	}

	credentials := clientcredentials.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		TokenURL:     cfg.TokenURL,
		// Les scopes sont ceux que déclare le contrat, codés ici et non configurables. Le jeton
		// machine porte donc `content:read` en permanence : ce qu'un opérateur a le droit de voir est
		// **entièrement** à la charge du BFF, et le rendre réglable ici laisserait croire qu'on peut
		// restreindre par là ce qui doit l'être par `RequirePermission()` — c'est l'origine de
		// l'invariant (c).
		Scopes: []string{"admin:read", "admin:write", "content:read", "content:erase", "gdpr:erase"},
	}

	return credentials.TokenSource(ctx)
}

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
	}}, nil
}

// mutualTLS rend nil hors du mode `real` : le mock n'authentifie personne, et lui exiger un
// certificat empêcherait le développement local de démarrer.
func mutualTLS(cfg config.GatewayConfig) (*tls.Config, error) {
	if cfg.Mode != config.GatewayModeReal {
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

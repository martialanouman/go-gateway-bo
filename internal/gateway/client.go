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

	// Le contexte porte le client sortant : `clientcredentials` obtient le jeton par lui, et
	// oauth2.NewClient en reprend le transport pour joindre l'API. Un seul client mTLS couvre donc
	// les deux appels — lu dans oauth2@v0.36.0/oauth2.go:353-367 et internal/transport.go:21-28.
	// Deux clients configurés séparément laisseraient le jeton s'obtenir hors mTLS, c'est-à-dire une
	// authentification sortante à moitié protégée que rien ne signalerait.
	//
	// Le Timeout est posé ici et nulle part ailleurs, et c'est ce qui le fait borner **aussi**
	// l'obtention du jeton : oauth2.NewClient recopie le Timeout du client du contexte dans celui
	// qu'il rend (oauth2.go:365).
	//
	// Ce qu'il ne fait pas — et les deux se lisent ensemble sans se contredire : l'attente est
	// bornée, elle n'est pas **annulable**. Le contexte de l'appelant n'atteint pas l'obtention du
	// jeton, parce que `oauth2.Transport.RoundTrip` appelle `Source.Token()` sans lui en passer aucun
	// (transport.go:45) et que la source porte celui construit ici, sur context.Background
	// (clientcredentials.go:79-84). Comme `reuseTokenSource.Token()` garde son mutex pendant l'appel
	// réseau (oauth2.go:308-320), un tokenUrl parti en trou noir sérialise les appels concurrents,
	// chacun pour la durée du Timeout, et un appelant qui a renoncé n'en libère aucun. Rien n'est
	// fait de ce constat tant qu'aucune route n'appelle la passerelle : la première arrive en
	// step-060, et c'est elle qui dira si ce plafond se voit.
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
// Mesuré le 02/08/2026 avec un matériel valide et les deux bouts en clair : l'API reçoit
// `Bearer …` et zéro certificat pair, le tokenUrl reçoit le secret client en `Basic` — et les cinq
// scopes, `gdpr:erase` compris, partent avec.
//
// La comparaison ignore la casse, comme net/url qui minuscule le schéma à l'analyse
// ($GOROOT/src/net/url/url.go:454) : `HTTPS://` désigne une passerelle parfaitement joignable, et
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
				endpoint.name, config.GatewayModeReal, endpoint.rawURL)
		}
	}

	return nil
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
	if cfg.Mode == config.GatewayModeMock {
		return oauth2.StaticTokenSource(&oauth2.Token{
			AccessToken: mockAccessToken,
			TokenType:   "Bearer",
		})
	}

	credentials := clientcredentials.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		TokenURL:     cfg.TokenURL,
		// Ces scopes sont **cinq des six** que le contrat catalogue, codés ici et non configurables.
		// Le jeton machine porte donc `content:read` en permanence : ce qu'un opérateur a le droit de
		// voir est **entièrement** à la charge du BFF, et le rendre réglable ici laisserait croire
		// qu'on peut restreindre par là ce qui doit l'être par `requirePermission` (`internal/bff`) —
		// c'est l'origine de l'invariant (c).
		//
		// **Ce qui manque est un choix, et aucune porte ne le voit** — oapi-codegen n'engendre rien du
		// `security`, donc le symptôme sera un **403 à l'exécution** sur du code qui compile. Mesuré
		// sur le contrat 4.0.2 le 08/08/2026 :
		//
		//   - `msisdn:reveal` est catalogué (depuis la 3.0.0) et absent de cette liste. Voir les
		//     numéros d'abonnés en clair là où le contrat les masque par défaut est une frontière
		//     qu'il a posée ; la déplacer pour du code qui n'existe pas ne se justifie pas.
		//   - `cdr:export_bulk` est exigé par `security:` sur `create-message-export` et
		//     `get-message-export` (4.0.0) mais **n'est catalogué nulle part** — le bloc `scopes` du
		//     `securitySchemes` n'en compte que six et ne le contient pas. C'est un manque du contrat
		//     amont, à corriger par une PR dans `go-gateway/api/` plutôt qu'en le devinant ici.
		//
		// Aucune des deux opérations n'est appelée par ce dépôt : les ajouter élargirait le jeton
		// machine pour personne. C'est à la step qui livrera l'export de décider, sachant ce qu'elle
		// sert — step-104, prévenue dans `tasks/todo.md`. step-009, 08/08/2026.
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

		// `MaxConnsPerHost` n'est pas posé, et c'est le seul cadran qui bornerait les connexions
		// **ouvertes** : celui du dessus ne borne que les inactives. C'est par lui que passerait la
		// pression du tableau de bord sur la passerelle, donc l'invariant (e). Il se règle sur une
		// concurrence réelle, et aucune route n'appelle encore la passerelle.
		//
		// `Proxy` n'est pas posé non plus, là où http.DefaultTransport pose `ProxyFromEnvironment`
		// ($GOROOT/src/net/http/transport.go:47) : ce transport-ci ignore donc HTTPS_PROXY et
		// NO_PROXY, en silence et à rebours du défaut de net/http. À trancher quand un déploiement
		// dira s'il passe par un proxy d'egress.
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

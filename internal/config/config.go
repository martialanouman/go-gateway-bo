// Package config charge la configuration du tableau de bord depuis l'environnement et la valide une
// fois pour toutes, au lancement.
//
// « Au lancement » et non « au démarrage du serveur » : il y a deux programmes et deux chargeurs
// depuis step-021 — `Load` pour le serveur, `LoadBootstrap` pour la commande d'installation.
//
// Aucun autre package ne lit l'environnement : une variable lue ailleurs se découvrirait manquante à
// la première requête qui l'emprunte, c'est-à-dire en production, sur un serveur qu'on croyait en
// bon état.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Noms des variables d'environnement. Chaque step ajoute les siennes ici, en même temps que le code
// qui les lit et que la ligne correspondante de `.env.example`.
const (
	EnvAddr            = "DASHBOARD_ADDR"
	EnvShutdownTimeout = "DASHBOARD_SHUTDOWN_TIMEOUT"

	EnvGatewayMode         = "DASHBOARD_GATEWAY_MODE"
	EnvGatewayBaseURL      = "DASHBOARD_GATEWAY_BASE_URL"
	EnvGatewayTokenURL     = "DASHBOARD_GATEWAY_TOKEN_URL"
	EnvGatewayClientID     = "DASHBOARD_GATEWAY_CLIENT_ID"
	EnvGatewayClientSecret = "DASHBOARD_GATEWAY_CLIENT_SECRET"
	EnvGatewayClientCert   = "DASHBOARD_GATEWAY_CLIENT_CERT"
	EnvGatewayClientKey    = "DASHBOARD_GATEWAY_CLIENT_KEY"
	EnvGatewayCACert       = "DASHBOARD_GATEWAY_CA_CERT"
	EnvGatewayTimeout      = "DASHBOARD_GATEWAY_TIMEOUT"

	EnvDatabaseURL = "DASHBOARD_DATABASE_URL"

	EnvBruteForceSalt = "DASHBOARD_BRUTEFORCE_SALT"
	// G101 lit un nom de variable d'environnement comme un identifiant en dur. C'en est l'exact
	// contraire : cette constante nomme la variable dont la valeur n'est **jamais** écrite ici.
	EnvSessionSecret  = "DASHBOARD_SESSION_SECRET" //nolint:gosec
	EnvTrustedProxies = "DASHBOARD_TRUSTED_PROXIES"
)

// minimumBruteForceSaltLength borne le sel d'anti-brute-force. Trente-deux caractères : ce que rend
// `openssl rand -base64 24`, et le README propose 48 octets. Ce que la borne empêche vraiment est un
// sel posé « pour faire démarrer » — `changeme`, `dev`, le nom du projet — qui rendrait le HMAC des
// adresses sources devinable, donc la table de compteurs relisible par qui la vole.
const minimumBruteForceSaltLength = 32

// minimumSessionSecretLength borne la clé qui signe les cookies de session. Même seuil et même
// raison que ci-dessus, mais la conséquence d'une clé faible n'est pas la même : elle ne rend pas une
// table relisible, elle laisse **signer une session**. Qui devine cette clé se connecte sous
// n'importe quelle identité sans jamais présenter de mot de passe.
const minimumSessionSecretLength = 32

// defaultShutdownTimeout laisse aux requêtes en vol de quoi se terminer pendant un déploiement
// roulant. Un délai a une valeur par défaut, un secret n'en a jamais.
const defaultShutdownTimeout = 15 * time.Second

// defaultGatewayTimeout borne un appel sortant vers l'API Admin. Le tableau de bord est un
// observateur : une passerelle qui traîne doit devenir un état d'erreur à l'écran, pas une requête
// suspendue qui retient une connexion et l'opérateur avec elle.
const defaultGatewayTimeout = 10 * time.Second

// GatewayMode dit à qui le BFF parle : la vraie API Admin, ou le mock qui la simule.
type GatewayMode string

const (
	GatewayModeReal GatewayMode = "real"
	GatewayModeMock GatewayMode = "mock"
)

// Config est la configuration validée. Elle se construit une fois, dans main, et descend par
// injection.
type Config struct {
	// Addr est l'adresse d'écoute du BFF, au format `host:port` accepté par net.Listen.
	Addr string
	// ShutdownTimeout est le délai laissé aux requêtes en vol après un signal d'arrêt.
	ShutdownTimeout time.Duration
	// Gateway est la connexion sortante vers l'API Admin de la passerelle.
	Gateway GatewayConfig
	// DatabaseURL est le DSN du schéma propre au BFF. Il porte un mot de passe : il ne sort ni dans un
	// message d'erreur, ni dans un journal.
	DatabaseURL string
	// Auth porte ce dont le premier facteur a besoin au démarrage.
	Auth AuthConfig
}

// AuthConfig décrit ce que l'authentification lit dans l'environnement.
type AuthConfig struct {
	// BruteForceSalt est la clé du HMAC qui masque les adresses sources dans la table de compteurs.
	// C'est un secret : il ne sort ni dans un message d'erreur, ni dans un journal.
	BruteForceSalt []byte
	// SessionSecret est la clé du HMAC qui scelle le cookie de session. Elle n'a **aucun repli** : une
	// clé par défaut serait publique, donc n'importe qui signerait une session.
	//
	// Toutes les instances portent la même, sans quoi le cookie émis par l'une serait refusé par
	// l'autre. La changer déconnecte tout le monde — c'est l'inverse du sel ci-dessus, dont la
	// rotation n'invalide aucun compte.
	SessionSecret []byte
	// TrustedProxies énumère les réseaux dont on croit l'en-tête `X-Forwarded-For`.
	//
	// **Vide est une valeur sûre et non un défaut manquant** : sans liste, l'en-tête est ignoré et le
	// compteur porte sur l'adresse de pair. C'est exact en développement, où rien ne s'interpose. En
	// production, ne pas la renseigner ferait compter toutes les tentatives sur l'adresse du load
	// balancer — le verrou se refermerait alors sur tout le monde d'un coup, ce qui se remarque, au
	// lieu de laisser passer, ce qui ne se remarque pas.
	TrustedProxies []netip.Prefix
}

// GatewayConfig décrit la connexion sortante vers l'API Admin. Hors du mode `real`, seule BaseURL
// porte une valeur exigée : le mock n'authentifie personne.
type GatewayConfig struct {
	Mode GatewayMode
	// BaseURL porte le préfixe de chemin de l'API : la vraie sert sous `/v1`, le mock sans préfixe.
	// C'est une différence de déploiement, jamais une constante du code.
	BaseURL  string
	TokenURL string
	ClientID string
	// ClientSecret est un secret : il ne sort ni dans un message d'erreur, ni dans un journal.
	ClientSecret string
	ClientCert   string
	ClientKey    string
	CACert       string
	// Timeout borne un appel sortant, obtention du jeton comprise.
	Timeout time.Duration
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
		Gateway: GatewayConfig{
			Mode:         r.gatewayMode(EnvGatewayMode),
			BaseURL:      r.requiredAbsoluteURL(EnvGatewayBaseURL, "http", "https"),
			TokenURL:     r.optionalAbsoluteURL(EnvGatewayTokenURL, "https"),
			ClientID:     r.optional(EnvGatewayClientID),
			ClientSecret: r.optional(EnvGatewayClientSecret),
			ClientCert:   r.optional(EnvGatewayClientCert),
			ClientKey:    r.optional(EnvGatewayClientKey),
			CACert:       r.optional(EnvGatewayCACert),
			Timeout:      r.positiveDuration(EnvGatewayTimeout, defaultGatewayTimeout),
		},
		DatabaseURL: r.requiredDatabaseURL(EnvDatabaseURL),
		Auth: AuthConfig{
			BruteForceSalt: r.requiredSecret(EnvBruteForceSalt, minimumBruteForceSaltLength),
			SessionSecret:  r.requiredSecret(EnvSessionSecret, minimumSessionSecretLength),
			TrustedProxies: r.prefixList(EnvTrustedProxies),
		},
	}

	r.requireRealGatewayMaterial(cfg.Gateway.Mode)
	r.requireEncryptedGatewayBaseURL(cfg.Gateway.Mode, cfg.Gateway.BaseURL)

	if err := errors.Join(r.problems...); err != nil {
		return Config{}, fmt.Errorf("configuration invalide :\n%w", err)
	}

	return cfg, nil
}

// Variables énumère les variables que lit **le dépôt**, en sondant les chargeurs avec un
// environnement vide plutôt qu'en tenant une seconde liste — laquelle finirait par diverger d'eux, et
// c'est d'elle que dépend le test de `.env.example`.
//
// « Le dépôt » et non « Load » depuis step-021 : il y a désormais **deux** chargeurs, parce qu'il y a
// deux programmes. `Load` est la configuration du serveur ; `LoadBootstrap` celle de la commande
// d'installation, dont les trois variables ne servent qu'une fois et qu'un serveur n'a aucune raison
// d'exiger. Les sonder tous les deux ici est ce qui garde la porte de `.env.example` **exacte** : la
// version qui n'en sondait qu'un aurait reproché au fichier trois variables qu'il documente à raison.
// L'alternative — une seconde fonction que le test concatène — déplaçait la porte dans le test, où
// une step future oublierait d'ajouter la sienne.
//
// La contrainte que cela impose au chargeur : **toute lecture est inconditionnelle**, faite dans le
// littéral Config ci-dessus. Une variable lue seulement quand une autre est renseignée resterait
// invisible ici, et `.env.example` pourrait alors l'omettre sans que rien ne rougisse. Les secrets
// que le §1.8 annonce (DSN, Redis, mTLS, OAuth2) s'ajoutent donc à cette forme, pas à côté d'elle.
func Variables() []string {
	var (
		names []string
		seen  = map[string]bool{}
	)

	// Le dédoublonnage porte désormais quelque chose : les six variables qu'exige le mode `real` sont
	// lues deux fois — une fois dans le littéral, une fois par requireRealGatewayMaterial qui constate
	// leur absence sur l'environnement. Sans lui, `.env.example` se verrait reprocher une divergence
	// qui n'existe pas. Vérifié en le retirant : `TestDotenvExampleListsExactlyWhatLoadReads` tombe,
	// en réclamant neuf noms de passerelle déjà documentés.
	probe := func(name string) (string, bool) {
		if !seen[name] {
			seen[name] = true
			names = append(names, name)
		}

		return "", false
	}

	_, _ = Load(probe)
	_, _ = LoadBootstrap(probe)

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

// requireRealGatewayMaterial exige les identifiants OAuth2 et le matériel mTLS d'une passerelle
// jointe pour de vrai. Le manque se constate sur l'environnement et non sur la valeur chargée : une
// valeur présente mais refusée plus haut est déjà signalée, et la redire « absente » ferait deux
// lignes pour un seul problème.
func (r *reader) requireRealGatewayMaterial(mode GatewayMode) {
	if mode != GatewayModeReal {
		return
	}

	for _, name := range []string{
		EnvGatewayTokenURL,
		EnvGatewayClientID,
		EnvGatewayClientSecret,
		EnvGatewayClientCert,
		EnvGatewayClientKey,
		EnvGatewayCACert,
	} {
		if r.optional(name) == "" {
			r.reject(name, "variable obligatoire absente en mode %s", GatewayModeReal)
		}
	}
}

// requireEncryptedGatewayBaseURL refuse une passerelle réelle jointe en clair. Le schéma est admis
// inconditionnellement plus haut — `http` reste la normale du mock Prism — et c'est ici, le mode
// connu, qu'il se restreint : http.Transport ne consulte pas son tls.Config quand l'URL est en
// `http`, si bien que le matériel mTLS serait chargé, posé, et jamais présenté, pendant que le jeton
// machine et ses cinq scopes partiraient en clair à chaque appel. Rien ne tomberait.
func (r *reader) requireEncryptedGatewayBaseURL(mode GatewayMode, baseURL string) {
	// Une URL absente ou déjà refusée est rendue vide : la redire ferait deux lignes pour un problème.
	if mode != GatewayModeReal || baseURL == "" {
		return
	}

	// Le schéma est ce qui précède le premier `:` — la valeur a déjà traversé absoluteURL, donc elle
	// s'analyse. La comparaison ignore la casse comme le fait net/url, qui minuscule le schéma
	// ($GOROOT/src/net/url/url.go:454) : `HTTPS://` a passé la garde ci-dessus, refuser ici serait
	// refuser une URL que le programme joint parfaitement.
	if scheme, _, _ := strings.Cut(baseURL, ":"); !strings.EqualFold(scheme, "https") {
		r.reject(EnvGatewayBaseURL, "URL absolue en https attendue en mode %s, reçu %q", GatewayModeReal, baseURL)
	}
}

// requiredDatabaseURL valide le DSN sans ouvrir de connexion : `pgxpool.ParseConfig` analyse et rend
// une configuration, il ne compose rien (DN-5). C'est le parseur du pool lui-même, et non `net/url` :
// un DSN PostgreSQL s'écrit aussi en `clé=valeur` (`host=… user=…`), que `net/url` ne reconnaît pas ;
// et `pgxpool` lit en plus les réglages `pool_*` que le DSN transporte (pgxpool/pool.go:370-…), que
// `pgx.ParseConfig` laisse passer — validé par ce dernier, un `pool_max_conns` illisible passerait ici
// pour échouer à la création du pool.
//
// Ce parseur n'est pas hermétique, et c'est voulu : il lit aussi les `PG*` du process et le fichier
// de service qu'ils désignent. Mesuré sur v5.10.0 — `PGSSLMODE=n-importe-quoi` fait refuser un DSN
// par ailleurs valide. Le pool lira le même environnement à sa création : un verdict qui l'ignorerait
// serait plus permissif que ce que le produit fera ensuite.
//
// Le message ne cite ni la valeur ni l'erreur de la bibliothèque, parce que le DSN porte le mot de
// passe de la base : mesuré sur pgx v5.10.0, la rédaction de `pgconn` (`pgconn/errors.go:230`) repose
// sur deux expressions rationnelles ancrées sur `password=` et ne couvre pas `password = '…'` — son
// message rend alors le mot de passe en clair.
func (r *reader) requiredDatabaseURL(name string) string {
	value, ok := r.required(name)
	if !ok {
		return ""
	}

	if _, err := pgxpool.ParseConfig(value); err != nil {
		r.reject(name, "DSN PostgreSQL attendu, en URL `postgres://…` ou en `clé=valeur` ; "+
			"la valeur n'est pas citée, elle porte le mot de passe de la base")

		return ""
	}

	return value
}

// requiredSecret exige une valeur d'au moins `minimum` caractères, sans jamais citer ce qu'elle a
// trouvé — ni sa longueur, qui est déjà une information sur le secret.
func (r *reader) requiredSecret(name string, minimum int) []byte {
	value, ok := r.required(name)
	if !ok {
		return nil
	}

	if len([]rune(value)) < minimum {
		r.reject(name, "secret d'au moins %d caractères attendu ; la valeur n'est pas citée. "+
			"`openssl rand -base64 48` fait le travail", minimum)

		return nil
	}

	return []byte(value)
}

// prefixList lit une liste de réseaux CIDR séparés par des virgules.
//
// Une adresse nue est **refusée** plutôt que promue en /32 : `10.0.0.1` et `10.0.0.1/32` se lisent
// pareil pour un humain, et accepter les deux ferait passer `10.0.0.0` pour un hôte là où l'auteur
// pensait à un réseau. Exiger le préfixe force à écrire ce qu'on veut dire.
func (r *reader) prefixList(name string) []netip.Prefix {
	value := r.optional(name)
	if value == "" {
		return nil
	}

	var prefixes []netip.Prefix

	for _, field := range strings.Split(value, ",") {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}

		prefix, err := netip.ParsePrefix(field)
		if err != nil {
			r.reject(name, "réseau CIDR attendu (par exemple 10.0.0.0/8), reçu %q", field)

			return nil
		}

		prefixes = append(prefixes, prefix)
	}

	return prefixes
}

func (r *reader) requiredAbsoluteURL(name string, schemes ...string) string {
	value, ok := r.required(name)
	if !ok {
		return ""
	}

	return r.absoluteURL(name, value, schemes)
}

func (r *reader) optionalAbsoluteURL(name string, schemes ...string) string {
	value := r.optional(name)
	if value == "" {
		return ""
	}

	return r.absoluteURL(name, value, schemes)
}

// absoluteURL rend la valeur verbatim plutôt que la forme reconstruite par net/url : le préfixe de
// chemin de l'API appartient à l'URL configurée — la vraie sert sous `/v1`, le mock Prism sans
// préfixe — et rien ici ne doit le réécrire.
func (r *reader) absoluteURL(name, value string, schemes []string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || !slices.Contains(schemes, parsed.Scheme) {
		r.reject(name, "URL absolue en %s attendue, reçu %q", strings.Join(schemes, " ou "), value)

		return ""
	}

	return value
}

// optional rend une valeur sans jamais se plaindre de son absence : ce qui la rend obligatoire est le
// mode, constaté après chargement. La lecture, elle, reste inconditionnelle — voir Variables.
func (r *reader) optional(name string) string {
	value, _ := r.lookup(name)

	return strings.TrimSpace(value)
}

func (r *reader) gatewayMode(name string) GatewayMode {
	switch mode := GatewayMode(r.optional(name)); mode {
	case "":
		return GatewayModeReal
	case GatewayModeReal, GatewayModeMock:
		return mode
	default:
		r.reject(name, "mode %q inconnu, %s ou %s attendu", mode, GatewayModeReal, GatewayModeMock)

		// Le mode refusé est rendu tel quel, et non replié sur `real` : replié, il ferait exiger tout
		// le matériel de production par-dessus, soit sept lignes d'erreur pour une faute de frappe.
		return mode
	}
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

	// Le port est recomposé depuis le nombre analysé, et non repris verbatim : sinon `:+80` et
	// `:00000000080` traverseraient la validation et seraient stockés tels quels.
	return net.JoinHostPort(host, strconv.Itoa(number))
}

// positiveDuration traite une valeur blanche comme une absence : une variable facultative laissée
// vide dans un `.env` dit « je n'ai pas d'avis », pas « zéro ».
func (r *reader) positiveDuration(name string, fallback time.Duration) time.Duration {
	raw, _ := r.lookup(name)
	if raw = strings.TrimSpace(raw); raw == "" {
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

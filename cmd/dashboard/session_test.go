package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/session"
)

// sessionWorld porte ce qu'un scénario de session manipule au-delà de la connexion : les rôles posés
// avant le démarrage, et le vieillissement de la ligne. Il partage la base du `loginWorld`, dont il
// réutilise l'installation — étendre le parcours existant plutôt qu'en ouvrir un second.
type sessionWorld struct {
	login *loginWorld
	// roles retient ce que le scénario a attribué, pour que l'assertion sur l'union lise la base
	// plutôt qu'une liste recopiée dans le test.
	roles []string
	// replayed est le cookie d'avant la déconnexion, que le scénario du rejeu renvoie.
	replayed string
}

// grantRoles attribue à l'opérateur du scénario des rôles **du catalogue semé**, jamais des rôles
// inventés : ce que le scénario observe est l'union de permissions réelles, et deux rôles fabriqués
// pour l'occasion ne diraient rien de ce que le produit accorde.
func (w *sessionWorld) grantRoles(ctx context.Context, first, second string) error {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	tag, err := conn.Exec(ctx, `
		INSERT INTO operator_roles (operator_id, role_id)
		SELECT o.id, r.id FROM operators o, roles r
		WHERE lower(o.email) = $1 AND r.name = ANY($2)`,
		scenarioEmail, []string{first, second})
	if err != nil {
		return fmt.Errorf("attribuer les rôles du scénario : %w", err)
	}

	if tag.RowsAffected() != 2 {
		return fmt.Errorf("%d rôle(s) attribué(s) sur 2 : %q ou %q n'est pas un rôle par défaut",
			tag.RowsAffected(), first, second)
	}

	w.roles = []string{first, second}

	return nil
}

// permissionsOfRoles lit dans la base ce que ces rôles accordent, plutôt que de recopier une liste
// dans le test. Une liste écrite ici se contenterait de dire que le catalogue est ce qu'on a recopié.
func (w *sessionWorld) permissionsOfRoles(ctx context.Context, roles ...string) ([]string, error) {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return nil, fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var keys []string

	err = conn.QueryRow(ctx, `
		SELECT array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key)
		FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
		WHERE r.name = ANY($1)`, roles).Scan(&keys)
	if err != nil {
		return nil, fmt.Errorf("lire les permissions des rôles : %w", err)
	}

	return keys, nil
}

// alterSessionSeal remplace le **premier** caractère du sceau, en laissant le jeton intact. Un cookie
// entièrement inventé serait refusé même sans vérification du sceau, faute d'empreinte connue en
// base : il ne prouverait rien.
//
// Le premier caractère et non le dernier, pour que ce scénario éprouve la **comparaison du sceau** et
// non le décodage : le dernier caractère ne porte que deux bits significatifs sur six, et c'est
// désormais `Strict()` qui refuse les autres formes (`TestUnSceauNonCanoniqueEstRefuse`). Avant lui,
// le viser laissait ce scénario vert contre un serveur correct — mesuré le 10/08/2026.
func (w *sessionWorld) alterSessionSeal() error {
	value, ok := w.login.process.cookies[session.CookieName]
	if !ok {
		return errors.New("aucun cookie de session à altérer : la connexion n'en a pas posé")
	}

	token, seal, found := strings.Cut(value, ".")
	if !found || seal == "" {
		return fmt.Errorf("le cookie de session ne porte pas de sceau : %q", value)
	}

	replacement := byte('A')
	if seal[0] == replacement {
		replacement = 'B'
	}

	w.login.process.cookies[session.CookieName] = token + "." + string(replacement) + seal[1:]

	return nil
}

// rememberCookie met de côté ce que le navigateur porte, pour le rejouer plus tard. Le harnais
// l'oublie dès que le serveur l'expire ou le remplace, exactement comme un navigateur — c'est
// pourquoi le retenir est un pas explicite du scénario.
func (w *sessionWorld) rememberCookie() error {
	value, ok := w.login.process.cookies[session.CookieName]
	if !ok {
		return errors.New("aucun cookie de session à retenir : la connexion n'en a pas posé")
	}

	w.replayed = value

	return nil
}

func (w *sessionWorld) signOut() error {
	return w.login.process.post("/api/auth/logout", "")
}

// replayTheRememberedCookie exige que le navigateur ne porte plus la valeur retenue — sinon le rejeu
// ne prouverait rien, il rejouerait le cookie courant.
func (w *sessionWorld) replayTheRememberedCookie() error {
	if w.replayed == "" {
		return errors.New("aucun cookie retenu : le scénario n'a rien à rejouer")
	}

	if w.login.process.cookies[session.CookieName] == w.replayed {
		return errors.New("le navigateur porte encore la valeur retenue : elle n'a été ni expirée " +
			"ni remplacée, et le rejeu ne prouverait rien")
	}

	w.login.process.cookies[session.CookieName] = w.replayed

	return nil
}

// sessionCookieIsCleared exige que le serveur ait **recouvert** le cookie, pas seulement qu'il ait
// cessé de l'envoyer. Un `Set-Cookie` d'expiration est ce qui fait oublier au navigateur une valeur
// qui ne vaut plus rien.
func (w *sessionWorld) sessionCookieIsCleared() error {
	cookie, err := w.login.process.sessionCookie()
	if err != nil {
		return err
	}

	if cookie.MaxAge >= 0 {
		return fmt.Errorf("le cookie est servi avec Max-Age=%d : le navigateur le garde", cookie.MaxAge)
	}

	if _, still := w.login.process.cookies[session.CookieName]; still {
		return errors.New("le navigateur a gardé le cookie malgré son expiration")
	}

	return nil
}

// idleFor et expireAbsolutely déplacent l'état de la base, jamais le produit : aucun drapeau de test,
// aucune garde désarmée par une variable d'environnement — précédent de `lockExpires`.
//
// **Les deux sont distincts**, et c'est ce que la mutation a montré côté store : reculer les trois
// horodatages ensemble ferait refuser la fenêtre glissante dans les deux cas, et le scénario de
// l'échéance absolue serait vert pour la mauvaise borne.
func (w *sessionWorld) idleFor(ctx context.Context, hours int) error {
	return w.ageSession(ctx,
		`UPDATE sessions SET last_seen_at = last_seen_at - make_interval(secs => $1)`,
		(time.Duration(hours) * time.Hour).Seconds())
}

func (w *sessionWorld) expireAbsolutely(ctx context.Context) error {
	return w.ageSession(ctx, `
		UPDATE sessions
		SET created_at = now() - interval '13 hours', expires_at = now() - interval '1 minute',
		    last_seen_at = now()`)
}

// breakSessionsTable met la base en panne pour de vrai plutôt que de simuler l'erreur : la table est
// renommée, donc la requête de résolution échoue comme elle échouerait sur une base indisponible. La
// base du scénario est jetée à la fin, comme toutes les autres.
func (w *sessionWorld) breakSessionsTable(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	if _, err = conn.Exec(ctx, `ALTER TABLE sessions RENAME TO sessions_hors_service`); err != nil {
		return fmt.Errorf("mettre la table des sessions hors service : %w", err)
	}

	return nil
}

func (w *sessionWorld) ageSession(ctx context.Context, query string, args ...any) error {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	tag, err := conn.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("faire vieillir la session : %w", err)
	}

	// Sans ce contrôle, un scénario qui n'aurait vieilli aucune session passerait en silence, et
	// « la session est fermée » ne dirait plus rien de ce qui suit.
	if tag.RowsAffected() == 0 {
		return errors.New("aucune session à faire vieillir : la connexion n'en a pas ouvert")
	}

	return nil
}

// me est ce que le corps de `GET /auth/me` porte. Il est relu ici plutôt que comparé au texte brut :
// ce que le scénario affirme est l'union et l'état du second facteur, pas la mise en forme du JSON.
type me struct {
	Operator struct {
		ID          string `json:"id"`
		Email       string `json:"email"`
		DisplayName string `json:"displayName"`
	} `json:"operator"`
	Permissions   []string `json:"permissions"`
	Elevated      bool     `json:"elevated"`
	SecondFactors struct {
		TOTP                   bool `json:"totp"`
		RecoveryCodesRemaining int  `json:"recoveryCodesRemaining"`
	} `json:"secondFactors"`
	AbsoluteExpiresAt time.Time `json:"absoluteExpiresAt"`
}

func (w *sessionWorld) decode() (me, error) {
	if w.login.process.received == nil {
		return me{}, errors.New("aucune réponse reçue")
	}

	var decoded me
	if err := json.Unmarshal([]byte(w.login.process.received.body), &decoded); err != nil {
		return me{}, fmt.Errorf("relire le corps de /auth/me : %w\n%s", err,
			w.login.process.received.body)
	}

	return decoded, nil
}

func (w *sessionWorld) namesTheOperator() error {
	decoded, err := w.decode()
	if err != nil {
		return err
	}

	if decoded.Operator.Email != scenarioEmail {
		return fmt.Errorf("la réponse nomme %q et non %q", decoded.Operator.Email, scenarioEmail)
	}

	if decoded.Operator.ID == "" || decoded.Operator.DisplayName == "" {
		return fmt.Errorf("l'opérateur est rendu sans identifiant ou sans nom d'affichage : %+v",
			decoded.Operator)
	}

	if decoded.AbsoluteExpiresAt.IsZero() {
		return errors.New("la session est rendue sans échéance : le client ne sait pas quand elle meurt")
	}

	return nil
}

// forbidsCaching lit les deux en-têtes sur la réponse **servie**, pas sur l'intention du middleware.
func (w *sessionWorld) forbidsCaching() error {
	header := w.login.process.received.header

	if cache := header.Get("Cache-Control"); cache != "no-store" {
		return fmt.Errorf("la réponse porte Cache-Control %q et non \"no-store\" : le corps peut être "+
			"écrit dans un cache", cache)
	}

	if vary := header.Get("Vary"); !strings.Contains(vary, "Cookie") {
		return fmt.Errorf("la réponse porte Vary %q, qui ne nomme pas Cookie : un cache qui négocie "+
			"servirait la réponse d'une session à une autre", vary)
	}

	return nil
}

func (w *sessionWorld) secondFactorIsNotVerified() error {
	decoded, err := w.decode()
	if err != nil {
		return err
	}

	if decoded.Elevated {
		return errors.New("la session se dit élevée alors qu'aucun second facteur n'a été vérifié : " +
			"step-025 la laisserait écrire")
	}

	return nil
}

func (w *sessionWorld) permissionsAreTheUnionOfHeldRoles(ctx context.Context) error {
	if len(w.roles) == 0 {
		return errors.New("aucun rôle n'a été attribué : ce pas n'a rien à confronter")
	}

	expected, err := w.permissionsOfRoles(ctx, w.roles...)
	if err != nil {
		return err
	}

	decoded, err := w.decode()
	if err != nil {
		return err
	}

	if len(expected) == 0 {
		return errors.New("les deux rôles n'accordent aucune permission : le scénario ne prouverait rien")
	}

	if !slices.Equal(decoded.Permissions, expected) {
		return fmt.Errorf("la réponse rend %v et non l'union %v", decoded.Permissions, expected)
	}

	return nil
}

func (w *sessionWorld) noPermissionIsRenderedTwice() error {
	decoded, err := w.decode()
	if err != nil {
		return err
	}

	seen := map[string]bool{}

	for _, key := range decoded.Permissions {
		if seen[key] {
			return fmt.Errorf("%q est rendue plus d'une fois : les rôles ne sont pas réunis mais "+
				"concaténés", key)
		}

		seen[key] = true
	}

	return nil
}

// refusalSaysNothingAboutTheSession : le refus est le même qu'il n'y ait pas de cookie, que son sceau
// ne colle pas, ou que la session soit échue. Les distinguer dirait à qui teste un cookie ce qu'il
// vaut encore.
func (w *sessionWorld) refusalSaysNothingAboutTheSession() error {
	body := w.login.process.received.body

	for _, leak := range []string{"signature", "sceau", "expir", "échu", "cookie", "jeton"} {
		if strings.Contains(strings.ToLower(body), leak) {
			return fmt.Errorf("le refus nomme %q, donc distingue les causes : %s", leak, body)
		}
	}

	return nil
}

func (w *sessionWorld) refusedAgain(path string) error {
	previous := w.login.process.received.status

	if err := w.login.process.fetch(path); err != nil {
		return err
	}

	if w.login.process.received.status != previous {
		return fmt.Errorf("le second refus rend %d et non %d : se faire refuser a changé l'état de "+
			"la session", w.login.process.received.status, previous)
	}

	return nil
}

// sessionCookie retrouve le cookie de session dans la dernière réponse reçue.
//
// Le harnais porte ses cookies à la main plutôt que par un `cookiejar` : un jar refuserait un cookie
// `Secure` servi en clair sur `127.0.0.1`, donc **tous** les scénarios de session échoueraient sur
// une cause qui n'a rien à voir avec le produit. Et le scénario du rejeu après déconnexion a besoin
// de renvoyer un cookie qu'un jar aurait justement supprimé.
func (p *process) sessionCookie() (*http.Cookie, error) {
	if p.received == nil {
		return nil, errors.New("aucune réponse reçue")
	}

	for _, cookie := range (&http.Response{Header: p.received.header}).Cookies() {
		if cookie.Name == session.CookieName {
			return cookie, nil
		}
	}

	return nil, fmt.Errorf("la réponse ne porte aucun cookie %q", session.CookieName)
}

// receivedASessionCookie vérifie les **cinq** attributs, et pas seulement la présence du cookie.
//
// C'est ce qui remplace, ici, ce que le contrat ne peut pas déclarer : un `Set-Cookie` dans le YAML
// deviendrait un en-tête que `openapi-typescript` annonce lisible au client, alors que `HttpOnly` le
// lui interdit. Ce pas exige davantage que ce que `kin-openapi` aurait exigé — la présence.
func (p *process) receivedASessionCookie() error {
	cookie, err := p.sessionCookie()
	if err != nil {
		return err
	}

	if cookie.Value == "" {
		return errors.New("le cookie de session est posé sans valeur : rien ne s'ouvre")
	}

	var missing []string

	if !cookie.HttpOnly {
		missing = append(missing, "HttpOnly (un script de la page lirait la session)")
	}

	if !cookie.Secure {
		missing = append(missing, "Secure (la session voyagerait en clair)")
	}

	if cookie.SameSite != http.SameSiteLaxMode {
		missing = append(missing, "SameSite=Lax (un site tiers ferait écrire l'opérateur)")
	}

	if cookie.Path != "/" {
		missing = append(missing, "Path=/ (le préfixe __Host- l'exige)")
	}

	if cookie.Domain != "" {
		missing = append(missing, "aucun Domain (le cookie s'ouvrirait aux sous-domaines)")
	}

	if len(missing) > 0 {
		return fmt.Errorf("le cookie de session n'a pas les attributs attendus : %v", missing)
	}

	return nil
}

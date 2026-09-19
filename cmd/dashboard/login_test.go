package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Les identifiants du scénario. Le mot de passe n'a rien d'un secret — il est haché par le même
// `auth.Hash` que la production, sur une base jetée à la fin du scénario.
const (
	scenarioEmail    = "camille.durand@exemple.test"
	scenarioPassword = "un mot de passe d'opérateur"
	unknownEmail     = "personne@exemple.test"
)

// loginWorld porte la base du scénario et les refus qu'il compare entre eux.
//
// **Une base par scénario, et non le DSN partagé de la suite** : les compteurs d'échecs fuiraient
// d'un scénario à l'autre, et « cinq échecs verrouillent » deviendrait vrai ou faux selon l'ordre
// d'exécution.
type loginWorld struct {
	process  *process
	dsn      string
	refusals []response
	// challenge est le second facteur en attente que la dernière connexion réussie a émis. Il est
	// retenu ici et non relu plus tard : `received` ne porte que la **dernière** réponse, et les
	// scénarios du second facteur en émettent d'autres avant de s'en servir.
	challenge string
	// answers est ce que la dernière rafale a recueilli. `received` ne porterait que la réponse
	// arrivée en dernier, et une rafale se juge sur les trente.
	answers []response
}

func (w *loginWorld) installationWithOneOperator(ctx context.Context) error {
	dsn, err := migratedDatabase(ctx)
	if err != nil {
		return err
	}

	if _, err = store.Seed(ctx, dsn); err != nil {
		return fmt.Errorf("semer le vocabulaire : %w", err)
	}

	hash, err := auth.Hash(scenarioPassword)
	if err != nil {
		return fmt.Errorf("hacher le mot de passe du scénario : %w", err)
	}

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	_, err = conn.Exec(ctx,
		`INSERT INTO operators (email, display_name, password_hash) VALUES ($1, $2, $3)`,
		scenarioEmail, "Camille Durand", hash)
	if err != nil {
		return fmt.Errorf("créer l'opérateur du scénario : %w", err)
	}

	w.dsn = dsn

	return w.pointTheServerAt(dsn)
}

// pointTheServerAt reprend la forme de `schemaWorld` : la configuration complète, dont seul le DSN
// change, et ce que les pas précédents ont posé est conservé.
func (w *loginWorld) pointTheServerAt(dsn string) error {
	env := completeConfiguration()

	if _, exists := env["DASHBOARD_DATABASE_URL"]; !exists {
		return errors.New("la configuration complète ne porte plus de DSN : ce scénario ne ferait " +
			"plus varier ce qu'il annonce")
	}

	maps.Copy(env, w.process.env)
	env["DASHBOARD_DATABASE_URL"] = dsn
	w.process.env = env

	return nil
}

func (w *loginWorld) signInWithTheRightPassword() error {
	return w.postCredentials(scenarioEmail, scenarioPassword)
}

// callerAddress est celle que le serveur voit sur la connexion : aucun pas du décor n'envoie
// `X-Forwarded-For`, donc c'est l'hôte de la boucle locale par lequel `process` le joint.
func (w *loginWorld) callerAddress() string {
	host, _, err := net.SplitHostPort(w.process.addr)
	if err != nil {
		return w.process.addr
	}

	return host
}

func (w *loginWorld) signInWithAWrongPassword() error {
	if err := w.postCredentials(scenarioEmail, "ce n'est pas le bon"); err != nil {
		return err
	}

	w.refusals = append(w.refusals, *w.process.received)

	return nil
}

func (w *loginWorld) signInWithAnUnknownAddress() error {
	if err := w.postCredentials(unknownEmail, "ce n'est pas le bon"); err != nil {
		return err
	}

	w.refusals = append(w.refusals, *w.process.received)

	return nil
}

func (w *loginWorld) signInWithAWrongPasswordTimes(times int) error {
	for range times {
		if err := w.signInWithAWrongPassword(); err != nil {
			return err
		}
	}

	return nil
}

func (w *loginWorld) postMalformedBody() error {
	return w.process.post("/api/auth/login", "ceci n'est pas du JSON")
}

func (w *loginWorld) postCredentials(email, password string) error {
	body, err := json.Marshal(map[string]string{"email": email, "password": password})
	if err != nil {
		return fmt.Errorf("composer le corps de la requête : %w", err)
	}

	if err = w.process.post("/api/auth/login", string(body)); err != nil {
		return err
	}

	w.rememberChallenge()

	return nil
}

// rememberChallenge met de côté ce que la connexion vient d'émettre, s'il y a quelque chose. Un refus
// ne porte pas de challenge, et le silence est alors le bon comportement : c'est le pas du second
// facteur qui se plaindra de n'avoir rien à présenter.
func (w *loginWorld) rememberChallenge() {
	var issued struct {
		Challenge string `json:"challenge"`
	}

	if json.Unmarshal([]byte(w.process.received.body), &issued) == nil && issued.Challenge != "" {
		w.challenge = issued.Challenge
	}
}

// lockExpires recule l'horodatage stocké plutôt que d'attendre un quart d'heure. C'est **l'état de la
// base** qu'on déplace, pas le produit : aucun drapeau de test, aucune garde désarmée par une
// variable d'environnement — un binaire dont la garde se lève parce que le test le lui demande n'est
// plus celui qu'on déploie.
func (w *loginWorld) lockExpires(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, w.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	tag, err := conn.Exec(ctx,
		`UPDATE login_attempt_counters SET last_failure_at = last_failure_at - make_interval(secs => $1)`,
		(auth.LockWindow + time.Minute).Seconds())
	if err != nil {
		return fmt.Errorf("faire vieillir les compteurs : %w", err)
	}

	// Sans ce contrôle, un scénario qui n'aurait rien verrouillé passerait ce pas en silence et
	// « le verrou est échu » ne dirait plus rien de ce qui suit.
	if tag.RowsAffected() == 0 {
		return errors.New("aucun compteur à faire vieillir : rien n'avait verrouillé")
	}

	return nil
}

func (w *loginWorld) challengeIsIssued(ctx context.Context) error {
	if w.process.received == nil {
		return errors.New("aucune réponse à lire")
	}

	var challenge struct {
		Challenge string `json:"challenge"`
		ExpiresAt string `json:"expiresAt"`
	}

	if err := json.Unmarshal([]byte(w.process.received.body), &challenge); err != nil {
		return fmt.Errorf("lire le challenge : %w", err)
	}

	if challenge.Challenge == "" {
		return errors.New("la réponse ne porte aucun challenge : le second facteur n'a rien à vérifier")
	}

	expiresAt, err := time.Parse(time.RFC3339, challenge.ExpiresAt)
	if err != nil {
		return fmt.Errorf("lire l'échéance du challenge : %w", err)
	}

	if !expiresAt.After(time.Now()) {
		return fmt.Errorf("le challenge est émis déjà périmé (%s)", challenge.ExpiresAt)
	}

	return w.challengeMatchesWhatTheDatabaseKeeps(ctx, challenge.Challenge)
}

// challengeMatchesWhatTheDatabaseKeeps confronte le jeton **rendu** à l'empreinte **stockée**.
//
// Sans ce pas, rendre l'empreinte à la place du jeton passait toutes les portes : les deux font 32
// octets, donc 43 caractères, donc le `minLength` du contrat aussi. La panne n'apparaîtrait qu'en
// step-023, au moment de vérifier un second facteur que personne ne peut plus fournir.
//
// C'est aussi ce qui exerce enfin l'usage unique que DN-9 dit « porté par le schéma » : l'empreinte
// est cherchée par l'index unique, et une ligne non consommée est ce que step-023 consommera.
func (w *loginWorld) challengeMatchesWhatTheDatabaseKeeps(ctx context.Context, token string) error {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return fmt.Errorf("le challenge rendu n'est pas du base64url : %w", err)
	}

	digest := sha256.Sum256(raw)

	conn, err := pgx.Connect(ctx, w.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var pending bool

	err = conn.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM mfa_challenges WHERE token_hash = $1 AND consumed_at IS NULL)`,
		digest[:]).Scan(&pending)
	if err != nil {
		return fmt.Errorf("chercher l'empreinte du challenge : %w", err)
	}

	if !pending {
		return errors.New("aucun challenge en base ne porte l'empreinte du jeton rendu : le second " +
			"facteur n'aura rien à vérifier")
	}

	return nil
}

// refusalNamesNothing garde la copie du refus, et pas seulement son code. C'est là que l'oracle
// d'énumération se réinstalle le plus facilement : par une amélioration de message.
func (w *loginWorld) refusalNamesNothing() error {
	if w.process.received == nil {
		return errors.New("aucune réponse à lire")
	}

	body := strings.ToLower(w.process.received.body)

	for _, forbidden := range []string{
		strings.ToLower(scenarioEmail),
		strings.ToLower(unknownEmail),
		"mot de passe est",
		"aucun compte",
		"inconnu",
		"introuvable",
		"n'existe pas",
		"désactivé",
	} {
		if strings.Contains(body, forbidden) {
			return fmt.Errorf("le refus porte %q : il dit lequel des deux facteurs a échoué, ou que "+
				"l'adresse existe\n%s", forbidden, w.process.received.body)
		}
	}

	return nil
}

func (w *loginWorld) refusalsAreIndistinguishable() error {
	if len(w.refusals) < 2 {
		return fmt.Errorf("ce pas compare deux refus, %d ont été recueillis", len(w.refusals))
	}

	first, second := w.refusals[len(w.refusals)-2], w.refusals[len(w.refusals)-1]

	if first.status != second.status {
		return fmt.Errorf("« mot de passe faux » rend %d et « adresse inconnue » rend %d : le code "+
			"distingue les deux, donc il énumère les comptes", first.status, second.status)
	}

	if first.body != second.body {
		return fmt.Errorf("les deux refus ont des corps différents, donc ils énumèrent les comptes :"+
			"\n%s\n%s", first.body, second.body)
	}

	return nil
}

func (w *loginWorld) responseCarriesHeader(name string) error {
	if w.process.received == nil {
		return errors.New("aucune réponse à lire")
	}

	if w.process.received.header.Get(name) == "" {
		return fmt.Errorf("la réponse ne porte pas l'en-tête %q : un client qui ne lit pas le corps "+
			"ne sait pas combien de temps attendre", name)
	}

	return nil
}

// messageAnnouncesTheRemainingDelay exige une durée **dite**, pas seulement un en-tête. La charte
// interdit un contrôle qui refuse sans expliquer, et un opérateur ne lit pas les en-têtes.
func (w *loginWorld) messageAnnouncesTheRemainingDelay() error {
	if w.process.received == nil {
		return errors.New("aucune réponse à lire")
	}

	var refusal struct {
		Message string `json:"message"`
	}

	if err := json.Unmarshal([]byte(w.process.received.body), &refusal); err != nil {
		return fmt.Errorf("lire le refus : %w", err)
	}

	if !strings.Contains(refusal.Message, "minute") && !strings.Contains(refusal.Message, "seconde") {
		return fmt.Errorf("le message n'annonce aucune durée : « %s »", refusal.Message)
	}

	return nil
}

// burstSize est la rafale que les deux scénarios tirent : trente essais pour un plafond de cinq. Ce
// qui doit rester vrai est que vingt-cinq d'entre eux ne coûtent aucune vérification.
const burstSize = 30

func (w *loginWorld) burstOfWrongPasswords(ctx context.Context) error {
	body, err := json.Marshal(map[string]string{
		"email": scenarioEmail, "password": "ce n'est pas le bon",
	})
	if err != nil {
		return fmt.Errorf("composer le corps de la requête : %w", err)
	}

	return w.burst(ctx, "/api/auth/login", string(body))
}

// burstOfWrongCodes rejoue le **même** challenge trente fois : un échec ne le consomme pas, et c'est
// précisément ce qui rend la rafale possible pour qui détient le mot de passe.
func (w *loginWorld) burstOfWrongCodes(ctx context.Context) error {
	if w.challenge == "" {
		return errors.New("aucun challenge en attente : la connexion n'en a pas émis")
	}

	body, err := json.Marshal(map[string]string{
		"challenge": w.challenge, "method": "totp", "code": "123456",
	})
	if err != nil {
		return fmt.Errorf("composer le corps du second facteur : %w", err)
	}

	return w.burst(ctx, "/api/auth/mfa/verify", string(body))
}

// burst tire `burstSize` requêtes **ensemble** — relâchées par un seul `WaitGroup` — et retient les
// réponses.
//
// Il n'emprunte pas `process.post` : celui-ci écrase un unique `received` et mute une map de cookies
// sans verrou, et ce tir-ci en ferait une course plutôt qu'une mesure.
func (w *loginWorld) burst(ctx context.Context, path, body string) error {
	var (
		release  sync.WaitGroup
		finished sync.WaitGroup
		mutex    sync.Mutex
		failure  error
	)

	url, cookies := w.process.url(path), maps.Clone(w.process.cookies)
	w.answers = nil

	release.Add(1)
	finished.Add(burstSize)

	for range burstSize {
		go func() {
			defer finished.Done()
			release.Wait()

			answer, err := postAlone(ctx, url, body, cookies)

			mutex.Lock()
			defer mutex.Unlock()

			if err != nil {
				failure = errors.Join(failure, err)

				return
			}

			w.answers = append(w.answers, answer)
		}()
	}

	release.Done()
	finished.Wait()

	return failure
}

// postAlone reprend la forme de `process.send` sans aucun état partagé : les cookies lui sont donnés,
// et la réponse lui est rendue plutôt qu'écrite dans le harnais.
func postAlone(ctx context.Context, url, body string, cookies map[string]string) (response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return response{}, fmt.Errorf("composer la requête vers %s : %w", url, err)
	}

	browserHeaders(request, configuredOrigin, "application/json")

	for name, value := range cookies {
		request.AddCookie(&http.Cookie{Name: name, Value: value})
	}

	resp, err := browser.Do(request)
	if err != nil {
		return response{}, fmt.Errorf("la requête vers %s a échoué : %w", url, err)
	}

	defer resp.Body.Close()

	received, err := io.ReadAll(resp.Body)
	if err != nil {
		return response{}, fmt.Errorf("lecture de la réponse de %s : %w", url, err)
	}

	return response{status: resp.StatusCode, header: resp.Header, body: string(received)}, nil
}

// answersCounting compte les réponses de la rafale par **statut et code d'erreur**. Le message d'échec
// nomme la répartition observée : sous concurrence elle change à chaque exécution, et cette instabilité
// est elle-même le symptôme.
func (w *loginWorld) answersCounting(status int, code string) func(int) error {
	return func(expected int) error {
		seen := 0

		for _, answer := range w.answers {
			if answer.status == status && errorCode(answer.body) == code {
				seen++
			}
		}

		if seen != expected {
			return fmt.Errorf("%d réponses portent %d %s, %d attendues sur %d tirées — répartition "+
				"observée : %s", seen, status, code, expected, len(w.answers), w.distribution())
		}

		return nil
	}
}

func (w *loginWorld) distribution() string {
	counted := map[string]int{}

	for _, answer := range w.answers {
		counted[fmt.Sprintf("%d %s", answer.status, errorCode(answer.body))]++
	}

	seen := make([]string, 0, len(counted))
	for _, kind := range slices.Sorted(maps.Keys(counted)) {
		seen = append(seen, fmt.Sprintf("%d × %s", counted[kind], kind))
	}

	return strings.Join(seen, ", ")
}

// attemptsConsumed lit ce que la rafale a réellement coûté, dans la seule trace qui le porte : le
// compteur en base. La répartition des réponses ne le dit pas — un essai vérifié puis refusé parce
// qu'il dépasse le seuil rend le **même** 429 que celui qu'on arrête à la porte, et le hachage est
// déjà payé.
func (w *loginWorld) attemptsConsumed(ctx context.Context, expected int) error {
	conn, err := pgx.Connect(ctx, w.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var consumed int

	err = conn.QueryRow(ctx,
		`SELECT COALESCE(MAX(failures), 0) FROM login_attempt_counters`).Scan(&consumed)
	if err != nil {
		return fmt.Errorf("lire les compteurs d'essais : %w", err)
	}

	if consumed != expected {
		return fmt.Errorf("%d essais ont été consommés, %d attendus : autant de vérifications payées "+
			"pour un plafond qui en autorise %d — répartition des réponses : %s",
			consumed, expected, expected, w.distribution())
	}

	return nil
}

func errorCode(body string) string {
	var refusal struct {
		Code string `json:"code"`
	}

	_ = json.Unmarshal([]byte(body), &refusal)

	return refusal.Code
}

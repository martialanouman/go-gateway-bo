package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"
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

	return w.process.post("/api/auth/login", string(body))
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

func (w *loginWorld) challengeIsIssued() error {
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

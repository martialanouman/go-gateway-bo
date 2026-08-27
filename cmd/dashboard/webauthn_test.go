package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/cucumber/godog"
	"github.com/descope/virtualwebauthn"
)

// Le domaine des cérémonies, tel que `completeConfiguration()` le pose. Il ne ressemble **pas** à
// l'adresse d'écoute, et c'est ce qui donne leur force aux scénarios : le serveur ne peut tenir cette
// origine que de sa configuration, jamais de la requête, qui arrive de `http://127.0.0.1:<port>`.
const (
	ceremonyRelyingPartyID = "dashboard.exemple.test"
	ceremonyOrigin         = "https://dashboard.exemple.test"
	// L'origine d'un site qui aurait hameçonné l'opérateur : la bonne clé, le bon défi, sa propre
	// origine dans les données signées.
	phishingOrigin = "https://ailleurs.exemple.test"
)

// webauthnWorld porte l'authentificateur virtuel d'un scénario et ce qu'il a enregistré.
//
// `virtualwebauthn` fait ici ce que fait un navigateur avec une clé : il lit les options, produit une
// réponse signée, et n'en sait pas plus que ça. Il ne remplace **aucun** morceau du produit — le
// serveur sous test est le binaire, et la frontière du système est la même que pour les autres
// scénarios.
type webauthnWorld struct {
	login   *loginWorld
	session *sessionWorld

	authenticator virtualwebauthn.Authenticator
	// credentials sont les clés que l'authentificateur a produites, dans l'ordre. Le harnais les garde
	// parce qu'une clé n'est utilisable qu'avec la ligne que le serveur en a faite.
	credentials []virtualwebauthn.Credential
	// passkeys sont les identifiants que le serveur a rendus, dans le même ordre — c'est par eux qu'on
	// retire, jamais par l'identifiant que l'authentificateur s'est choisi.
	passkeys []string
	// presented est la dernière assertion envoyée, telle quelle. Le rejeu la renvoie **à la lettre** :
	// en recomposer une signerait un autre défi et ne prouverait rien de l'anti-rejeu.
	presented string
}

// registerSteps vit ici et non dans `initializeScenario`, comme celui de `mfaWorld` : c'est la
// quatrième step d'authentification d'affilée, et le registre de `main_test.go` grossissait d'une
// vingtaine de lignes à chaque fois.
func (w *webauthnWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une clé d'accès enregistrée$`, w.registerPasskey)
	ctx.When(`^l'opérateur enregistre une clé d'accès$`, w.registerPasskey)
	ctx.Given(`^une seconde clé d'accès enregistrée$`, w.registerPasskey)
	ctx.When(`^l'opérateur enregistre une seconde clé d'accès$`, w.registerPasskey)
	ctx.Given(`^l'opérateur a présenté sa clé d'accès$`, w.assertPasskey)
	ctx.When(`^l'opérateur présente sa clé d'accès$`, w.assertPasskey)
	ctx.When(`^l'opérateur ouvre une assertion sans clé enregistrée$`, w.beginAssertion)
	ctx.When(`^l'opérateur représente exactement la même assertion$`, w.replayTheSameAssertion)
	ctx.When(`^l'opérateur ouvre une assertion puis finit un enregistrement avec ce défi$`,
		w.finishRegistrationWithAnAssertionChallenge)
	ctx.When(`^l'opérateur ouvre une assertion puis se reconnecte avant de la finir$`,
		w.assertAcrossASecondSession)
	ctx.When(`^l'opérateur présente sa clé d'accès signée pour une autre origine$`,
		w.assertFromAnotherOrigin)
	ctx.When(`^l'opérateur retire sa première clé d'accès$`, w.removeFirstPasskey)
	ctx.When(`^l'opérateur présente (\d+) assertions fausses$`, w.presentWrongAssertions)
	ctx.Then(`^il lui reste (\d+) clés d'accès$`, w.passkeysRemaining)
	ctx.Then(`^le second facteur est refusé$`, w.secondFactorIsRefused)
	ctx.Then(`^le second facteur est verrouillé$`, w.secondFactorIsLocked)
	ctx.Then(`^la réponse conduit vers l'enrôlement$`, w.responseLeadsToEnrolment)
	ctx.Then(`^la cérémonie est refusée$`, w.ceremonyIsRefused)
	ctx.Then(`^le refus dit qu'il faut d'abord un autre facteur$`, w.refusalNamesTheMissingFactor)
	ctx.Then(`^le refus dit comment ajouter un facteur$`, w.refusalNamesTheElevation)
}

func (w *webauthnWorld) relyingParty(origin string) virtualwebauthn.RelyingParty {
	return virtualwebauthn.RelyingParty{
		Name:   "Passerelle SMS Admin",
		ID:     ceremonyRelyingPartyID,
		Origin: origin,
	}
}

// registerPasskey joue la cérémonie complète : ouvrir, signer, finir.
//
// Elle **n'exige pas** que le serveur ait accepté : trois scénarios l'appellent en attendant un refus
// (409 sans élévation), et exiger ici masquerait ce qu'ils observent. Le pas suivant lit le statut.
func (w *webauthnWorld) registerPasskey() error {
	if err := w.login.process.post("/api/auth/mfa/webauthn/register/begin", ""); err != nil {
		return err
	}

	if w.login.process.received.status != 200 {
		return nil
	}

	options, err := virtualwebauthn.ParseAttestationOptions(w.login.process.received.body)
	if err != nil {
		return fmt.Errorf("relire les options d'enregistrement : %w\n%s", err,
			w.login.process.received.body)
	}

	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	attestation := virtualwebauthn.CreateAttestationResponse(w.relyingParty(ceremonyOrigin),
		w.authenticator, credential, *options)

	if err = w.finishRegistration(attestation); err != nil {
		return err
	}

	if w.login.process.received.status != 200 {
		return nil
	}

	var registered struct {
		ID string `json:"id"`
	}

	if err = json.Unmarshal([]byte(w.login.process.received.body), &registered); err != nil {
		return fmt.Errorf("relire la passkey enregistrée : %w", err)
	}

	w.authenticator.AddCredential(credential)
	w.credentials = append(w.credentials, credential)
	w.passkeys = append(w.passkeys, registered.ID)

	return nil
}

func (w *webauthnWorld) finishRegistration(attestation string) error {
	body, err := json.Marshal(map[string]json.RawMessage{"attestation": json.RawMessage(attestation)})
	if err != nil {
		return fmt.Errorf("composer le corps de l'enregistrement : %w", err)
	}

	return w.login.process.post("/api/auth/mfa/webauthn/register/finish", string(body))
}

func (w *webauthnWorld) beginAssertion() error {
	return w.login.process.post("/api/auth/mfa/webauthn/assert/begin", "")
}

// assertPasskey ouvre une assertion, la signe, et la présente à la vérification.
func (w *webauthnWorld) assertPasskey() error {
	return w.assertSignedFor(ceremonyOrigin)
}

// assertFromAnotherOrigin signe la même assertion pour une origine que le serveur n'attend pas. La
// clé est la bonne, le défi est le bon : seule l'origine inscrite dans les données signées diffère.
func (w *webauthnWorld) assertFromAnotherOrigin() error {
	return w.assertSignedFor(phishingOrigin)
}

func (w *webauthnWorld) assertSignedFor(origin string) error {
	assertion, err := w.signAnAssertion(origin)
	if err != nil || assertion == "" {
		return err
	}

	return w.presentAssertion(assertion)
}

// signAnAssertion ouvre une cérémonie et rend la réponse signée, sans la présenter. Une chaîne vide
// dit que l'ouverture n'a pas abouti — le pas suivant lit alors le statut de cette ouverture.
func (w *webauthnWorld) signAnAssertion(origin string) (string, error) {
	if err := w.beginAssertion(); err != nil {
		return "", err
	}

	if w.login.process.received.status != 200 {
		return "", nil
	}

	options, err := virtualwebauthn.ParseAssertionOptions(w.login.process.received.body)
	if err != nil {
		return "", fmt.Errorf("relire les options d'assertion : %w\n%s", err,
			w.login.process.received.body)
	}

	credential := w.authenticator.FindAllowedCredential(*options)
	if credential == nil {
		return "", errors.New("l'authentificateur ne détient aucune clé que ces options admettent")
	}

	return virtualwebauthn.CreateAssertionResponse(w.relyingParty(origin), w.authenticator,
		*credential, *options), nil
}

// presentAssertion envoie l'assertion à la vérification du second facteur — la **même** opération que
// pour un code TOTP, avec `method: webauthn`.
func (w *webauthnWorld) presentAssertion(assertion string) error {
	w.presented = assertion

	body, err := json.Marshal(map[string]any{
		"challenge": w.login.challenge,
		"method":    "webauthn",
		"assertion": json.RawMessage(assertion),
	})
	if err != nil {
		return fmt.Errorf("composer le corps du second facteur : %w", err)
	}

	return w.login.process.post("/api/auth/mfa/verify", string(body))
}

// replayTheSameAssertion renvoie **à la lettre** ce qui vient d'être envoyé. En recomposer une
// signerait un autre défi et ne dirait rien de l'anti-rejeu.
func (w *webauthnWorld) replayTheSameAssertion() error {
	if w.presented == "" {
		return errors.New("aucune assertion déjà présentée : le scénario n'a rien à rejouer")
	}

	return w.presentAssertion(w.presented)
}

// finishRegistrationWithAnAssertionChallenge ouvre une cérémonie d'**assertion**, puis présente sa
// réponse à la finition d'un **enregistrement**. Sans le contrôle d'objet, le serveur y verrait un
// défi vivant de cette session et enrôlerait une clé neuve sans que rien n'ait été prouvé.
func (w *webauthnWorld) finishRegistrationWithAnAssertionChallenge() error {
	assertion, err := w.signAnAssertion(ceremonyOrigin)
	if err != nil {
		return err
	}

	if assertion == "" {
		return errors.New("l'ouverture de l'assertion n'a pas abouti : le scénario ne peut rien exercer")
	}

	return w.finishRegistration(assertion)
}

// assertAcrossASecondSession ouvre une cérémonie, se reconnecte — ce qui ouvre une **autre** session
// et ferme celle-ci — puis présente la réponse signée pour le défi de la première.
func (w *webauthnWorld) assertAcrossASecondSession() error {
	assertion, err := w.signAnAssertion(ceremonyOrigin)
	if err != nil {
		return err
	}

	if assertion == "" {
		return errors.New("l'ouverture de l'assertion n'a pas abouti : le scénario ne peut rien exercer")
	}

	if err = w.login.signInWithTheRightPassword(); err != nil {
		return err
	}

	return w.presentAssertion(assertion)
}

// presentWrongAssertions envoie n assertions que rien ne peut accepter. Ce qu'elles exercent est le
// **compteur**, partagé avec les codes à six chiffres, et non la vérification de signature.
func (w *webauthnWorld) presentWrongAssertions(count int) error {
	for range count {
		body, err := json.Marshal(map[string]any{
			"challenge": w.login.challenge,
			"method":    "webauthn",
			"assertion": map[string]string{"id": "aucune", "type": "public-key"},
		})
		if err != nil {
			return fmt.Errorf("composer une assertion fausse : %w", err)
		}

		if err = w.login.process.post("/api/auth/mfa/verify", string(body)); err != nil {
			return err
		}
	}

	return nil
}

func (w *webauthnWorld) removeFirstPasskey() error {
	if len(w.passkeys) == 0 {
		return errors.New("aucune clé d'accès enregistrée : le scénario n'a rien à retirer")
	}

	return w.login.process.remove("/api/auth/mfa/webauthn/passkeys/" + w.passkeys[0])
}

// passkeysRemaining relit `/auth/me`, qui est le seul endroit d'où le client apprend ce qu'il
// détient.
func (w *webauthnWorld) passkeysRemaining(expected int) error {
	restored := w.login.process.received

	if err := w.login.process.fetch("/api/auth/me"); err != nil {
		return err
	}

	status, body := w.login.process.received.status, w.login.process.received.body

	decoded, err := w.session.decode()
	w.login.process.received = restored

	if err != nil {
		return err
	}

	// L'exigence de 200 n'est pas décorative : sans elle, un corps d'erreur se démarshalerait en zéros
	// et « il lui reste 0 clés » serait vrai sur toute réponse cassée. C'est le défaut que la revue de
	// step-023 a trouvé sur `elevation()`.
	if status != 200 {
		return fmt.Errorf("/auth/me a répondu %d : ce pas ne peut rien affirmer du compte\n%s",
			status, body)
	}

	if decoded.SecondFactors.Passkeys != expected {
		return fmt.Errorf("la console annonce %d clé(s) d'accès pour %d attendue(s)",
			decoded.SecondFactors.Passkeys, expected)
	}

	return nil
}

func (w *webauthnWorld) secondFactorIsRefused() error {
	return w.refusalIs(401, "invalid_second_factor")
}

func (w *webauthnWorld) ceremonyIsRefused() error {
	return w.refusalIs(401, "webauthn_ceremony_refused")
}

func (w *webauthnWorld) responseLeadsToEnrolment() error {
	return w.refusalIs(400, "no_passkey_enrolled")
}

func (w *webauthnWorld) refusalNamesTheMissingFactor() error {
	if err := w.refusalIs(409, "mfa_last_factor"); err != nil {
		return err
	}

	return w.messageMentions("Enrôler un autre facteur")
}

func (w *webauthnWorld) refusalNamesTheElevation() error {
	if err := w.refusalIs(409, "mfa_elevation_required"); err != nil {
		return err
	}

	return w.messageMentions("franchir")
}

func (w *webauthnWorld) secondFactorIsLocked() error {
	return w.refusalIs(429, "too_many_attempts")
}

func (w *webauthnWorld) refusalIs(status int, code string) error {
	received := w.login.process.received
	if received == nil {
		return errors.New("aucune réponse à lire")
	}

	if received.status != status {
		return fmt.Errorf("la réponse est %d et non %d\n%s", received.status, status, received.body)
	}

	var refusal struct {
		Code string `json:"code"`
	}

	if err := json.Unmarshal([]byte(received.body), &refusal); err != nil {
		return fmt.Errorf("relire le refus : %w\n%s", err, received.body)
	}

	if refusal.Code != code {
		return fmt.Errorf("le refus porte le code %q et non %q", refusal.Code, code)
	}

	return nil
}

// messageMentions lit la **copie**, pas le code : c'est elle que l'opérateur voit, et un refus qui
// n'expliquerait pas par où passer serait un contrôle interdit sans explication.
func (w *webauthnWorld) messageMentions(fragment string) error {
	var refusal struct {
		Message string `json:"message"`
	}

	if err := json.Unmarshal([]byte(w.login.process.received.body), &refusal); err != nil {
		return fmt.Errorf("relire le message du refus : %w", err)
	}

	if !strings.Contains(refusal.Message, fragment) {
		return fmt.Errorf("le message ne dit pas %q : %q", fragment, refusal.Message)
	}

	return nil
}

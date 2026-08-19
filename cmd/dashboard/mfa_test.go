package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/hotp"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/mfa"
)

// mfaWorld porte ce qu'un scénario de second facteur manipule : l'enrôlement qu'il vient d'obtenir,
// et de quoi fabriquer les codes que l'application de l'opérateur produirait.
//
// Il partage la base et le navigateur du `loginWorld`, comme `sessionWorld` — étendre le parcours
// existant plutôt qu'en ouvrir un second.
type mfaWorld struct {
	login   *loginWorld
	session *sessionWorld
	// enrolled est ce que le dernier enrôlement a rendu. Le secret y est **en clair**, comme dans le
	// téléphone de l'opérateur : le harnais ne déchiffre jamais la colonne.
	enrolled enrollment
	// previousSecret sert au seul scénario du remplacement, qui doit constater que le secret a changé.
	previousSecret string
	// otherChallenge est celui d'un **autre** opérateur, que le scénario de l'appartenance présente sur
	// sa propre session.
	otherChallenge string
	// presented est le dernier code envoyé, tel quel. Le rejeu le renvoie **à la lettre** plutôt que
	// d'en recalculer un : recalculer ferait dépendre le scénario du rejeu d'une frontière de pas.
	presented string
}

// secondOperatorEmail est l'adresse du comparse. Il n'a ni rôle ni second facteur : ce que le
// scénario emprunte de lui est son challenge, rien de plus.
const secondOperatorEmail = "martin.leroy@exemple.test"

// enrollment est le corps de `POST /auth/mfa/totp/enroll`.
type enrollment struct {
	Secret        string   `json:"secret"`
	OtpauthURI    string   `json:"otpauthUri"`
	RecoveryCodes []string `json:"recoveryCodes"`
}

// registerSteps déclare les pas de ce monde. Il vit ici et non dans `initializeScenario` : le
// registre de `main_test.go` grossissait d'une vingtaine de lignes à chaque step d'authentification,
// et c'est la troisième d'affilée.
func (w *mfaWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^l'opérateur enrôle une application d'authentification$`, w.enroll)
	ctx.When(`^l'opérateur enrôle une application d'authentification$`, w.enroll)
	ctx.Given(`^l'opérateur présente le code du pas courant$`, w.presentCodeAtOffset(0))
	ctx.When(`^l'opérateur présente le code du pas courant$`, w.presentCodeAtOffset(0))
	ctx.When(`^l'opérateur présente le code du pas précédent$`, w.presentCodeAtOffset(-1))
	ctx.When(`^l'opérateur présente le code du pas suivant$`, w.presentCodeAtOffset(1))
	ctx.When(`^l'opérateur présente le code à deux pas$`, w.presentCodeAtOffset(2))
	ctx.When(`^l'opérateur présente un code faux$`, w.presentWrongCode)
	ctx.Given(`^l'opérateur présente (\d+) codes faux$`, w.presentWrongCodes)
	ctx.When(`^l'opérateur présente (\d+) codes faux$`, w.presentWrongCodes)
	ctx.When(`^l'opérateur présente son premier code de récupération$`, w.presentFirstRecoveryCode)
	ctx.When(`^l'opérateur représente le même code$`, w.presentTheSameCodeAgain)
	ctx.When(`^l'opérateur remplace son authentificateur en présentant son code$`,
		w.replaceProvingTheCurrentCode)
	ctx.When(`^l'opérateur présente un code qui n'est celui d'aucun authentificateur$`,
		w.presentCodeWithoutEnrolment)
	ctx.When(`^l'opérateur présente un code démesuré$`, w.presentOversizedCode)
	ctx.When(`^l'opérateur présente une méthode que le contrat ne déclare pas$`, w.presentUnknownMethod)
	ctx.Given(`^un second opérateur qui vient de se connecter$`, w.secondOperatorSignsIn)
	ctx.When(`^l'opérateur présente son code sur le challenge du second opérateur$`,
		w.presentOnTheOtherChallenge)
	ctx.Then(`^l'enrôlement rend l'URI, le secret et dix codes de récupération$`, w.enrollmentIsComplete)
	ctx.Then(`^le secret rendu diffère du précédent$`, w.secretChanged)
	ctx.Then(`^le second facteur est vérifié$`, w.secondFactorIsVerified)
	ctx.Then(`^le second facteur n'est pas encore vérifié$`, w.secondFactorIsNotVerified)
	ctx.Then(`^il lui reste (\d+) codes de récupération$`, w.recoveryCodesRemaining)
	ctx.Then(`^le refus ne dit pas ce qui a été refusé$`, w.refusalNamesNothing)
	ctx.Then(`^le refus dit par où passer$`, w.refusalNamesTheWayOut)
	ctx.Then(`^la réponse ne porte ni le secret ni aucun code de récupération$`, w.responseHidesTheSecret)
	ctx.Then(`^la réponse annonce un second facteur enrôlé$`, w.announcesAnEnrolledFactor)
}

func (w *mfaWorld) enroll() error {
	return w.enrollProving(nil)
}

// enrollProving enrôle en présentant — ou non — une preuve du facteur en place. Le premier
// enrôlement n'a rien à prouver ; le remplacement détruit ce qu'il remplace, donc il l'exige.
func (w *mfaWorld) enrollProving(proof map[string]string) error {
	w.previousSecret = w.enrolled.Secret

	body, err := json.Marshal(proof)
	if err != nil {
		return fmt.Errorf("composer le corps de l'enrôlement : %w", err)
	}

	if proof == nil {
		body = []byte("{}")
	}

	if err = w.login.process.post("/api/auth/mfa/totp/enroll", string(body)); err != nil {
		return err
	}

	if w.login.process.received.status != 200 {
		return nil
	}

	var enrolled enrollment
	if err := json.Unmarshal([]byte(w.login.process.received.body), &enrolled); err != nil {
		return fmt.Errorf("relire l'enrôlement : %w\n%s", err, w.login.process.received.body)
	}

	w.enrolled = enrolled

	return nil
}

// replaceProvingTheCurrentCode remplace l'authentificateur en présentant un code de celui qui est en
// place — la preuve que le remplacement exige, puisqu'il le détruit.
// Le code présenté est celui du pas **suivant** : la vérification qui précède vient de consommer le
// pas courant, et l'anti-rejeu refuse à juste titre de le resservir. C'est ce que vit l'opérateur —
// il rouvre son application et y lit un autre code.
func (w *mfaWorld) replaceProvingTheCurrentCode(ctx context.Context) error {
	code, err := w.codeAtOffset(ctx, 1)
	if err != nil {
		return err
	}

	return w.enrollProving(map[string]string{"method": "totp", "code": code})
}

// currentStep lit le pas de temps **dans la base**, qui est l'horloge que le serveur emploie. Le
// calculer à partir de celle du harnais ferait dépendre le scénario de deux horloges au lieu d'une,
// et un décalage d'une seconde le rendrait rouge une fois sur trente.
func (w *mfaWorld) currentStep(ctx context.Context) (int64, error) {
	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return 0, fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	var step int64

	err = conn.QueryRow(ctx, `SELECT floor(extract(epoch FROM now()) / $1)::bigint`,
		mfa.PeriodSeconds).Scan(&step)
	if err != nil {
		return 0, fmt.Errorf("lire le pas de temps courant : %w", err)
	}

	return step, nil
}

// presentCodeAtOffset fabrique le code d'un pas voisin comme le ferait une application dont l'horloge
// dérive, et le présente.
func (w *mfaWorld) presentCodeAtOffset(offset int64) func(context.Context) error {
	return func(ctx context.Context) error {
		code, err := w.codeAtOffset(ctx, offset)
		if err != nil {
			return err
		}

		return w.verify("totp", code)
	}
}

// codeAtOffset fabrique le code d'un pas voisin comme le ferait une application dont l'horloge dérive.
func (w *mfaWorld) codeAtOffset(ctx context.Context, offset int64) (string, error) {
	if w.enrolled.Secret == "" {
		return "", errors.New("aucun enrôlement : le scénario n'a pas de secret pour fabriquer un code")
	}

	step, err := w.currentStep(ctx)
	if err != nil {
		return "", err
	}

	code, err := hotp.GenerateCodeCustom(w.enrolled.Secret, uint64(step+offset), hotp.ValidateOpts{
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil {
		return "", fmt.Errorf("fabriquer le code du pas %d : %w", step+offset, err)
	}

	return code, nil
}

// presentWrongCode présente un code de six chiffres qui n'est celui d'aucun pas. Six chiffres et non
// une chaîne quelconque : ce qui doit être exercé est la comparaison, pas le refus de forme.
func (w *mfaWorld) presentWrongCode(ctx context.Context) error {
	step, err := w.currentStep(ctx)
	if err != nil {
		return err
	}

	// Un pas très éloigné produit un code de la bonne forme que la fenêtre ne couvre pas — plus sûr
	// qu'une constante, qui pourrait être le code du moment une fois sur un million.
	code, err := hotp.GenerateCodeCustom(w.enrolled.Secret, uint64(step+1_000), hotp.ValidateOpts{
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil {
		return fmt.Errorf("fabriquer un code faux : %w", err)
	}

	return w.verify("totp", code)
}

func (w *mfaWorld) presentWrongCodes(ctx context.Context, times int) error {
	for range times {
		if err := w.presentWrongCode(ctx); err != nil {
			return err
		}

		// 401 tant que le seuil n'est pas atteint, 429 à l'essai qui le franchit. Ce qui compte ici est
		// qu'aucun code faux n'ouvre : le pas suivant dira lequel des deux refus s'applique.
		if status := w.login.process.received.status; status != 401 && status != 429 {
			return fmt.Errorf("un code faux a été accepté : le serveur a répondu %d", status)
		}
	}

	return nil
}

// presentCodeWithoutEnrolment présente un code de six chiffres sur un compte qui n'a rien enrôlé.
// Ce que le scénario observe est que le refus est un **401** et non un 500 : sans la garde
// `!state.Enrolled`, la vérification partirait déchiffrer une colonne vide.
func (w *mfaWorld) presentCodeWithoutEnrolment() error {
	return w.verify("totp", "123456")
}

// Les deux refus de forme. Le corps entier est déjà borné à huit kibioctets par le routeur : ce que
// ces deux cas exercent est la borne du **champ**, redite en Go parce que rien ne valide une requête
// contre le YAML à l'exécution.
func (w *mfaWorld) presentOversizedCode() error {
	return w.verify("totp", strings.Repeat("1", 5_000))
}

func (w *mfaWorld) presentUnknownMethod() error {
	return w.verify("webauthn", "123456")
}

func (w *mfaWorld) presentFirstRecoveryCode() error {
	if len(w.enrolled.RecoveryCodes) == 0 {
		return errors.New("aucun code de récupération : le scénario n'a rien à présenter")
	}

	return w.verify("recovery_code", w.enrolled.RecoveryCodes[0])
}

// secondOperatorSignsIn pose un comparse et le connecte, pour mettre de côté **son** challenge.
//
// Le navigateur du harnais n'a qu'un jeu de cookies, comme un vrai : après ce pas il porte la session
// du comparse, et c'est le scénario qui fait revenir le premier opérateur en le reconnectant. Ce que
// ça reproduit est exactement l'attaque — deux comptes, deux challenges, et l'un présenté avec la
// session de l'autre.
func (w *mfaWorld) secondOperatorSignsIn(ctx context.Context) error {
	hash, err := auth.Hash(scenarioPassword)
	if err != nil {
		return fmt.Errorf("hacher le mot de passe du second opérateur : %w", err)
	}

	conn, err := pgx.Connect(ctx, w.login.dsn)
	if err != nil {
		return fmt.Errorf("joindre la base du scénario : %w", err)
	}

	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()

	_, err = conn.Exec(ctx,
		`INSERT INTO operators (email, display_name, password_hash) VALUES ($1, $2, $3)`,
		secondOperatorEmail, "Martin Leroy", hash)
	if err != nil {
		return fmt.Errorf("créer le second opérateur : %w", err)
	}

	if err = w.login.postCredentials(secondOperatorEmail, scenarioPassword); err != nil {
		return err
	}

	if w.login.process.received.status != 200 {
		return fmt.Errorf("le second opérateur n'a pas pu se connecter : %d",
			w.login.process.received.status)
	}

	w.otherChallenge = w.login.challenge

	return nil
}

// presentOnTheOtherChallenge présente un code **valide** — celui du pas courant, pour la session
// courante — sur le challenge de quelqu'un d'autre. Un code faux ne prouverait rien : c'est
// l'appartenance du challenge qui est en cause, pas le code.
func (w *mfaWorld) presentOnTheOtherChallenge(ctx context.Context) error {
	if w.otherChallenge == "" {
		return errors.New("aucun challenge d'un autre opérateur : le scénario n'a rien à emprunter")
	}

	if w.otherChallenge == w.login.challenge {
		return errors.New("le challenge emprunté est celui de la session courante : le scénario " +
			"n'éprouverait pas l'appartenance")
	}

	step, err := w.currentStep(ctx)
	if err != nil {
		return err
	}

	code, err := hotp.GenerateCodeCustom(w.enrolled.Secret, uint64(step), hotp.ValidateOpts{
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	if err != nil {
		return fmt.Errorf("fabriquer le code du pas courant : %w", err)
	}

	return w.verifyOn(w.otherChallenge, "totp", code)
}

func (w *mfaWorld) verify(method, code string) error {
	if w.login.challenge == "" {
		return errors.New("aucun challenge en attente : la connexion n'en a pas émis")
	}

	return w.verifyOn(w.login.challenge, method, code)
}

// presentTheSameCodeAgain rejoue **exactement** ce qui vient d'être envoyé.
func (w *mfaWorld) presentTheSameCodeAgain() error {
	if w.presented == "" {
		return errors.New("aucun code déjà présenté : le scénario n'a rien à rejouer")
	}

	return w.verify("totp", w.presented)
}

func (w *mfaWorld) verifyOn(challenge, method, code string) error {
	w.presented = code

	body, err := json.Marshal(map[string]string{
		"challenge": challenge,
		"method":    method,
		"code":      code,
	})
	if err != nil {
		return fmt.Errorf("composer le corps du second facteur : %w", err)
	}

	return w.login.process.post("/api/auth/mfa/verify", string(body))
}

func (w *mfaWorld) enrollmentIsComplete() error {
	if w.enrolled.Secret == "" {
		return errors.New("l'enrôlement ne rend aucun secret : la saisie manuelle est impossible")
	}

	if !strings.HasPrefix(w.enrolled.OtpauthURI, "otpauth://totp/") {
		return fmt.Errorf("l'URI rendue est %q : ce n'est pas ce qu'une application scanne",
			w.enrolled.OtpauthURI)
	}

	if !strings.Contains(w.enrolled.OtpauthURI, w.enrolled.Secret) {
		return errors.New("l'URI et la saisie manuelle ne portent pas le même secret : une des deux " +
			"voies d'enrôlement mènerait à des codes que le serveur refuse")
	}

	if len(w.enrolled.RecoveryCodes) != mfa.RecoveryCodeCount {
		return fmt.Errorf("%d code(s) de récupération rendu(s) pour %d attendus",
			len(w.enrolled.RecoveryCodes), mfa.RecoveryCodeCount)
	}

	return nil
}

func (w *mfaWorld) secretChanged() error {
	if w.previousSecret == "" {
		return errors.New("aucun enrôlement précédent : ce pas n'a rien à comparer")
	}

	if w.enrolled.Secret == w.previousSecret {
		return errors.New("le remplacement a rendu le même secret : l'ancien authentificateur ouvre " +
			"encore")
	}

	return nil
}

// secondFactorIsVerified et son contraire lisent `/auth/me`, donc l'état **servi** et non celui de la
// ligne. C'est ce que step-025 lira pour garder les écritures.
func (w *mfaWorld) secondFactorIsVerified() error {
	elevated, err := w.elevation()
	if err != nil {
		return err
	}

	if !elevated {
		return errors.New("la session n'est pas élevée : le second facteur n'a rien changé")
	}

	return nil
}

func (w *mfaWorld) secondFactorIsNotVerified() error {
	elevated, err := w.elevation()
	if err != nil {
		return err
	}

	if elevated {
		return errors.New("la session est élevée alors que rien n'a franchi le second facteur : " +
			"step-025 la laisserait écrire")
	}

	return nil
}

// elevation interroge `/auth/me` **sans écraser** ce que le scénario venait d'observer : les pas qui
// suivent portent encore sur la réponse du second facteur.
func (w *mfaWorld) elevation() (bool, error) {
	decoded, err := w.currentOperator()
	if err != nil {
		return false, err
	}

	return decoded.Elevated, nil
}

// currentOperator relit `/auth/me` et **exige un 200**.
//
// Sans cette exigence, un corps d'erreur se démarshalait en zéros : « le second facteur n'est pas
// encore vérifié » était donc vert sur *toute* réponse qui n'était pas un 200 disant `elevated:true` —
// y compris « il n'y a plus de session » et « le serveur a cassé ». Mesuré en revue le 12/08/2026 :
// c'est ce qui rendait invisible la garde « le challenge n'est pas consommé sur échec ».
func (w *mfaWorld) currentOperator() (me, error) {
	restored := w.login.process.received

	if err := w.login.process.fetch("/api/auth/me"); err != nil {
		return me{}, err
	}

	status, body := w.login.process.received.status, w.login.process.received.body

	decoded, err := w.session.decode()
	w.login.process.received = restored

	if err != nil {
		return me{}, err
	}

	if status != 200 {
		return me{}, fmt.Errorf("/auth/me a répondu %d : ce pas ne peut rien affirmer de la session\n%s",
			status, body)
	}

	return decoded, nil
}

func (w *mfaWorld) recoveryCodesRemaining(expected int) error {
	decoded, err := w.currentOperator()
	if err != nil {
		return err
	}

	if decoded.SecondFactors.RecoveryCodesRemaining != expected {
		return fmt.Errorf("il reste %d code(s) de récupération et non %d",
			decoded.SecondFactors.RecoveryCodesRemaining, expected)
	}

	return nil
}

func (w *mfaWorld) announcesAnEnrolledFactor() error {
	decoded, err := w.session.decode()
	if err != nil {
		return err
	}

	if !decoded.SecondFactors.TOTP {
		return errors.New("la réponse annonce un compte sans second facteur : l'écran renverrait vers " +
			"l'enrôlement d'un authentificateur déjà en place")
	}

	return nil
}

// refusalNamesNothing tient ce que le contrat promet : tous les motifs de refus lisent la même
// phrase — le code faux ou déjà servi, le challenge inconnu, échu, consommé ou appartenant à un
// autre, l'absence de session et sa mort en cours de route. Elle ne cite ni le code, ni le challenge,
// ni ce qui manque.
func (w *mfaWorld) refusalNamesNothing() error {
	body := w.login.process.received.body

	for _, forbidden := range []string{"challenge", "rejou", "expir", "épuis", "session"} {
		if strings.Contains(strings.ToLower(body), forbidden) {
			return fmt.Errorf("le refus nomme %q : il dit à une machine où elle en est\n%s", forbidden,
				body)
		}
	}

	return nil
}

// refusalNamesTheWayOut est l'inverse, et c'est la charte : un contrôle qui refuse dit où s'arrête
// l'accès et par où passer. Un 409 muet enverrait ouvrir un ticket.
func (w *mfaWorld) refusalNamesTheWayOut() error {
	body := strings.ToLower(w.login.process.received.body)

	if !strings.Contains(body, "administrateur") {
		return fmt.Errorf("le refus ne dit pas qui peut débloquer :\n%s", w.login.process.received.body)
	}

	return nil
}

// responseHidesTheSecret confronte le corps servi au secret que le harnais tient encore. C'est la
// seule façon d'observer « il n'est plus rendu » : l'absence d'un champ ne se prouve pas en le
// cherchant par son nom, elle se prouve en cherchant sa **valeur**.
func (w *mfaWorld) responseHidesTheSecret() error {
	if w.enrolled.Secret == "" {
		return errors.New("aucun enrôlement : ce pas n'a rien à chercher")
	}

	body := w.login.process.received.body

	if strings.Contains(body, w.enrolled.Secret) {
		return errors.New("le secret du second facteur est rendu par une réponse postérieure à " +
			"l'enrôlement")
	}

	for _, code := range w.enrolled.RecoveryCodes {
		if strings.Contains(body, code) {
			return fmt.Errorf("le code de récupération %q est rendu après l'enrôlement", code)
		}
	}

	return nil
}

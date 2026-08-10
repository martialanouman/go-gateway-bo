package bff

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/netip"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
)

// maximumPasswordLength et maximumEmailLength redisent en Go les bornes que le contrat déclare. Le
// redire n'est pas une duplication : **rien dans ce dépôt ne valide une requête à l'exécution** contre
// le YAML — le code engendré ne le fait pas, et `contrat.feature` ne valide que les réponses.
//
// Le corps entier est déjà borné à huit kibioctets par `RequestSize`. Ces deux lignes bornent les
// **champs**, et ce n'est pas redondant : huit kibioctets de mot de passe restent huit kibioctets à
// hacher, et huit kibioctets d'adresse deviennent la clé `subject` de `login_attempt_counters`, la
// seule table du schéma qu'une requête non authentifiée fait écrire.
//
// Le compte est en **runes** et non en octets, comme la `maxLength` du contrat et comme les deux
// autres lectures bornées du dépôt. En octets, un mot de passe de 2 049 caractères accentués aurait
// été refusé alors que le contrat l'autorise.
const (
	maximumPasswordLength = 4096
	maximumEmailLength    = 320
)

// maximumLoginBodyBytes borne ce que le décodeur JSON accepte de lire. La borne du champ ne suffit
// pas : elle s'applique après le décodage, donc après avoir lu le corps entier en mémoire.
const maximumLoginBodyBytes = 8 * 1024

// clientAddressKey est une clé privée : rien hors de ce paquet ne peut poser cette valeur, donc un
// appelant ne peut pas se choisir une adresse pour échapper au compteur.
type clientAddressKey struct{}

// withClientAddress dérive l'adresse cliente une fois par requête et la pose dans le contexte.
//
// **Ce middleware existe parce que le handler strict n'a pas la requête.** `oapi-codegen` en mode
// strict rend `Login(ctx, LoginRequestObject)` : c'est ce qui tient la convention du DTO de sortie,
// et c'est ce qui met `RemoteAddr` hors de portée. Le contexte est le seul chemin qui reste.
//
// Il ne pose **jamais** de chaîne vide : une adresse absente ferait un compteur global, c'est-à-dire
// un verrou qui marche et qui verrouille tout le monde. Le handler qui ne trouve rien rend 500.
func withClientAddress(trusted []netip.Prefix) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// `Values` et non `Get` : Go ne fusionne pas les lignes répétées d'un en-tête, et `Get` ne
			// rend que la **première**. Or tous les proxys n'ajoutent pas au même en-tête — HAProxy
			// `option forwardfor` en écrit une seconde ligne. Chez un tel proxy, `Get` rendrait la ligne
			// écrite par le **client**, et la remontée de droite à gauche s'appliquerait à une chaîne
			// entièrement forgée : l'attaquant choisirait sa clé de compteur, ou celle d'un tiers.
			//
			// Les lignes passent telles quelles, sans être jointes : `ClientAddress` les remonte de la
			// dernière à la première et borne ce qu'il examine. Les joindre aurait recopié tout ce que
			// le client a bien voulu envoyer, avant même de décider s'il fallait le lire.
			address, err := auth.ClientAddress(r.RemoteAddr, r.Header.Values("X-Forwarded-For"), trusted)
			if err != nil {
				next.ServeHTTP(w, r)

				return
			}

			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientAddressKey{}, address)))
		})
	}
}

func clientAddressFrom(ctx context.Context) (string, bool) {
	address, ok := ctx.Value(clientAddressKey{}).(string)

	return address, ok && address != ""
}

// errNoClientAddress remonte au gestionnaire d'erreur du handler strict, qui rend 500 sans citer le
// message. Refuser est le seul comportement sûr : servir la route sans adresse reviendrait à compter
// toutes les tentatives du monde sous une clé unique.
var errNoClientAddress = errors.New("aucune adresse cliente sur la requête")

// Login sert le premier facteur.
//
// Il ne décide de rien : l'ordre des gestes — verrou d'abord, hachage factice sur adresse inconnue,
// comptage des deux dimensions — vit dans `internal/auth`. Ce qui se décide ici est la **traduction
// en HTTP**, et elle tient en trois cas.
func (a API) Login(ctx context.Context, request LoginRequestObject) (LoginResponseObject, error) {
	address, ok := clientAddressFrom(ctx)
	if !ok {
		return nil, errNoClientAddress
	}

	// Les deux bornes sont gardées par `bornes_test.go`, sur une base morte : ce qui les franchit y
	// tombe, donc 400 s'y distingue de 500 et une borne retirée bascule de l'un à l'autre.
	//
	// **`request.Body == nil` est inatteignable par le routeur**, et c'est mesuré plutôt que supposé :
	// `strictHandler.Login` décode le corps puis assigne le pointeur **sans condition** (gabarit
	// `strict-http.tmpl` d'oapi-codegen v2.8.0) — un corps illisible rend 400 avant d'arriver ici, un
	// corps lisible donne toujours un pointeur. Aucun test ne la garde, et lui en écrire un demanderait
	// d'appeler cette méthode hors de son routeur : il prouverait la garde et rien du produit. Elle
	// reste parce que c'est la régénération du contrat qui décide de cette forme, pas nous — un corps
	// déclaré optionnel demain la rendrait atteignable, et son absence serait alors un panic.
	if request.Body == nil ||
		len([]rune(request.Body.Password)) > maximumPasswordLength ||
		len([]rune(request.Body.Email)) > maximumEmailLength {
		return Login400JSONResponse(badRequest()), nil
	}

	verdict, err := a.Authenticator.Login(ctx, request.Body.Email, request.Body.Password, address)
	if err != nil {
		return nil, err
	}

	switch verdict.Outcome {
	case auth.OutcomeChallenged:
		return Login200JSONResponse{Challenge: verdict.Challenge, ExpiresAt: verdict.ExpiresAt}, nil
	case auth.OutcomeLocked:
		return lockedResponse(verdict.RetryAfter), nil
	case auth.OutcomeRefused:
		return Login401JSONResponse(refusedCredentials()), nil
	default:
		// Inatteignable : `Outcome` n'a que trois valeurs, toutes traitées. La branche existe parce que
		// le langage n'en sait rien, et elle refuse plutôt qu'elle n'ouvre.
		return Login401JSONResponse(refusedCredentials()), nil
	}
}

// refusedCredentials est le refus **unique** du premier facteur. Un seul constructeur, appelé d'un
// seul endroit : c'est ce qui rend l'oracle d'énumération malaisé à réintroduire, puisqu'il n'y a pas
// deux messages entre lesquels choisir.
//
// La copie dit la conséquence d'abord, ne nomme ni l'adresse ni le facteur en cause, et n'accuse
// personne — l'opérateur qui se trompe de casse lit la même phrase que l'attaquant.
func refusedCredentials() Error {
	return Error{
		Code:    "invalid_credentials",
		Message: "La connexion a été refusée : l'adresse ou le mot de passe ne correspond pas. Réessayez.",
	}
}

func badRequest() Error {
	return Error{
		Code:    "bad_request",
		Message: "Cette requête a été refusée : sa forme ne correspond pas à ce que la route attend.",
	}
}

// lockedResponse annonce le verrou **et sa durée**. Un refus muet ferait retenter l'opérateur, puis
// ouvrir un ticket ; et la charte interdit un contrôle qui refuse sans expliquer où s'arrête l'accès.
//
// Les deux durées — l'en-tête et la phrase — sortent du **même** arrondi, pour qu'un client qui lit
// l'un et un opérateur qui lit l'autre ne voient jamais deux nombres différents.
func lockedResponse(remaining time.Duration) Login429JSONResponse {
	seconds := retryAfterSeconds(remaining)

	return Login429JSONResponse{
		Headers: Login429ResponseHeaders{RetryAfter: seconds},
		Body: Error{
			Code: "too_many_attempts",
			// La copie ne promet pas les deux dimensions à la fois. `LockFor` n'en rend **qu'une** — celle
			// qui a franchi son seuil — et les deux le franchissent indépendamment : cinq adresses
			// essayées depuis une même source ne verrouillent que la source, et un opérateur légitime
			// derrière elle lirait « ce compte est bloqué » alors qu'il pourrait entrer d'ailleurs. Elle
			// ne dit pas « ce compte » non plus : les compteurs portent sur l'adresse **soumise**, et il
			// n'y a pas toujours de compte derrière.
			Message: "La connexion est temporairement bloquée après plusieurs échecs : réessayez dans " +
				humanDelay(seconds) + ". Le blocage porte sur les tentatives récentes visant cette " +
				"adresse et sur celles venues de votre réseau, et se lève tout seul.",
		},
	}
}

// retryAfterSeconds arrondit **au supérieur**, avec un plancher à une seconde : le contrat déclare
// `minimum: 1`, et un `Retry-After: 0` dirait « réessaie tout de suite » à l'instant précis où l'on
// vient de refuser.
func retryAfterSeconds(remaining time.Duration) int {
	seconds := int(math.Ceil(remaining.Seconds()))
	if seconds < 1 {
		return 1
	}

	return seconds
}

// humanDelay rend la durée telle qu'on la dit, pas telle qu'on la calcule : « 15 minutes » et non
// « 900 secondes ». L'arrondi est au supérieur pour ne jamais faire revenir l'opérateur trop tôt.
func humanDelay(seconds int) string {
	if seconds < 60 {
		return plural(seconds, "seconde")
	}

	return plural((seconds+59)/60, "minute")
}

func plural(count int, unit string) string {
	rendered := unit
	if count > 1 {
		rendered += "s"
	}

	return itoa(count) + " " + rendered
}

// itoa évite d'importer `strconv` pour un seul appel, et surtout `fmt`, dont les verbes acceptent
// n'importe quoi : ici on formate un entier, et rien d'autre ne doit pouvoir s'y glisser.
func itoa(value int) string {
	if value == 0 {
		return "0"
	}

	var digits []byte

	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}

	return string(digits)
}

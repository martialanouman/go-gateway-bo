package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// CodeUpstreamUnreadable est le seul code que le BFF frappe lui-même : celui d'une réponse d'erreur
// dont le corps n'est pas l'enveloppe du contrat. Le préfixe `bff_` nomme l'émetteur, et l'émetteur
// n'est pas la passerelle — c'est ce qui interdit la confusion dans un log. Mesuré sur le contrat
// **2.5.0**, celui que la branche installe, le 02/08/2026 : `code` n'y porte aucun `pattern`
// (openapi-admin.yaml:1643-1646), ses exemples sont tous en snake_case (`forbidden_scope`,
// `validation_error`…), et `grep -c bff_` rend 0 sur les deux YAML du paquet.
const CodeUpstreamUnreadable = "bff_upstream_unreadable"

// FieldError est un élément de `errors[]` : le champ fautif et son explication. Le type engendré ne
// nomme pas cet élément — c'est un struct anonyme — et un formulaire ne peut pas placer ses erreurs
// sans lui.
type FieldError struct {
	Field   string
	Message string
}

// APIError est une réponse d'erreur de l'API Admin, portée par un type Go. Le nom `Error` appartient
// au client engendré, où il désigne l'enveloppe JSON ; `APIError` désigne l'erreur Go qui la
// transporte, et se lit `gateway.APIError` à l'appel — un appelant écrit `errors.As(err, &apiErr)`.
//
// Message et Fields[].Message sont du texte **écrit par la passerelle**, que nous ne contrôlons pas.
// Rien ne garantit qu'il ne recopie pas le corps d'un message, donc l'invariant (a) le tient hors de
// tout rendu : voir Error(), MarshalJSON() et GoString(). Ils restent des champs parce que l'onglet
// qui affichera l'erreur en a besoin — c'est la sérialisation et le log qui les excluent, pas la
// structure.
//
// Un appelant reconnaît ce qui l'intéresse par `errors.As` puis par Status et Code — le seul code
// constant est CodeUpstreamUnreadable, parce qu'il est le seul que nous frappons. Aucune taxonomie
// (sentinelles, prédicats par famille) n'est écrite ici : aucune route du BFF n'appelle encore la
// passerelle — la première arrive en step-060 — et une taxonomie sans appelant est une liste de
// suppositions qu'aucun test ne peut exercer.
type APIError struct {
	// Status vient de la ligne de statut : le contrat ne le duplique pas dans le corps.
	Status  int
	Code    string
	Message string
	Fields  []FieldError
}

// Les trois méthodes qui suivent sont à **récepteur valeur**, et c'est l'essentiel de la garantie :
// `errors.As` rend un `*APIError`, que déréférencer pour « logger la struct » ne coûte qu'un
// caractère. Sur un récepteur pointeur, la valeur n'implémente ni `error`, ni `json.Marshaler`, ni
// `fmt.GoStringer`, et chaque rendu retombe sur la réflexion : mesuré le 02/08/2026, neuf des seize
// formes de TestErrorRendersNoUpstreamFreeText écrivaient alors le texte amont — dont
// `slog.Error("…", "err", *apiErr)`, qui dumpait `Message` dans le journal JSON.
//
// Chacune ferme un chemin distinct : `Error()` les verbes de fmt et slog en mode texte, qui formate
// par `%+v` ($GOROOT/src/log/slog/text_handler.go:117) ; `MarshalJSON()` un `json.Marshal` de
// l'erreur ; `GoString()` le verbe `%#v`, que fmt résout par le seul GoStringer sans jamais
// consulter `error` ($GOROOT/src/fmt/print.go, handleMethods). slog en mode JSON, lui, est couvert
// deux fois : son handler prend le Marshaler quand il y en a un et `Error()` sinon
// ($GOROOT/src/log/slog/json_handler.go:126-133) — retirer MarshalJSON ne le fait donc pas rougir,
// mesuré.

// Error ne rend que ce que nous contrôlons : le statut, le code stable, et les **noms** des champs
// fautifs. Un nom désigne un champ, jamais sa valeur — le contrat décrit `errors[]` comme le détail
// « per-field » d'une validation — et il oriente le débogage ; le message qui l'accompagne, lui, est
// du texte libre amont et n'entre pas ici.
func (e APIError) Error() string {
	rendered := fmt.Sprintf("réponse d'erreur de l'API Admin : %d %s", e.Status, e.Code)
	if len(e.Fields) == 0 {
		return rendered
	}

	return rendered + " (champs : " + strings.Join(e.fieldNames(), ", ") + ")"
}

// MarshalJSON rend la forme rédigée. `Message` et `Fields[].Message` n'y ont **aucune clé** : c'est
// la même défense que la règle du DTO de sortie déclaré — un champ absent du struct sérialisé ne
// peut pas fuir, et il n'y a rien à se rappeler d'exclure.
func (e APIError) MarshalJSON() ([]byte, error) {
	redacted := struct {
		Status int      `json:"status"`
		Code   string   `json:"code"`
		Fields []string `json:"fields,omitempty"`
	}{Status: e.Status, Code: e.Code, Fields: e.fieldNames()}

	// L'erreur est rendue nue et non enveloppée : trois champs de types plats, donc json.Marshal ne
	// peut pas échouer ici, et habiller une branche inatteignable ferait croire qu'elle arrive.
	return json.Marshal(redacted)
}

func (e APIError) GoString() string {
	return fmt.Sprintf("gateway.APIError{Status:%d, Code:%q, Fields:%#v}",
		e.Status, e.Code, e.redactedFields())
}

// redactedFields rend `errors[]` privé de ses messages. Le verbe `%#v` promet une représentation en
// **syntaxe Go**, et `Fields:["phone"]` n'en était pas une : elle donnait à `Fields` l'air d'un
// `[]string` là où il porte des FieldError, et ne se recompilait pas. Les noms suffisent au
// débogage ; le message qui les accompagne est du texte libre amont, que l'invariant (a) exclut.
func (e APIError) redactedFields() []FieldError {
	if len(e.Fields) == 0 {
		return nil
	}

	redacted := make([]FieldError, 0, len(e.Fields))
	for _, field := range e.Fields {
		redacted = append(redacted, FieldError{Field: field.Field})
	}

	return redacted
}

// As attrape aussi la cible **valeur**. ErrorFrom range un `*APIError` dans la chaîne, donc
// `errors.As` n'y assigne d'office qu'une cible `*APIError` ; une cible `APIError` rendrait `false`
// avec une struct nulle, et un 422 tomberait dans la branche générique de l'appelant — les messages
// ne se placeraient plus sous les champs du formulaire.
//
// Cette cible-là n'est pas une faute qu'on remarque : depuis que les rendus sont à récepteur valeur,
// la valeur implémente `error`, et `go vet` a cessé de refuser l'appel. Elle compile, se lit
// correcte, et se tait. `errors.As` consulte cette méthode juste après avoir essayé l'assignabilité
// ($GOROOT/src/errors/wrap.go:123-129), donc la cible pointeur garde le chemin normal.
func (e APIError) As(target any) bool {
	into, ok := target.(*APIError)
	if !ok {
		return false
	}

	*into = e

	return true
}

// fieldNames rend nil sur une erreur sans `errors[]`, ce qui fait disparaître la clé de la forme JSON
// au lieu d'y laisser une liste vide.
func (e APIError) fieldNames() []string {
	if len(e.Fields) == 0 {
		return nil
	}

	names := make([]string, 0, len(e.Fields))
	for _, field := range e.Fields {
		names = append(names, field.Field)
	}

	return names
}

// ErrorFrom décode le couple (statut, corps) que rend le client engendré, et rien d'autre — DN-7.
// Mesuré sur le code engendré : une opération ne matérialise un champ `JSON4xx` que pour les statuts
// qu'elle **déclare**, et un statut non déclaré ne laisse que `Body` et `HTTPResponse`. S'appuyer
// sur les champs typés demanderait 133 mappings et ne traiterait aucun statut non déclaré. Mesuré
// sur le contrat **2.5.0** le 02/08/2026 : 3 de ses 133 opérations déclarent un 503
// (`erase-customer-content`, `rotate-content-key`, `gdpr-erase` — openapi-admin.yaml:1429, 1442,
// 1455), et le client engendré ne matérialise `JSON503` que pour ces trois-là (client.gen.go:18206,
// 18270, 19152) ; les 130 autres opérations n'ont aucun champ où le ranger. Comme toutes les
// réponses d'erreur du contrat sont des alias du même schéma `Error` — `ServiceUnavailable = Error`,
// client.gen.go:3770 —, un décodeur unique les couvre toutes.
//
// Le succès est le 2xx, et tout le reste est une erreur : un statut inattendu — 3xx non suivi, ou le
// 0 que rend `StatusCode()` quand `HTTPResponse` est nil — tombe ainsi du côté strict plutôt que de
// passer pour une réponse exploitable.
//
// Le type de retour est `error` et non `*APIError` : rendre un pointeur nil dans une interface
// donnerait une erreur non nil sur un succès.
func ErrorFrom(status int, body []byte) error {
	if status >= http.StatusOK && status < http.StatusMultipleChoices {
		return nil
	}

	var envelope Error

	// Un corps qui n'est pas l'enveloppe est un cas mesuré : Prism rend du RFC 7807 sur une route
	// inconnue, un proxy intermédiaire rend du HTML. On le nomme au lieu d'inventer un code ou de
	// laisser `Code` vide, et on ne le recopie pas : ce corps peut contenir n'importe quoi, et le
	// transporter serait exactement la fuite que l'invariant (a) interdit.
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Code == "" {
		return &APIError{Status: status, Code: CodeUpstreamUnreadable}
	}

	return &APIError{
		Status:  status,
		Code:    envelope.Code,
		Message: envelope.Message,
		Fields:  fieldErrors(envelope),
	}
}

// fieldErrors rend nil plutôt qu'une tranche vide : `errors[]` est absent de la plupart des erreurs
// (le contrat ne l'exige pas), et l'absence se distingue ainsi d'une liste vide.
func fieldErrors(envelope Error) []FieldError {
	if envelope.Errors == nil {
		return nil
	}

	fields := make([]FieldError, 0, len(*envelope.Errors))
	for _, detail := range *envelope.Errors {
		fields = append(fields, FieldError{Field: detail.Field, Message: detail.Message})
	}

	return fields
}

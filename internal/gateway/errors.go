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
// 1.2.0 le 02/08/2026 : `code` n'y porte aucun `pattern`, ses exemples sont tous en snake_case
// (`forbidden_scope`, `validation_error`…), et `bff_` n'apparaît nulle part dans le YAML.
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
// tout rendu : voir Error(). Ils restent des champs parce que l'onglet qui affichera l'erreur en a
// besoin — c'est la sérialisation et le log qui les excluent, pas la structure.
//
// Un appelant reconnaît ce qui l'intéresse par `errors.As` puis par Status et Code — le seul code
// constant est CodeUpstreamUnreadable, parce qu'il est le seul que nous frappons. Aucune taxonomie
// (sentinelles, prédicats par famille) n'est écrite ici : aucune route du BFF n'appelle encore la
// passerelle — la première arrive en step-004 — et une taxonomie sans appelant est une liste de
// suppositions qu'aucun test ne peut exercer.
type APIError struct {
	// Status vient de la ligne de statut : le contrat ne le duplique pas dans le corps.
	Status  int
	Code    string
	Message string
	Fields  []FieldError
}

// Error ne rend que ce que nous contrôlons : le statut, le code stable, et les **noms** des champs
// fautifs. Un nom désigne un champ, jamais sa valeur — le contrat décrit `errors[]` comme le détail
// « per-field » d'une validation — et il oriente le débogage ; le message qui l'accompagne, lui, est
// du texte libre amont et n'entre pas ici.
//
// C'est bien ce rendu, et lui seul, qui atteint un log : mesuré le 02/08/2026 sur `%v`, `%s`, `%+v`,
// l'enveloppement par `%w` et `slog.NewJSONHandler` — tous passent par cette méthode
// (TestErrorRendersNoUpstreamFreeText). Deux chemins y échappent et ne sont pas gardés ici : `%#v`
// et un `json.Marshal` de l'erreur elle-même. Le second est couvert par la règle du DTO de sortie
// déclaré — une réponse HTTP est un struct du BFF, jamais cette erreur marshalée.
func (e *APIError) Error() string {
	rendered := fmt.Sprintf("réponse d'erreur de l'API Admin : %d %s", e.Status, e.Code)
	if len(e.Fields) == 0 {
		return rendered
	}

	names := make([]string, 0, len(e.Fields))
	for _, field := range e.Fields {
		names = append(names, field.Field)
	}

	return rendered + " (champs : " + strings.Join(names, ", ") + ")"
}

// ErrorFrom décode le couple (statut, corps) que rend le client engendré, et rien d'autre — DN-7.
// Mesuré sur le code engendré : une opération ne matérialise un champ `JSON4xx` que pour les statuts
// qu'elle **déclare**, et un statut non déclaré ne laisse que `Body` et `HTTPResponse`. S'appuyer
// sur les champs typés demanderait 133 mappings et ne traiterait aucun statut non déclaré — dont le
// 503, que le contrat 1.2.0 ne déclare nulle part. Comme toutes les réponses d'erreur du contrat
// sont des alias du même schéma `Error`, un décodeur unique les couvre toutes.
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

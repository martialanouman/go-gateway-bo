package bff

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/legacy"
)

// validateAgainstTheContract refuse en 400 une requête que le contrat ne décrit pas : `required`,
// bornes, `enum` et `additionalProperties: false`, que le décodage engendré n'applique pas. Une route
// que le contrat ne connaît pas passe, pour que le 404 du produit la refuse.
func validateAgainstTheContract() (func(http.Handler) http.Handler, error) {
	contract, err := GetSwagger()
	if err != nil {
		return nil, fmt.Errorf("contrat embarqué : %w", err)
	}

	router, err := legacy.NewRouter(contract)
	if err != nil {
		return nil, fmt.Errorf("routes du contrat embarqué : %w", err)
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			refusal, refused := refusalOf(router, r)
			if refused {
				writeJSON(w, http.StatusBadRequest, refusal)

				return
			}

			next.ServeHTTP(w, r)
		})
	}, nil
}

func refusalOf(router routers.Router, r *http.Request) (Error, bool) {
	route, pathParams, err := router.FindRoute(r)
	if err != nil {
		return Error{}, false
	}

	err = openapi3filter.ValidateRequest(r.Context(), &openapi3filter.RequestValidationInput{
		Request:    r,
		PathParams: pathParams,
		Route:      route,
		Options:    &openapi3filter.Options{MultiError: true},
	})
	if err == nil {
		return Error{}, false
	}

	fields := refusedFieldsOf(err, "")

	refusal := Error{
		Code:    "bad_request",
		Message: "Cette requête a été refusée : sa forme ne correspond pas à ce que la route attend.",
	}
	if len(fields) > 0 {
		refusal.Errors = &fields
	}

	return refusal, true
}

// refusedFieldsOf aplatit l'arbre d'erreurs de kin-openapi. `field` est le nom du paramètre en cause,
// hérité du `RequestError` qui enveloppe l'erreur de schéma.
func refusedFieldsOf(err error, field string) []FieldError {
	// Un étage à la fois : `errors.As` sauterait du `RequestError` au `MultiError` qu'il enveloppe, et
	// perdrait en route le nom du paramètre.
	switch refused := err.(type) { //nolint:errorlint // voir juste au-dessus.
	case openapi3.MultiError:
		var fields []FieldError
		for _, each := range refused {
			fields = append(fields, refusedFieldsOf(each, field)...)
		}

		return fields
	case *openapi3filter.RequestError:
		if refused.Parameter != nil {
			field = refused.Parameter.Name
		}

		if refused.Err == nil {
			return namedFields([]string{field}, "")
		}

		return refusedFieldsOf(refused.Err, field)
	case *openapi3.SchemaError:
		if refused.Origin != nil {
			return refusedFieldsOf(refused.Origin, field)
		}

		return fieldsOfReason(refused.Reason, field)
	}

	if inner := errors.Unwrap(err); inner != nil {
		return refusedFieldsOf(inner, field)
	}

	return namedFields([]string{field}, "")
}

// ponytail: le contrat étant en 3.1, openapi3filter valide par JSON Schema 2020 (validate_request.go:247
// de kin-openapi v0.149.0), qui ne rend l'emplacement et la règle qu'en texte. Les formes lues ici
// sont figées par validation_test.go : un bump qui les change fait rougir, il ne se tait pas.
var (
	failureAt     = regexp.MustCompile(`^(?:error at "[^"]*": )?at '([^']*)': (.*)$`)
	quotedName    = regexp.MustCompile(`'([^']+)'`)
	missingNames  = regexp.MustCompile(`^missing propert(?:y|ies) (.*)$`)
	unwantedNames = regexp.MustCompile(`^additional propert(?:y|ies) (.*) not allowed$`)
)

func fieldsOfReason(reason, parameter string) []FieldError {
	located := failureAt.FindStringSubmatch(reason)
	if located == nil {
		return namedFields([]string{parameter}, "")
	}

	location, failure := located[1], located[2]

	if names := missingNames.FindStringSubmatch(failure); names != nil {
		return namedFields(locatedFields(location, parameter, quotedNames(names[1])), "required")
	}

	if names := unwantedNames.FindStringSubmatch(failure); names != nil {
		return namedFields(locatedFields(location, parameter, quotedNames(names[1])), "additionalProperties")
	}

	return namedFields(locatedFields(location, parameter, []string{""}), ruleOf(failure))
}

func quotedNames(list string) []string {
	var names []string
	for _, quoted := range quotedName.FindAllStringSubmatch(list, -1) {
		names = append(names, quoted[1])
	}

	return names
}

// locatedFields rend le chemin pointé de chaque nom sous `location`, ou le paramètre à défaut de chemin.
func locatedFields(location, parameter string, names []string) []string {
	base := strings.ReplaceAll(strings.Trim(location, "/"), "/", ".")
	if base == "" {
		base = parameter
	}

	fields := make([]string, 0, len(names))
	for _, name := range names {
		switch {
		case base == "":
			fields = append(fields, name)
		case name == "":
			fields = append(fields, base)
		default:
			fields = append(fields, base+"."+name)
		}
	}

	return fields
}

func ruleOf(failure string) string {
	switch {
	case strings.HasPrefix(failure, "value must be one of"):
		return "enum"
	case strings.HasPrefix(failure, "maxLength:"), strings.HasPrefix(failure, "maximum:"):
		return "maxLength"
	case strings.HasPrefix(failure, "minLength:"), strings.HasPrefix(failure, "minimum:"):
		return "minLength"
	default:
		return ""
	}
}

func namedFields(fields []string, rule string) []FieldError {
	var named []FieldError
	for _, field := range fields {
		if field != "" {
			named = append(named, FieldError{Field: field, Message: ruleMessage(rule)})
		}
	}

	return named
}

func ruleMessage(rule string) string {
	switch rule {
	case "required":
		return "Ce champ est obligatoire."
	case "maxLength":
		return "Cette valeur dépasse la borne permise."
	case "minLength":
		return "Cette valeur est en deçà de la borne permise."
	case "enum":
		return "Cette valeur ne fait pas partie de celles que la route accepte."
	case "additionalProperties":
		return "Ce champ n'est pas attendu ici."
	default:
		return "Cette valeur n'a pas la forme attendue."
	}
}

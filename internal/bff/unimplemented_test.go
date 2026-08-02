package bff_test

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

// embeddedPath parcourt en profondeur les champs **anonymes** de `carrier` et rend le chemin du
// premier dont le type est `forbidden`. La garde est structurelle et non textuelle : chercher un nom
// dans la source ne garde rien, le moindre commentaire le rendant toujours vrai.
//
// `visited` existe pour l'embedding par pointeur, seule forme récursive que le langage autorise
// (`type A struct{ *A }`) — sans lui le parcours boucle.
func embeddedPath(carrier, forbidden reflect.Type, path string, visited map[reflect.Type]bool) (string, bool) {
	for carrier.Kind() == reflect.Pointer {
		carrier = carrier.Elem()
	}

	if carrier.Kind() != reflect.Struct || visited[carrier] {
		return "", false
	}

	visited[carrier] = true

	for i := range carrier.NumField() {
		field := carrier.Field(i)
		if !field.Anonymous {
			continue
		}

		here := path + "." + field.Name
		if field.Type == forbidden {
			return here, true
		}

		if found, ok := embeddedPath(field.Type, forbidden, here, visited); ok {
			return found, true
		}
	}

	return "", false
}

// Le type monté dans `NewRouter` n'embarque pas `Unimplemented`.
//
// Ce que cette garde couvre exactement, mesuré plutôt que supposé. `Unimplemented` n'est émis que par
// le gabarit de l'interface **simple** (`chi-interface.tmpl` d'oapi-codegen v2.8.0) : ses méthodes ont
// la signature `(http.ResponseWriter, *http.Request)`, jamais celle de l'interface stricte. Il ne peut
// donc pas couvrir une opération manquante ici — mesuré sur un contrat à deux opérations, le
// compilateur refuse avec `wrong type for method Ready`. La garantie « un handler manquant ne compile
// pas » tient donc toute seule sur ce seuil.
//
// Ce qui reste, et que cette garde attrape : embarquer `Unimplemented` **compile** aujourd'hui —
// mesuré — parce que le `Health` déclaré au niveau 0 masque celui du niveau 1. L'état est donc
// atteignable, et il est trompeur : il installe dans le type une promesse de repli en 501 que le
// langage n'honorera jamais, et sur laquelle un lecteur pressé comptera le jour où le contrat gagnera
// une opération.
//
// Ce qu'elle ne couvre pas : `HandlerFromMux` prend un `ServerInterface`, que `Unimplemented`
// satisfait exactement — mesuré, `HandlerFromMux(Unimplemented{}, r)` compile et rend 501 sur toutes
// les routes en silence. Cette valeur-là est construite dans `NewRouter` et n'est atteignable par
// aucune réflexion depuis ici.
func TestTheMountedImplementationDoesNotEmbedUnimplemented(t *testing.T) {
	t.Parallel()

	// L'affectation est elle-même une assertion de compilation : c'est ce type, et pas un autre, que
	// `NewRouter` passe à `NewStrictHandler`.
	var mounted bff.StrictServerInterface = bff.API{}

	carrier := reflect.TypeOf(mounted)

	path, embeds := embeddedPath(carrier, reflect.TypeOf(bff.Unimplemented{}), carrier.Name(), map[reflect.Type]bool{})

	assert.Falsef(t, embeds,
		"%s embarque Unimplemented : un repli en 501 que le langage n'honorera jamais sur l'interface stricte", path)
}

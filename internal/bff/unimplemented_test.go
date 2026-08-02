package bff_test

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

// pointee rend le type porté par `carrier`, à travers autant d'indirections qu'il en faut. Les deux
// sites d'appel en ont besoin pour une raison différente, et les deux sont exercés : celui de
// `embeddedPath` pour descendre dans un champ anonyme déclaré par pointeur, celui de la comparaison
// pour reconnaître `*Unimplemented` comme `Unimplemented`.
func pointee(carrier reflect.Type) reflect.Type {
	for carrier.Kind() == reflect.Pointer {
		carrier = carrier.Elem()
	}

	return carrier
}

// embeddedPath parcourt en profondeur les champs **anonymes** de `carrier` et rend le chemin du
// premier dont le type est `forbidden`, par valeur comme par pointeur. La garde est structurelle et
// non textuelle : chercher un nom dans la source ne garde rien, le moindre commentaire le rendant
// toujours vrai.
//
// La comparaison passe par `pointee` parce que le langage promeut les méthodes à récepteur valeur à
// travers un embedding par pointeur : `struct{ *Unimplemented }` installe exactement la même promesse
// que `struct{ Unimplemented }`, et une égalité de types nue ne l'aurait jamais vue.
//
// `visited` existe pour l'embedding par pointeur, seule forme récursive que le langage autorise
// (`type A struct{ *A }`) — sans lui le parcours boucle.
func embeddedPath(carrier, forbidden reflect.Type, path string, visited map[reflect.Type]bool) (string, bool) {
	carrier = pointee(carrier)

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
		if pointee(field.Type) == forbidden {
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
// donc pas couvrir une opération manquante ici — mesuré le 02/08/2026, un
// `type API struct{ bff.Unimplemented }` sans `Health` strict est refusé par le compilateur : « API
// does not implement bff.StrictServerInterface (wrong type for method Health) ». La garantie « un
// handler manquant ne compile pas » tient donc toute seule sur ce seuil.
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
// aucune réflexion depuis ici ; c'est `TestOnlyGeneratedCodeServesTheAPIRoutes` qui garde ce
// montage-là, et son commentaire dit jusqu'où.
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

// Fixtures locales : la garde est structurelle, et les formes qu'elle doit voir sont précisément
// celles que le produit ne porte pas.
type forbiddenCarrier struct{}

// Les trois champs anonymes ci-dessous ne sont jamais lus par le code : c'est leur **présence
// structurelle** que la garde inspecte, par réflexion. L'exemption est posée ligne à ligne plutôt que
// sur le fichier, qui laisserait passer un vrai champ mort ajouté plus tard.
type byValue struct {
	//nolint:unused // lu par réflexion
	forbiddenCarrier
}

type byPointer struct {
	//nolint:unused // lu par réflexion
	*forbiddenCarrier
}

type deepByPointer struct {
	//nolint:unused // lu par réflexion
	*byPointer
}

type unrelated struct{ Name string }

type selfEmbedding struct{ *selfEmbedding }

// Les deux formes d'embedding installent la même promesse, la garde doit voir les deux. Mesuré avant
// le correctif : `type API struct{ *Unimplemented }` compile, et la garde **passait**.
func TestEmbeddedPathFollowsPointerEmbeddings(t *testing.T) {
	t.Parallel()

	for _, carrier := range []struct {
		name   string
		typ    reflect.Type
		embeds bool
	}{
		{"embedding par valeur", reflect.TypeOf(byValue{}), true},
		{"embedding par pointeur", reflect.TypeOf(byPointer{}), true},
		{"profondeur 2 à travers un pointeur", reflect.TypeOf(deepByPointer{}), true},
		{"aucun embedding", reflect.TypeOf(unrelated{}), false},
	} {
		t.Run(carrier.name, func(t *testing.T) {
			t.Parallel()

			_, embeds := embeddedPath(carrier.typ, reflect.TypeOf(forbiddenCarrier{}),
				carrier.typ.Name(), map[reflect.Type]bool{})

			assert.Equal(t, carrier.embeds, embeds)
		})
	}
}

// `type A struct{ *A }` est la seule forme récursive que le langage autorise. Sans la carte des types
// déjà vus, le parcours n'en revient pas — et le débordement de pile emporte le binaire de test
// entier, pas seulement ce test.
func TestEmbeddedPathTerminatesOnASelfEmbeddingType(t *testing.T) {
	t.Parallel()

	carrier := reflect.TypeOf(selfEmbedding{})

	_, embeds := embeddedPath(carrier, reflect.TypeOf(forbiddenCarrier{}), carrier.Name(),
		map[reflect.Type]bool{})

	assert.False(t, embeds)
}

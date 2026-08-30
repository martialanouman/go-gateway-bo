package bff_test

import (
	"go/types"
	"reflect"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// responseObjectSuffix nomme les interfaces qu'engendre oapi-codegen pour chaque opération —
// `HealthResponseObject` aujourd'hui. C'est un nom d'interface, pas un nom de type de réponse : la
// population se déduit ensuite de `types.Implements`, jamais d'une recherche de motif sur les types
// eux-mêmes. Le dépôt a déjà été mordu par un détecteur qui cherchait un nom dans du texte source,
// que le moindre commentaire rendait toujours vrai.
//
// Si oapi-codegen changeait cette convention, la population deviendrait vide — et c'est un échec,
// pas un succès, par l'assertion `require.Positive` ci-dessous.
const responseObjectSuffix = "ResponseObject"

// contractInterfaceName désigne l'interface que le gabarit strict d'oapi-codegen écrit toujours en
// pied de fichier (`strict-interface.tmpl:234`). Sa position **est** la définition de « fichier
// engendré » utilisée partout ici — un renommage du fichier de sortie déplace la porte avec lui, là
// où un `bff.gen.go` codé en dur laisserait la porte pointer sur un fichier disparu.
const contractInterfaceName = "StrictServerInterface"

// modulePath préfixe tout paquet de ce dépôt, et `dtoPackage` est le seul d'entre eux qu'un type de
// réponse ait le droit de porter — celui où les DTO sont déclarés.
//
// La frontière est celle-là et non « le fichier engendré », parce qu'un type de réponse traverse
// légitimement `time.Time` et les types d'`openapi_types` : ce qui est interdit n'est pas d'être
// écrit ailleurs, c'est d'être un **type de domaine de ce dépôt**.
const (
	modulePath = "github.com/martialanouman/go-gateway-bo/"
	dtoPackage = modulePath + "internal/bff"
)

// rawJSONType nomme la seule forme de la bibliothèque standard conçue pour émettre du JSON
// **arbitraire**. Elle est bornée par son type et ne l'est pas par son contenu : une règle de forme y
// verrait un `[]byte` parfaitement déclaré, et ce serait la porte qui aurait tort.
const rawJSONType = "encoding/json.RawMessage"

// streamedBodies nomme les interfaces qu'un type de réponse a le droit de porter.
//
// C'est une **liste** et non « toute interface d'au moins une méthode », et la revue du 30/08/2026 dit
// pourquoi : `error` a une méthode, et `encoding/json` sérialise les champs exportés de sa valeur
// **dynamique** — un `*pgconn.PgError` y mettrait la requête et le nom de la contrainte. La règle
// large laissait donc entrer exactement ce que cette porte existe pour interdire.
//
// `io.Reader` reste admis parce que c'est la forme qu'oapi-codegen donne au corps d'une réponse
// binaire (`strict-interface.tmpl:63`) : un flux, pas une surface de sérialisation. L'interdire
// fermerait la porte à l'export que le contrat déclarera, et une garde qui refuse du légitime finit
// retirée.
var streamedBodies = map[string]bool{
	"io.Reader":     true,
	"io.ReadCloser": true,
}

// forbiddenFields nomme les colonnes qui ne doivent traverser aucune réponse, par leur écriture
// normalisée. La valeur est la colonne d'origine, pour que le message d'échec dise où regarder.
//
// **C'est une liste courte de colonnes nommées, pas une heuristique**, et ce choix est mesuré. Le
// contrat déclare aujourd'hui un champ `secret` et un champ `recoveryCodes` : ce sont les affichages
// **uniques** qu'exige l'invariant (b) — montrés une fois à la création, jamais réaffichés. Une porte
// qui refuserait « tout champ dont le nom contient secret » refuserait le comportement correct du
// produit, et une garde qui refuse du légitime finit retirée.
//
// Elle vieillit mal par construction : elle ne connaît que les secrets d'aujourd'hui. C'est la règle
// de forme qui attrape ceux de demain, en refusant le **type** qui les porte plutôt que leur nom.
var forbiddenFields = map[string]string{
	"passwordhash":  "operators.password_hash",
	"mfatotpsecret": "operators.mfa_totp_secret",
	"sealedsecret":  "operators.mfa_totp_secret, tel que le store le nomme",
	"tokenhash":     "sessions.token_hash / mfa_challenges.token_hash",
	"codehash":      "mfa_recovery_codes.code_hash",
	"ceremony":      "webauthn_challenges.ceremony",
}

// loadBFF recharge le paquet par le type-checker. C'est ce qui permet d'énumérer *tous* les types de
// réponse, y compris ceux qu'une step future ajoutera sans toucher à ce fichier — là où la réflexion
// ne verrait que les types qu'un test nomme déjà.
//
// **Il ne voit que `internal/bff`, et ce n'est pas la porte entière** : un type de réponse déclaré
// dans un autre paquet du module lui échappe, ce qui a été mesuré le 30/08/2026. C'est
// `TestAucuneMethodeDeSerialisationNEstEcriteAilleurs` qui couvre le module, en chargeant `./...`.
func loadBFF(t *testing.T) *packages.Package {
	t.Helper()

	loaded, err := packages.Load(&packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedImports | packages.NeedDeps |
			packages.NeedSyntax | packages.NeedTypesInfo,
	}, ".")
	require.NoError(t, err)
	require.Len(t, loaded, 1)
	require.Empty(t, loaded[0].Errors, "le paquet ne type-checke pas, l'analyse ne prouverait rien")

	return loaded[0]
}

// responseInterfaces rend les interfaces `…ResponseObject` déclarées par le code engendré.
func responseInterfaces(scope *types.Scope) []*types.Interface {
	var found []*types.Interface

	for _, name := range scope.Names() {
		if !strings.HasSuffix(name, responseObjectSuffix) {
			continue
		}

		declared, ok := scope.Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}

		if iface, ok := declared.Type().Underlying().(*types.Interface); ok {
			found = append(found, iface)
		}
	}

	return found
}

// implementsAny teste la valeur **et** le pointeur : un type dont les méthodes ont un récepteur
// pointeur n'implémente l'interface que sous cette forme, et l'omettre laisserait échapper des
// types de réponse de la population.
func implementsAny(candidate types.Type, ifaces []*types.Interface) bool {
	for _, iface := range ifaces {
		if types.Implements(candidate, iface) || types.Implements(types.NewPointer(candidate), iface) {
			return true
		}
	}

	return false
}

// forbidden nomme la première chose qu'un type de réponse ne doit pas porter, et rend "" quand il n'en
// porte aucune. C'est **un seul parcours** et non deux, et la raison est une divergence constatée.
//
// Ce fichier a d'abord porté deux marcheurs jumeaux — l'un pour la forme, l'autre pour le domaine —
// présentés comme suivant « la même règle de descente ». La revue du 30/08/2026 a montré qu'ils
// avaient **déjà divergé** en une seule rédaction : l'un traitait une map comme fatale et l'autre y
// descendait, l'un connaissait les interfaces et l'autre les ignorait en silence. C'est le mode
// d'échec que le reste du dépôt se donne du mal à éviter, reproduit dans la porte qui l'interdit.
//
// Les formes refusées, et la frontière de chacune :
//
//   - une **map**, quel que soit son type de valeur : ses clés ne sont pas déclarées, donc rien ne
//     borne ce qu'un handler y écrit. C'est la forme qu'oapi-codegen émet pour `additionalProperties`
//     — mesuré, 23 champs de ce genre dans `internal/gateway/client.gen.go`, dont
//     `Filters map[string]interface{}`. Le jour où un schéma du contrat **du BFF** en porte un, cette
//     porte rougit et le YAML se relit.
//   - une **interface** hors de `streamedBodies`, l'interface vide comprise.
//   - `json.RawMessage`, dont c'est la fonction même d'émettre du JSON arbitraire.
//   - un **type de domaine du module**, à quelque profondeur.
//   - une **méthode écrite à la main** sur un type du paquet atteint, à quelque profondeur.
//   - un **champ** dont le nom Go ou le tag JSON désigne une colonne interdite.
//
// Le parcours ne descend que dans ce qui se sérialise : champs exportés et champs anonymes, dont les
// champs exportés se promeuvent.
func forbidden(
	pkg *packages.Package, carrier types.Type, generated, path string, visited map[types.Type]bool,
) string {
	if visited[carrier] {
		return ""
	}
	visited[carrier] = true

	if named, ok := types.Unalias(carrier).(*types.Named); ok {
		if found := forbiddenNamed(pkg, named, generated, path); found != "" {
			return found
		}

		if streamedBodies[named.String()] {
			return ""
		}
	}

	switch shape := carrier.(type) {
	case *types.Map:
		return path + " est une " + shape.String()
	case *types.Interface:
		return path + " est une interface : elle sérialise sa valeur dynamique, que rien ne déclare"
	case *types.Struct:
		return forbiddenField(pkg, shape, generated, path, visited)
	case *types.Pointer:
		return forbidden(pkg, shape.Elem(), generated, path, visited)
	case *types.Slice:
		return forbidden(pkg, shape.Elem(), generated, path+"[]", visited)
	case *types.Array:
		return forbidden(pkg, shape.Elem(), generated, path+"[]", visited)
	case *types.Named, *types.Alias:
		return forbidden(pkg, carrier.Underlying(), generated, path, visited)
	default:
		return ""
	}
}

// forbiddenNamed juge un type **nommé** atteint : d'où il vient, et qui a écrit ses méthodes.
//
// Il est consulté avant que le `switch` ne déballe le sous-jacent, sans quoi `streamedBodies` ne
// verrait jamais `io.Reader` mais l'interface anonyme qui lui sert de sous-jacent.
func forbiddenNamed(pkg *packages.Package, named *types.Named, generated, path string) string {
	if streamedBodies[named.String()] {
		return ""
	}

	if named.String() == rawJSONType {
		return path + " est un " + rawJSONType + " : son contenu n'est déclaré nulle part"
	}

	origin := named.Obj().Pkg()
	if origin == nil || !strings.HasPrefix(origin.Path(), modulePath) {
		return ""
	}

	if origin.Path() != dtoPackage {
		return path + " est un " + origin.Path() + "." + named.Obj().Name() +
			", un type de domaine de ce dépôt"
	}

	if method := handWrittenMethod(pkg, named, generated); method != "" {
		return path + " (" + named.Obj().Name() + ") porte une méthode écrite à la main : " + method
	}

	return ""
}

// handWrittenMethod nomme la première méthode de `named` déclarée hors du fichier engendré.
//
// **La provenance du type ne suffit pas, et c'est mesuré.** Un `MarshalJSON` écrit à la main sur un
// type engendré compile — le fichier engendré ne déclare pas cette méthode, donc ce n'est pas une
// redéclaration — et le `Visit…` l'appelle, puisqu'il fait `json.NewEncoder(&buf).Encode(response)`.
// Sondé le 30/08/2026 sur `Health200JSONResponse` puis sur `Error` : les autres règles restaient
// **vertes**, et ce qui rougissait était un test de corps exact, donc par route et non par propriété.
//
// `Error` est le cas qui a imposé de descendre : il n'implémente aucune interface `…ResponseObject`,
// donc il n'entre dans aucune population — mais il est le corps des cinq réponses 429 et des huit
// refus de `writeJSON`. C'est pourquoi cette règle s'applique à **tout type du paquet atteint** et non
// au seul type racine.
//
// Elle nomme « toute méthode » et non « `MarshalJSON` » : une liste laisserait `MarshalText`,
// `AppendText` et celles que la bibliothèque standard ajoutera. Les méthodes promues d'un type
// embarqué engendré sont déclarées dans le même fichier, donc elles passent.
//
// Le jeu de méthodes est pris sur le **pointeur**, qui est le sur-ensemble : il porte les méthodes à
// récepteur valeur comme celles à récepteur pointeur.
func handWrittenMethod(pkg *packages.Package, named *types.Named, generated string) string {
	methods := types.NewMethodSet(types.NewPointer(named))

	for index := range methods.Len() {
		declared := methods.At(index).Obj()

		if where := pkg.Fset.Position(declared.Pos()).Filename; where != generated {
			return declared.Name() + ", déclarée dans " + where
		}
	}

	return ""
}

func forbiddenField(
	pkg *packages.Package, carrier *types.Struct, generated, path string, visited map[types.Type]bool,
) string {
	for index := range carrier.NumFields() {
		field := carrier.Field(index)
		if !field.Exported() && !field.Embedded() {
			continue
		}

		for _, name := range serializedNames(field, carrier.Tag(index)) {
			if column, banned := forbiddenFields[name]; banned {
				return path + "." + field.Name() + " porte " + column
			}
		}

		if found := forbidden(pkg, field.Type(), generated, path+"."+field.Name(), visited); found != "" {
			return found
		}
	}

	return ""
}

// serializedNames rend les écritures normalisées sous lesquelles un champ peut apparaître : son nom
// Go, et le nom que son tag `json` lui donne sur le fil.
//
// **Les deux, et pas seulement le tag** : c'est le nom Go qu'un relecteur voit, et c'est le tag qui
// part sur le fil. Un champ `PasswordHash` étiqueté `json:"id"` fuirait sous le second contrôle seul,
// et un champ `Identifiant` étiqueté `json:"password_hash"` sous le premier.
//
// Un tag qui ne nomme rien — absent, `json:"-"`, ou `json:",omitempty"` — n'ajoute aucun nom. La
// première rédaction y laissait entrer la chaîne vide, qu'aucune clé ne porte : sans conséquence
// alors, mais une entrée accidentellement vide y aurait fait rougir tout champ non sérialisé.
func serializedNames(field *types.Var, tag string) []string {
	names := []string{normalize(field.Name())}

	wire := strings.Split(reflect.StructTag(tag).Get("json"), ",")[0]
	if wire != "" && wire != "-" {
		names = append(names, normalize(wire))
	}

	return names
}

// normalize rapproche les deux vocabulaires : `password_hash` de la colonne et `PasswordHash` du Go
// désignent la même chose, et une porte qui n'en connaîtrait qu'un serait muette sur l'autre.
func normalize(name string) string {
	return strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(name))
}

// declarationFile rend le fichier où `carrier` est déclaré, et "" pour un type qui n'en a pas — un
// struct anonyme, un `[]byte`. Un fichier vide n'est jamais celui du code engendré : la comparaison
// qui s'en sert échoue alors du bon côté.
//
// Le pointeur est déballé d'abord : `struct{ *ErrorJSONResponse }` est un embarquement parfaitement
// légitime qu'oapi-codegen pourrait émettre, et sans ce déballage il serait refusé par un faux positif
// silencieux.
func declarationFile(pkg *packages.Package, carrier types.Type) string {
	if pointer, ok := types.Unalias(carrier).(*types.Pointer); ok {
		carrier = pointer.Elem()
	}

	named, ok := types.Unalias(carrier).(*types.Named)
	if !ok {
		return ""
	}

	return pkg.Fset.Position(named.Obj().Pos()).Filename
}

// Un type de réponse ne porte que des formes déclarées, et n'embarque que ce que le contrat engendre.
//
// La **forme** d'abord : ni map, ni interface non listée, ni `json.RawMessage`, à n'importe quelle
// profondeur — c'est l'invariant (a) tenu par le compilateur plutôt que par la discipline. Rien
// n'oblige en revanche le type lui-même à être un struct : oapi-codegen rend `type XxxResponse []Foo`
// pour une réponse tableau et `type XxxTextResponse string` pour du `text/plain`
// (`strict-interface.tmpl:50`), deux formes parfaitement bornées qu'une exigence de struct refuserait.
//
// L'**embarquement** ensuite, et la règle y est plus fine pour une raison mesurée : dès qu'une
// réponse est un `$ref` vers `components/responses/*`, le gabarit rend
// `type Xxx400JSONResponse struct{ ErrorJSONResponse }` (`strict-interface.tmpl:47`) — la forme
// normale d'un DTO d'erreur factorisé, que refuser obligerait à dé-factoriser le contrat.
//
// La **provenance** enfin (step-026), et c'est ce qui ferme le trou que `api.go` nommait depuis
// step-004 : un type de réponse écrit à la main compile et son `Visit…` sérialise ce qu'il veut. La
// règle est une **localisation** — le type vient du fichier engendré — et non une inspection du corps
// de la méthode, ce qui est mesuré : cinq `…429JSONResponse` engendrés encodent `response.Body` et non
// `response`, et trois `…204Response` n'encodent rien.
//
// **Ce test ne voit que `internal/bff`.** Le module entier est couvert par
// `TestAucuneMethodeDeSerialisationNEstEcriteAilleurs`, et les deux ensemble sont la porte : la
// première rédaction n'avait que celui-ci, et se laissait contourner par un type déclaré ailleurs.
//
// La population n'est pas « les types dont le nom contient Response » mais « les types qui
// implémentent une interface engendrée ». Le témoin anti-vide de toutes ces règles est le **même** —
// `require.Positive` en pied de boucle : une population vide les rendrait toutes vertes en n'ayant
// rien cherché, ce qui a été vérifié plutôt que supposé (fiche step-026, mutation M2).
func TestResponseTypesDeclareTheirFields(t *testing.T) {
	t.Parallel()

	pkg := loadBFF(t)
	scope := pkg.Types.Scope()

	ifaces := responseInterfaces(scope)
	require.NotEmpty(t, ifaces, "aucune interface %q : l'analyseur est cassé, pas vert", responseObjectSuffix)

	generated := generatedFile(t, pkg)
	population := 0

	for _, name := range scope.Names() {
		declared, ok := scope.Lookup(name).(*types.TypeName)
		if !ok || !implementsAny(declared.Type(), ifaces) {
			continue
		}

		// Une interface `…ResponseObject` s'implémente elle-même. Elle déclare la population, elle
		// n'en fait pas partie — c'est le type concret qu'un handler rend qui doit porter des champs.
		if _, isInterface := declared.Type().Underlying().(*types.Interface); isInterface {
			continue
		}

		population++

		assert.Equalf(t, generated, declarationFile(pkg, declared.Type()),
			"%s implémente une interface %q sans venir du contrat : son `Visit…` est écrit à la main, "+
				"donc il sérialise ce qu'il veut sur le fil", name, responseObjectSuffix)

		assert.Emptyf(t, forbidden(pkg, declared.Type(), generated, name, map[types.Type]bool{}),
			"%s est un type de réponse : ce qu'il porte doit être déclaré, sans quoi l'invariant (a) "+
				"redevient une discipline", name)

		assertEmbedsOnlyGeneratedTypes(t, pkg, name, declared.Type(), generated)
	}

	require.Positivef(t, population,
		"aucun type n'implémente une interface %q : l'analyseur est cassé, pas vert", responseObjectSuffix)
}

func assertEmbedsOnlyGeneratedTypes(
	t *testing.T, pkg *packages.Package, name string, carrier types.Type, generated string,
) {
	t.Helper()

	structured, ok := carrier.Underlying().(*types.Struct)
	if !ok {
		return
	}

	for field := range structured.Fields() {
		if !field.Embedded() {
			continue
		}

		assert.Equalf(t, generated, declarationFile(pkg, field.Type()),
			"%s embarque %s, que le contrat n'engendre pas : les champs ajoutés à ce type-là fuiraient "+
				"sans relecture", name, field.Name())
	}
}

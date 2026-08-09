package bff_test

import (
	"go/ast"
	"go/types"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

const (
	// La coquille porte les références aux noms hachés : c'est elle qui interdit de la mettre en
	// cache, et c'est son doctype qu'on cherche là où du HTML n'a rien à faire.
	indexHTML = `<!doctype html><html lang="fr"><body>` +
		`<script src="/assets/app-abc123.js"></script></body></html>`
	appJS = "console.log('spa')"
	// Vite recopie `web/public/` à la racine du site sans hacher les noms, et **récursivement** :
	// step-008 y versera `fonts/`, d'où le fichier imbriqué ci-dessous.
	faviconSVG = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
	// `wOF2` est la signature d'un WOFF2 : le `Content-Type` de ce fichier vaut `font/woff2` que
	// la table MIME du système connaisse l'extension ou non — sinon `DetectContentType` la retrouve
	// (`net/http/sniff.go:178`). Sans ces quatre octets, l'assertion dépendrait de la machine.
	interWOFF2 = "wOF2\x00\x01\x00\x00fausse police"
)

// testAssets reproduit la racine du site telle que Vite la produit : la coquille et les fichiers
// publics recopiés depuis `web/public/`, à la racine comme en sous-répertoire, tout ce qui est haché
// sous `assets/`.
func testAssets() fs.FS {
	return fstest.MapFS{
		"index.html":                    {Data: []byte(indexHTML)},
		"favicon.svg":                   {Data: []byte(faviconSVG)},
		"fonts/inter.woff2":             {Data: []byte(interWOFF2)},
		"assets/app-abc123.js":          {Data: []byte(appJS)},
		"assets/vendor/chunk-def456.js": {Data: []byte("console.log('vendor')")},
	}
}

// call rend la réponse composée, et non l'enregistreur : `rec.Header()` est la map vivante que le
// handler a modifiée, où un en-tête posé après `WriteHeader` — qui n'atteindra jamais personne —
// apparaît quand même.
func call(t *testing.T, method, target string) *http.Response {
	t.Helper()

	rec := httptest.NewRecorder()
	bff.NewRouter(bff.Dependencies{Assets: testAssets()}).ServeHTTP(rec, httptest.NewRequest(method, target, nil))

	return rec.Result()
}

func bodyOf(t *testing.T, resp *http.Response) string {
	t.Helper()

	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	return string(payload)
}

func TestHealthProbe(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/api/health")
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	assert.JSONEq(t, `{"status":"ok"}`, bodyOf(t, resp))
}

// Un `/api/*` inconnu rend 404 et jamais du HTML. Ce qui le garantit est le **montage** : le repli
// est une route `/*`, et chi fait gagner le segment statique `/api` sur elle — retirer le
// `api.NotFound` ci-dessous rend d'ailleurs 404 `text/plain`, pas la coquille. Ce que le `NotFound`
// explicite porte, c'est la **forme** de l'erreur, plus un filet le jour où le repli repasserait en
// `r.NotFound()` : cette variante-là, mesurée, rend bien 200 + `<!doctype html`.
func TestUnknownAPIRouteIsNotFound(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/api/inconnu")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)

	payload := bodyOf(t, resp)
	assert.NotContains(t, payload, "<!doctype html")
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	assert.JSONEq(t, `{"code":"not_found","message":"Cette route n'existe pas sur ce serveur."}`, payload)
}

// `/ws` est déclarée avant d'exister (step-043) : sans elle, la requête tomberait dans le repli et
// un client WebSocket recevrait 200 + du HTML au lieu d'un refus lisible.
func TestWebSocketEndpointIsNotImplementedYet(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodGet, "/ws")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotImplemented, resp.StatusCode)
	assert.NotContains(t, bodyOf(t, resp), "<!doctype html")
}

func TestHealthProbeRefusesOtherMethods(t *testing.T) {
	t.Parallel()

	resp := call(t, http.MethodPost, "/api/health")
	defer resp.Body.Close()

	assert.Equal(t, http.StatusMethodNotAllowed, resp.StatusCode)
}

// apiPrefix est le préfixe sous lequel `NewRouter` monte les routes du contrat. Il vient du
// `r.Route("/api")` du produit, et non de `servers.url` : porter les deux rendrait `/api/api/health`,
// que `TestHealthProbe` attrape en 404.
const apiPrefix = "/api"

// rootSymbol extrait de `github.com/…/bff.(*ServerInterfaceWrapper).Health-fm` le nom que porte la
// portée du paquet — ici `ServerInterfaceWrapper` — et rend "" pour un symbole d'un autre paquet. Les
// suffixes qu'ajoute le compilateur (`-fm` pour une valeur de méthode, `.funcN` pour une closure)
// désignent du code écrit **dans** le symbole racine : c'est le fichier de celui-ci qui fait foi.
func rootSymbol(qualified, pkgName string) string {
	qualified = qualified[strings.LastIndex(qualified, "/")+1:]

	member, found := strings.CutPrefix(qualified, pkgName+".")
	if !found {
		return ""
	}

	if strings.HasPrefix(member, "(") {
		receiver, _, _ := strings.Cut(member, ")")

		return strings.TrimPrefix(strings.TrimPrefix(receiver, "("), "*")
	}

	root, _, _ := strings.Cut(member, ".")

	return root
}

// declaringFile rend le fichier qui déclare le code dont `handler` est issu. `runtime` ne sait pas le
// dire seul : mesuré, une valeur de méthode rend `<autogenerated>:1` — c'est exactement ce que
// `(*ServerInterfaceWrapper).Health-fm` rend. C'est donc son **nom** qui est résolu, dans la portée du
// paquet, par le type-checker.
func declaringFile(t *testing.T, pkg *packages.Package, handler http.Handler) string {
	t.Helper()

	value := reflect.ValueOf(handler)
	require.Equal(t, reflect.Func, value.Kind(), "le handler monté n'est pas une fonction : %T", handler)

	symbol := runtime.FuncForPC(value.Pointer()).Name()

	declared := pkg.Types.Scope().Lookup(rootSymbol(symbol, pkg.Types.Name()))
	if declared == nil {
		return symbol
	}

	return pkg.Fset.Position(declared.Pos()).Filename
}

// Sous `/api`, tout est servi par le code que le contrat engendre — chemin, méthode et type de réponse
// viennent du YAML, aucun n'est réécrit à la main.
//
// Ce que cette porte attrape, mesuré : un `api.Get("/health", …)` écrit à la main, avec ou sans le
// code engendré à côté, laissait les cinq portes de la step vertes et `golangci-lint` à 0 issue. Elle
// attrape de même une route sous `/api` que le contrat ne déclare pas, et un handler emprunté à un
// autre paquet.
//
// Ce qu'elle ne couvre pas, et il faut le dire parce qu'aucune autre porte ne le couvre non plus :
// une implémentation de l'interface **simple** engendrée, dont les méthodes prennent un
// `http.ResponseWriter` nu. Le montage installe `(*ServerInterfaceWrapper).Health` quelle que soit
// l'implémentation qu'il enveloppe ; le choix vit dans un champ non exporté d'une closure, qu'aucune
// réflexion n'atteint. Mesuré le 02/08/2026, `HandlerWithOptions(Unimplemented{}, …)` substitué à
// `mountContract(api, API{})` : cette porte reste verte, et les trois autres portes structurelles du
// paquet aussi ; ce qui tombe est `TestHealthProbe` et les scénarios godog de `cmd/dashboard`. Ce qui
// reste vrai est plus étroit que « le compilateur refuse d'y monter autre chose » :
// `NewStrictHandlerWithOptions` n'accepte qu'un `StrictServerInterface`, mais rien n'exige qu'il soit
// **appelé**.
//
// `chi.Walk` ne rapporte pas le `NotFound` d'un sous-routeur — mesuré, les routes rapportées sont exactement
// `/api/health`, `/assets/*`, `/ws` et `/*`. `handleUnknownAPIRoute` n'a donc pas à être exempté ici.
func TestOnlyGeneratedCodeServesTheAPIRoutes(t *testing.T) {
	t.Parallel()

	pkg := loadBFF(t)

	contract := pkg.Types.Scope().Lookup(contractInterfaceName)
	require.NotNil(t, contract, "%s introuvable : « code engendré » n'a plus de définition", contractInterfaceName)
	generated := pkg.Fset.Position(contract.Pos()).Filename

	routes, isRouter := bff.NewRouter(bff.Dependencies{Assets: testAssets()}).(chi.Routes)
	require.True(t, isRouter, "le routeur ne s'énumère plus : la porte ne prouverait plus rien")

	mounted := 0

	require.NoError(t, chi.Walk(routes,
		func(method, route string, handler http.Handler, _ ...func(http.Handler) http.Handler) error {
			if !strings.HasPrefix(route, apiPrefix+"/") {
				return nil
			}

			mounted++
			assert.Equalf(t, generated, declaringFile(t, pkg, handler),
				"%s %s n'est pas servie par le code du contrat : son chemin, sa méthode et son type de "+
					"réponse ne viennent plus du YAML", method, route)

			return nil
		}))

	require.Positivef(t, mounted, "aucune route sous %s : la porte est inerte, pas verte", apiPrefix)
}

// Les quatre points d'entrée de montage qu'écrit le gabarit chi d'oapi-codegen v2.8.0 — mesuré, ce
// sont les seules fonctions du fichier engendré dont le nom commence par `Handler`. Trois d'entre
// elles (`Handler`, `HandlerFromMux`, `HandlerFromMuxWithBaseURL`) délèguent à la quatrième **sans**
// `ErrorHandlerFunc` : `HandlerWithOptions` installe alors son défaut,
// `http.Error(w, err.Error(), 400)`. La porte ci-dessous n'énumère pas ces trois noms, elle les déduit
// du préfixe : le jour où le générateur en ajoute un cinquième, il est couvert sans qu'on y pense.
const (
	mountEntrypointPrefix = "Handler"
	optionsMountFunc      = "HandlerWithOptions"
	errorHandlerOption    = "ErrorHandlerFunc"
)

// generatedFile rend le fichier qu'oapi-codegen écrit, repéré par la position de l'interface stricte
// — même définition que celle des deux autres portes de ce paquet.
func generatedFile(t *testing.T, pkg *packages.Package) string {
	t.Helper()

	contract := pkg.Types.Scope().Lookup(contractInterfaceName)
	require.NotNil(t, contract, "%s introuvable : « fichier engendré » n'a plus de définition", contractInterfaceName)

	return pkg.Fset.Position(contract.Pos()).Filename
}

// setsOption dit si un des arguments de `call` est un littéral composite qui pose la clé `option`.
// Il ne suit pas une variable intermédiaire — un `opts := ChiServerOptions{…}` posé plus haut le
// ferait rougir alors que le code serait correct. C'est assumé : la forme que la porte exige est le
// littéral au site d'appel, où le lecteur voit le gestionnaire d'erreur en même temps que le montage.
func setsOption(call *ast.CallExpr, option string) bool {
	for _, arg := range call.Args {
		literal, isLiteral := arg.(*ast.CompositeLit)
		if !isLiteral {
			continue
		}

		for _, element := range literal.Elts {
			field, isField := element.(*ast.KeyValueExpr)
			if !isField {
				continue
			}

			if key, isIdent := field.Key.(*ast.Ident); isIdent && key.Name == option {
				return true
			}
		}
	}

	return false
}

// Le montage des routes du contrat installe le gestionnaire d'erreur du produit.
//
// Ce qu'il couvre, et pourquoi une porte structurelle plutôt qu'une requête. Le gestionnaire visé est
// celui du **wrapper** engendré (`bff.gen.go`, `ServerInterfaceWrapper.ErrorHandlerFunc`) : c'est lui
// qui reçoit les erreurs de liaison des paramètres de requête, de chemin, des en-têtes et des cookies
// (`chi-middleware.tmpl`, 14 sites d'appel). `GET /health` n'a aucun des quatre, donc **aucune requête
// que le contrat autorise ne peut l'atteindre aujourd'hui** — c'est ce qui rend le défaut invisible et
// c'est pourquoi la preuve est ici structurelle.
//
// Mesuré le 02/08/2026, contrat muté avec un `depuis` requis de type entier, régénéré, requête réelle
// à travers `NewRouter` : avec `HandlerFromMux`, `GET /api/health` rend
// `400 text/plain; charset=utf-8` et le corps `Query argument depuis is required, but not found` ;
// avec `HandlerWithOptions` et `ErrorHandlerFunc: rejectRequest`, la même requête rend
// `400 application/json` et le DTO d'erreur du produit. Le contrat a ensuite été restauré et
// régénéré.
func TestTheContractMountInstallsTheProductErrorHandler(t *testing.T) {
	t.Parallel()

	pkg := loadBFF(t)
	generated := generatedFile(t, pkg)

	mounts := 0

	for _, file := range pkg.Syntax {
		if pkg.Fset.Position(file.Pos()).Filename == generated {
			continue
		}

		ast.Inspect(file, func(node ast.Node) bool {
			call, isCall := node.(*ast.CallExpr)
			if !isCall {
				return true
			}

			called, isIdent := call.Fun.(*ast.Ident)
			if !isIdent {
				return true
			}

			mount, isFunc := pkg.TypesInfo.Uses[called].(*types.Func)
			if !isFunc || pkg.Fset.Position(mount.Pos()).Filename != generated ||
				!strings.HasPrefix(mount.Name(), mountEntrypointPrefix) {
				return true
			}

			mounts++
			at := pkg.Fset.Position(call.Pos())

			if !assert.Equalf(t, optionsMountFunc, mount.Name(),
				"%s: %s laisse le défaut d'oapi-codegen répondre en text/plain avec le message Go brut",
				at, mount.Name()) {
				return true
			}

			assert.Truef(t, setsOption(call, errorHandlerOption),
				"%s: %s sans %s laisse le défaut d'oapi-codegen répondre en text/plain avec le message "+
					"Go brut", at, mount.Name(), errorHandlerOption)

			return true
		})
	}

	require.Positive(t, mounts, "aucun montage du contrat : la porte est inerte, pas verte")
}

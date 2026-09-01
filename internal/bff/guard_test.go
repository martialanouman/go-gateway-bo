package bff

import (
	"context"
	"encoding/json"
	"errors"
	"go/ast"
	"go/types"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ces tests traversent le **wrapper engendré réel** — `NewStrictHandlerWithOptions` puis la méthode
// `ServerInterface` de l'opération — et non une invocation directe du middleware. C'est ce qui fait
// dire quelque chose au refus : ce qu'on observe est ce que `net/http` a servi, pas ce que la
// fonction a rendu. La distinction n'est pas théorique — rendre `(nil, nil)` sans écrire produit un
// **200 vide**, et seule une traversée complète le montre.
//
// La table est injectée. En production elle n'exige aucune clé (voir `authorization`), donc aucune
// des branches qui comptent ne serait atteinte avant step-029 : le mécanisme serait livré sans qu'une
// seule mutation le fasse rougir. La couture a son propre risque — vérifier ce que la production ne
// câble pas — et c'est `TestLaGardeEstCablee` qui le ferme.
const guardedOperation = "Logout"

// guardedTable exige une clé sur l'opération que ces tests exercent. `permissions.RolesManage` est
// une clé réelle du catalogue : une clé inventée ferait passer ces tests pour la mauvaise raison,
// la comparaison étant une simple appartenance.
func guardedTable() map[string]rule {
	return map[string]rule{guardedOperation: requires(permissions.RolesManage)}
}

// passingAPI réussit sur l'opération que ces tests exercent, et échoue partout ailleurs comme sa
// sœur. Le 204 qu'elle rend est le témoin : c'est le seul statut que la garde ne produit jamais, donc
// le seul qui dise « l'appel est allé jusqu'au handler ». Un handler qui échouerait rendrait 500 —
// le même statut qu'une panne de lecture des permissions, et les deux cas seraient confondus.
type passingAPI struct{ failingAPI }

func (passingAPI) Logout(_ context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	return Logout204Response{}, nil
}

// served est ce que le client a reçu : le statut, et le corps d'erreur quand il y en a un. Le corps
// est relu ici plutôt que rendu ouvert — un `*http.Response` que chaque test devrait refermer est le
// genre de discipline qu'on oublie une fois sur dix.
type served struct {
	status int
	body   errorResponse
}

// servedByGuard monte la garde autour du wrapper engendré et rend ce que le client a reçu.
func servedByGuard(t *testing.T, rules map[string]rule, grants grantsOf,
	ctx context.Context, //nolint:revive // Le contexte porte la session résolue, il n'ordonne rien.
) served {
	t.Helper()

	handler := NewStrictHandlerWithOptions(passingAPI{},
		[]StrictMiddlewareFunc{requirePermission(rules, grants)},
		StrictHTTPServerOptions{
			RequestErrorHandlerFunc:  rejectRequest,
			ResponseErrorHandlerFunc: reportFailedResponse,
		})

	rec := httptest.NewRecorder()
	handler.Logout(rec, httptest.NewRequest(http.MethodPost, "/auth/logout", nil).WithContext(ctx))

	response := rec.Result()

	defer func() { _ = response.Body.Close() }()

	payload, err := io.ReadAll(response.Body)
	require.NoError(t, err)

	outcome := served{status: response.StatusCode}
	if len(payload) > 0 {
		require.NoError(t, json.Unmarshal(payload, &outcome.body),
			"la réponse n'est pas le DTO d'erreur du produit : %s", payload)
	}

	return outcome
}

// withResolvedSession pose la session que `withSession` poserait. Les clés du contexte sont privées
// au paquet, donc ce test vit dans `package bff` : rien hors d'ici ne peut se choisir une identité,
// et c'est la propriété qu'on ne veut pas relâcher pour un test.
func withResolvedSession(elevated, alive bool) context.Context {
	return context.WithValue(context.Background(), sessionKey{}, resolution{
		session: store.Session{ID: "session-de-test", OperatorID: "operateur-de-test", Elevated: elevated},
		alive:   alive,
	})
}

func noGrants(_ context.Context, _ string) ([]string, error) {
	return nil, errors.New("les permissions ne devaient pas être lues sur ce chemin")
}

// Le refus qu'aucune autre porte ne verrait : une opération que la table ne décide pas.
//
// **Le défaut est fermé**, et ce test est ce qui le tient. Une entrée écrite dans le vocabulaire du
// YAML — `"me"` là où le code engendré passe `"Me"` — devient inatteignable ; refuser la rend
// visible au premier appel, quand laisser passer aurait ouvert la garde sans que rien ne le dise.
func TestUneOperationQueLaTableNeDecidePasEstRefusee(t *testing.T) {
	t.Parallel()

	response := servedByGuard(t, map[string]rule{}, noGrants, withResolvedSession(true, true))

	assert.Equal(t, http.StatusForbidden, response.status)
	assert.Equal(t, "forbidden", response.body.Code)
}

// Le témoin de tous les autres : une exemption laisse passer jusqu'au handler.
//
// Sans lui, une garde qui refuserait **tout** passerait chacun des tests de refus ci-dessous.
func TestUneOperationExempteeAtteintSonHandler(t *testing.T) {
	t.Parallel()

	rules := map[string]rule{guardedOperation: exempt("le témoin de ces tests")}

	// Aucune session, et c'est le point : une exemption ne consulte rien du tout.
	response := servedByGuard(t, rules, noGrants, context.Background())

	assert.Equal(t, http.StatusNoContent, response.status,
		"une opération exemptée n'a pas atteint son handler : la garde refuserait tout, et les tests "+
			"de refus ci-dessous passeraient sans rien prouver")
}

// Une session fermée rend 401 et non 403 : le remède n'est pas le même, et le dire de travers
// enverrait l'opérateur chercher un droit qui ne lui manque pas.
func TestUneSessionFermeeEstRefuseeCommeTelle(t *testing.T) {
	t.Parallel()

	response := servedByGuard(t, guardedTable(), noGrants, withResolvedSession(true, false))

	assert.Equal(t, http.StatusUnauthorized, response.status)
	assert.Equal(t, "unauthenticated", response.body.Code)
}

// Une session vivante mais non élevée est refusée **avant** que les permissions soient lues.
//
// L'ordre est observable ici et nulle part ailleurs : `noGrants` rend une erreur, donc un 500
// dirait que la garde a lu les permissions d'une session qu'elle devait déjà avoir refusée.
func TestUneSessionNonElevueEstRefuseeAvantTouteLecture(t *testing.T) {
	t.Parallel()

	response := servedByGuard(t, guardedTable(), noGrants, withResolvedSession(false, true))

	require.Equal(t, http.StatusForbidden, response.status,
		"une session non élevée a atteint la lecture des permissions, ou n'a pas été refusée")
	assert.Equal(t, "mfa_required", response.body.Code)
}

// La branche que la production ne peut pas exercer avant step-029, et que la DoD exige tenue.
func TestUneSessionSansLaCleEstRefusee(t *testing.T) {
	t.Parallel()

	held := func(_ context.Context, _ string) ([]string, error) {
		// Une permission réelle, mais pas celle qu'on exige : un opérateur sans aucun rôle ferait
		// passer ce test même si la comparaison portait sur « la liste est-elle vide ».
		return []string{string(permissions.RoutesRead)}, nil
	}

	response := servedByGuard(t, guardedTable(), held, withResolvedSession(true, true))

	require.Equal(t, http.StatusForbidden, response.status)

	assert.Equal(t, "permission_denied", response.body.Code)
	assert.Contains(t, response.body.Message, string(permissions.RolesManage),
		"le refus ne nomme pas la clé qui manque : un administrateur ne saurait pas quoi accorder")
}

// La clé détenue laisse passer. C'est le second témoin, et il ferme la mutation « refuser toujours ».
func TestUneSessionQuiDetientLaCleAtteintSonHandler(t *testing.T) {
	t.Parallel()

	held := func(_ context.Context, _ string) ([]string, error) {
		return []string{string(permissions.RoutesRead), string(permissions.RolesManage)}, nil
	}

	response := servedByGuard(t, guardedTable(), held, withResolvedSession(true, true))

	assert.Equal(t, http.StatusNoContent, response.status,
		"la clé exigée est détenue et l'appel n'a pas atteint son handler")
}

// Une panne de lecture des permissions n'est pas un refus.
//
// La distinction est celle que step-021 a payée au premier facteur : une base injoignable lue comme
// « vous n'avez pas le droit » ferait chercher un problème de rôle pendant que la panne est ailleurs.
func TestUnePanneDeLectureDesPermissionsNestPasUnRefus(t *testing.T) {
	t.Parallel()

	response := servedByGuard(t, guardedTable(), noGrants, withResolvedSession(true, true))

	assert.Equal(t, http.StatusInternalServerError, response.status)
	assert.Equal(t, "internal_error", response.body.Code)
}

// TestLaGardeEstCablee ferme le risque propre à la couture `grantsOf`.
//
// Les tests ci-dessus injectent leur table et leur source de permissions ; ils prouvent le mécanisme
// et **rien du produit**. En production, toutes les entrées de `authorization` sont exemptées : la
// garde retirée du slice, aucun scénario ne rougit — mesuré. Ce qui reste à tenir, c'est donc que le
// montage la pose, et sur la vraie source.
//
// **Les appels sont rattachés à la fonction qui les porte**, et pas cherchés dans le paquet entier.
// La première rédaction ne l'était pas et se lisait comme un succès : `me.go` appelle déjà
// `Grants` pour rendre les permissions à l'écran, donc l'assertion « le paquet atteint `Grants` »
// était vraie avec ou sans garde câblée. Mesuré, puis resserré.
//
// L'appel est résolu par le **type-checker** et non cherché dans le texte : un détecteur qui grep un
// nom est rendu vrai par le moindre commentaire qui le cite. Même patron que
// `cmd/dashboard/partitions_test.go`.
func TestLaGardeEstCablee(t *testing.T) {
	t.Parallel()

	calls := callsByFunction(t, loadThisPackage(t))

	assert.True(t, calls["newContractHandler"]["requirePermission"],
		"le montage n'installe pas la garde de permission : toute route que step-029 ajoutera serait "+
			"servie sans qu'aucune permission soit exigée, et la table ne garderait rien")

	assert.True(t, calls["newContractHandler"]["grantsFrom"],
		"le montage n'installe pas la source des permissions : la garde jugerait sur une liste que "+
			"rien ne remplit, donc refuserait tous les porteurs de la clé")

	assert.True(t, calls["grantsFrom"]["(*github.com/martialanouman/go-gateway-bo/internal/session.Manager).Grants"],
		"la source des permissions ne lit pas celles de l'opérateur : la garde jugerait sur une "+
			"liste venue d'ailleurs, donc laisserait passer n'importe qui")
}

// callsByFunction rattache chaque appel à la fonction de premier niveau qui le porte, closures
// comprises. Sans ce rattachement, une porte qui cherche un appel « quelque part dans le paquet » est
// verte dès qu'un autre chemin fait le même appel pour une autre raison.
func callsByFunction(t *testing.T, pkg *packages.Package) map[string]map[string]bool {
	t.Helper()

	calls := map[string]map[string]bool{}

	for _, file := range pkg.Syntax {
		for _, declaration := range file.Decls {
			function, isFunction := declaration.(*ast.FuncDecl)
			if !isFunction || function.Body == nil {
				continue
			}

			within := map[string]bool{}

			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, isCall := node.(*ast.CallExpr)
				if !isCall {
					return true
				}

				if name, ok := call.Fun.(*ast.Ident); ok {
					if resolved, isFunc := pkg.TypesInfo.Uses[name].(*types.Func); isFunc {
						within[resolved.Name()] = true
					}
				}

				if selector, ok := call.Fun.(*ast.SelectorExpr); ok {
					if resolved, isFunc := pkg.TypesInfo.Uses[selector.Sel].(*types.Func); isFunc {
						within[qualified(resolved)] = true
					}
				}

				return true
			})

			calls[function.Name.Name] = within
		}
	}

	require.NotEmpty(t, calls, "aucune fonction analysée : la porte est inerte, pas verte")

	return calls
}

// qualified nomme une méthode par son récepteur, pour distinguer `Grants` de tout autre `Grants`.
func qualified(fn *types.Func) string {
	receiver := fn.Signature().Recv()
	if receiver == nil {
		if fn.Pkg() == nil {
			return fn.Name()
		}

		return fn.Pkg().Path() + "." + fn.Name()
	}

	return "(" + receiver.Type().String() + ")." + fn.Name()
}

// loadThisPackage type-checke `internal/bff` pour les deux portes statiques de ce paquet.
//
// Il double `loadBFF` de `dto_test.go`, et c'est le compilateur qui l'impose : celui-là vit dans
// `package bff_test`, celui-ci doit lire des identifiants non exportés. Deux paquets de test dans un
// même répertoire ne partagent pas leurs aides.
func loadThisPackage(t *testing.T) *packages.Package {
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

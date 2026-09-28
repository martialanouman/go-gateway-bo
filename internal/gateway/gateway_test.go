package gateway_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

// Les scénarios de ce package exercent le client sortant contre le **mock Prism**, monté sur le
// contrat publié : c'est la frontière du système sous test. Le harnais lance Prism lui-même depuis
// `web/node_modules/.bin/prism` — le binaire installé, prêt en ~1,0 s — et jamais par `npx`, qui
// repaie une résolution de paquet à chaque lancement.
//
// Rien ici ne se saute : ni `t.Skip()`, ni tag exclu, ni build tag. Un binaire ou un contrat absent
// fait rouge et nomme la sortie de secours. C'est ce qui range ce package du côté à deux toolchains —
// le contrat ne vit que sous `web/node_modules/`, et le job « Tests Go » de la CI reçoit donc l'action
// de setup du versant client.

// `godog` ne pose aucun plancher : `Paths` qui ne trouve rien rend une suite **vide et réussie**, et
// `Strict` ne couvre que les steps non définies d'un scénario lu. Vérifié en renommant
// `gateway.feature` — la suite rend `ok` sans avoir joint le mock une seule fois. Le registre qui
// ferme ces deux trous vit dans `internal/bddtest`, avec ses propres tests unitaires.
func TestScenarios(t *testing.T) {
	baseURL := bddtest.AdminMock(t)
	ran := &bddtest.Ledger{}

	suite := godog.TestSuite{
		Name: "gateway",
		ScenarioInitializer: func(ctx *godog.ScenarioContext) {
			ran.Watch(ctx)
			initializeScenario(ctx, baseURL)
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"."},
			TestingT: t,
			// Une step non définie est un échec : sans ça, un scénario dont personne n'a écrit
			// l'implémentation passe pour vert.
			Strict: true,
		},
	}

	if suite.Run() != 0 {
		t.Fatal("des scénarios ont échoué")
	}

	ran.RequireCorpusExercised(t, ".", minimumScenarios)
}

// La ligne de DoD « le mock sert les 133 opérations » est établie ici, et par les deux affirmations
// que voici plutôt que par un comptage dans le YAML — qui dirait ce que le contrat déclare, jamais ce
// qu'un mock répond.
//
//  1. **Ce que Prism annonce égale ce que le contrat déclare.** Prism imprime une ligne par opération
//     au démarrage ; le contrat, lui, est compté sur ses lignes `operationId:`. Deux sources, une
//     égalité.
//  2. **Chaque route annoncée répond autre chose qu'un refus de routage.** La sonde les interroge
//     toutes. Ce qu'elle établit est le routage, pas la validité de chaque réponse : une opération à
//     corps obligatoire rend un 422 de validation, qui prouve qu'elle est servie et rien de plus. Ce
//     que les scénarios ajoutent, eux, est qu'une route annoncée rend bien l'exemple typé du contrat.
func TestTheMockServesEveryOperationTheContractDeclares(t *testing.T) {
	// Une instance à soi : les routes annoncées se lisent au démarrage, qu'un mock signalé par
	// `make mock` n'a pas laissé voir. Ce test-ci ne réutilise donc jamais.
	mock := bddtest.StartPrism(t)
	declared := declaredOperations(t)

	t.Logf("%d opérations déclarées au contrat, %d routes annoncées par le mock", declared, len(mock.Routes))

	require.Lenf(t, mock.Routes, declared,
		"le mock annonce %d routes pour %d opérations déclarées au contrat : `make mock` ne sert pas ce "+
			"que le contrat décrit, et les scénarios n'exercent qu'une partie de la passerelle",
		len(mock.Routes), declared)

	unserved := unservedRoutes(t, mock.Routes)

	// Les premières suffisent à orienter : une sonde qui se trompe de cible les fait toutes tomber, et
	// cent trente lignes dans un rapport de CI cachent le reste de la suite.
	assert.Emptyf(t, firstFew(unserved),
		"%d opération(s) annoncée(s) sur %d ne sont pas routées : le mock est en désaccord avec lui-même",
		len(unserved), len(mock.Routes))
}

// declaredOperations compte ce que le contrat déclare, sur la ligne qui le déclare : une clé
// `operationId:`, jamais une mention en prose ou en commentaire — même discriminant que
// `contract_copy_test.go`. Le plancher refuse un compte nul : un fichier déplacé ou une clé renommée en
// amont rendrait 0, et l'égalité avec un mock qui n'annonce rien passerait pour verte.
func declaredOperations(t *testing.T) int {
	t.Helper()

	contract, err := os.ReadFile(filepath.Join(bddtest.RepositoryRoot(t), bddtest.AdminContract))
	require.NoError(t, err, "lecture du contrat de l'API Admin")

	declared := 0

	for line := range strings.SplitSeq(string(contract), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "operationId:") {
			declared++
		}
	}

	require.Positive(t, declared, "le contrat ne déclare aucune opération : il a bougé, ou la clé "+
		"`operationId` a changé de nom en amont")

	return declared
}

// probeToken n'ouvre rien : Prism applique le `security` du contrat **avant** de router — sans en-tête
// `Authorization`, tout répond 401 et la sonde ne distinguerait plus une route servie d'une route
// absente. N'importe quel `Bearer` suffit au mock.
//
//nolint:gosec // G101 : voir juste au-dessus.
const probeToken = "Bearer jeton-de-sonde"

func firstFew(routes []string) []string {
	const reported = 5

	if len(routes) <= reported {
		return routes
	}

	return routes[:reported]
}

// unservedRoutes interroge chaque route annoncée et rend celles que le mock ne route pas, nommées.
func unservedRoutes(t *testing.T, routes []bddtest.AnnouncedRoute) []string {
	t.Helper()

	probe := &http.Client{Timeout: callTimeout}

	var unserved []string

	for _, route := range routes {
		if reason := probeRoute(t, probe, route); reason != "" {
			unserved = append(unserved, route.String()+" — "+reason)
		}
	}

	return unserved
}

// probeRoute rend vide quand la route est servie, et le motif du refus sinon. Une route servie répond
// n'importe quoi d'autre : 200 sur une lecture, 422 quand Prism refuse un corps absent, 101 sur un
// flux. Les deux refus de **routage**, eux, se nomment dans le corps : `NO_PATH_MATCHED_ERROR` en 404
// sur un chemin inconnu, `NO_METHOD_MATCHED_ERROR` en 405 sur une méthode que le chemin ne déclare
// pas.
func probeRoute(t *testing.T, probe *http.Client, route bddtest.AnnouncedRoute) string {
	t.Helper()

	request, err := http.NewRequestWithContext(t.Context(), route.Method, route.URL, nil)
	require.NoErrorf(t, err, "sonde de %s", route)

	request.Header.Set("Authorization", probeToken)

	response, err := probe.Do(request)
	if err != nil {
		return err.Error()
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusNotFound && response.StatusCode != http.StatusMethodNotAllowed {
		return ""
	}

	// Le corps est lu borné : ce qui est cherché tient dans l'en-tête du document d'erreur, et un flux
	// qui ne se termine pas n'a pas à faire pendre la sonde.
	refusal, err := io.ReadAll(io.LimitReader(response.Body, 1024))
	require.NoErrorf(t, err, "lecture du refus de %s", route)

	for _, routingError := range []string{"NO_PATH_MATCHED_ERROR", "NO_METHOD_MATCHED_ERROR"} {
		if strings.Contains(string(refusal), routingError) {
			return routingError
		}
	}

	return ""
}

// minimumScenarios est un plancher, pas un compte : en ajouter un n'oblige à rien ici, en retirer un
// demande de le dire.
const minimumScenarios = 2

func initializeScenario(ctx *godog.ScenarioContext, baseURL string) {
	calls := &adminCalls{}

	ctx.Given(`^le mock de l'API Admin monté sur le contrat publié$`, func() error {
		return calls.connect(baseURL)
	})
	ctx.When(`^le BFF demande la liste des clients$`, calls.listCustomers)
	ctx.When(`^la passerelle refuse la liste des clients en (\d+)$`, calls.refusedListing)
	ctx.Then(`^il obtient une page de clients à afficher$`, calls.gotAPageOfCustomers)
	ctx.Then(`^le BFF rend une erreur qui porte le motif que la passerelle a servi$`, calls.gotErrorWithServedCode)
}

// callTimeout borne un appel au mock. Toute attente du harnais est bornée : sans limite, un mock qui
// ne répond pas devient un scénario qui ne finit pas, et le hook qui tue Prism n'est alors jamais
// atteint.
const callTimeout = 10 * time.Second

// adminCalls porte l'état d'un scénario — le client gréé, et ce que le dernier appel a rapporté. Une
// struct par scénario plutôt qu'un `context.Context` : godog en construit une neuve à chaque scénario,
// donc rien ne fuit de l'un à l'autre.
type adminCalls struct {
	client      *gateway.ClientWithResponses
	page        *gateway.CustomerPage
	err         error
	refusedWith int
	servedBody  []byte
}

func (c *adminCalls) connect(baseURL string) error {
	// Le mode `mock` est celui du développement local : pas de mTLS, pas d'endpoint de jeton, un
	// `Bearer` factice. Prism applique le `security` global du contrat — il refuse en 401 une requête
	// sans en-tête `Authorization` et accepte n'importe quel `Bearer` —, donc ces scénarios traversent
	// bien l'authentification sortante, sans rien exiger d'une passerelle.
	client, err := gateway.NewAdminClient(config.GatewayConfig{
		Mode:    config.GatewayModeMock,
		BaseURL: baseURL,
		Timeout: callTimeout,
	})
	if err != nil {
		return fmt.Errorf("client de l'API Admin sur le mock: %w", err)
	}

	c.client = client

	return nil
}

func (c *adminCalls) listCustomers(ctx context.Context) error {
	_, err := c.list(ctx)

	return err
}

// refusedListing demande au mock la réponse d'erreur que le contrat déclare pour cette opération, et
// refuse de continuer s'il ne l'a pas rendue : un scénario qui observerait un 200 en croyant observer
// un refus déclarerait vert un chemin d'erreur que personne n'a emprunté.
func (c *adminCalls) refusedListing(ctx context.Context, status int) error {
	c.refusedWith = status

	observed, err := c.list(ctx, preferStatus(status))
	if err != nil {
		return err
	}

	if observed != status {
		return fmt.Errorf("le mock a répondu %d là où `Prefer: code=%d` demandait un refus : le scénario "+
			"n'observe aucune erreur", observed, status)
	}

	return nil
}

func (c *adminCalls) list(ctx context.Context, editors ...gateway.RequestEditorFn) (int, error) {
	response, err := c.client.ListCustomersWithResponse(ctx, nil, editors...)
	if err != nil {
		return 0, fmt.Errorf("appel de list-customers sur le mock: %w", err)
	}

	c.page = response.JSON200
	c.servedBody = response.Body
	c.err = gateway.ErrorFrom(response.StatusCode(), response.Body)

	return response.StatusCode(), nil
}

// preferStatus demande à Prism la réponse d'un statut précis : sur `/admin/customers`,
// `Prefer: code=422` rend le statut 422 et un corps `Error` que Prism compose. Depuis que le contrat
// borne `code` par un `enum` (6.x), Prism y met la première valeur, `account_suspended`, et non plus
// l'exemple : le scénario compare donc au corps servi plutôt qu'à un motif figé.
// Sans ce levier, un scénario d'erreur devrait remplacer le serveur par un double,
// c'est-à-dire ne plus rien exercer du contrat.
func preferStatus(status int) gateway.RequestEditorFn {
	return func(_ context.Context, request *http.Request) error {
		request.Header.Set("Prefer", "code="+strconv.Itoa(status))

		return nil
	}
}

func (c *adminCalls) gotAPageOfCustomers() error {
	if c.err != nil {
		return fmt.Errorf("la passerelle n'a pas rendu de page: %w", c.err)
	}

	if c.page == nil {
		return errors.New("la réponse n'a pas été décodée dans le type du contrat : l'écran n'aurait " +
			"rien à afficher")
	}

	if len(c.page.Data) == 0 {
		return errors.New("la page ne porte aucun client : le décodage a réussi sur une enveloppe vide")
	}

	// Le premier client est examiné parce qu'une enveloppe décodée sur des champs vides passerait les
	// deux contrôles précédents : ce qui est observé est qu'un écran aurait de quoi remplir une ligne.
	if first := c.page.Data[0]; first.Name == "" || first.Status == "" {
		return fmt.Errorf("le premier client n'a ni nom ni statut (%+v) : une ligne de tableau resterait "+
			"vide", first)
	}

	return nil
}

// gotErrorWithServedCode observe ce dont un écran a besoin pour dire *pourquoi* : une erreur
// reconnaissable par `errors.As`, portant le code stable que la passerelle a servi et le statut de son
// refus. Le message que la passerelle a écrit n'est pas observé ici — c'est du texte amont, que
// l'invariant (a) tient hors de tout rendu et que `errors_test.go` garde.
func (c *adminCalls) gotErrorWithServedCode() error {
	var served struct {
		Code string `json:"code"`
	}

	if err := json.Unmarshal(c.servedBody, &served); err != nil || served.Code == "" {
		return fmt.Errorf("le mock n'a pas servi d'enveloppe d'erreur lisible : %s", c.servedBody)
	}

	code := served.Code

	var apiErr *gateway.APIError

	if !errors.As(c.err, &apiErr) {
		return fmt.Errorf("le refus de la passerelle n'est pas arrivé comme une erreur typée (%v) : "+
			"l'écran n'aurait rien à dire de plus qu'« une erreur est survenue »", c.err)
	}

	if apiErr.Code != code {
		return fmt.Errorf("l'erreur porte le motif %q et non %q", apiErr.Code, code)
	}

	if apiErr.Status != c.refusedWith {
		return fmt.Errorf("l'erreur porte le statut %d et non le %d du refus", apiErr.Status, c.refusedWith)
	}

	return nil
}

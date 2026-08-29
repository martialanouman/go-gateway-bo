package main

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// Les deux appels que le démarrage doit porter pour que le journal d'audit reste écrivable d'un mois
// sur l'autre. Le second est celui qu'aucun autre test ne garde — voir plus bas.
const (
	partitionStartupCall = "EnsureAuditPartitions"
	partitionRefreshCall = "KeepAuditPartitions"
)

// TestLeDemarrageEntretientLesPartitionsDAudit garde le **branchement**, pas la fonction.
//
// `internal/store` prouve déjà que `KeepAuditPartitions` repasse et s'arrête avec son contexte. Ce
// qu'il ne prouve pas, c'est que `run` la lance : mesuré, retirer la goroutine de `main.go` laisse
// toute la suite verte. Or c'est cette ligne-là qui empêche la panne du mois suivant sur un process
// qui ne redémarre pas.
//
// L'appel est résolu par le **type-checker** et non cherché dans le texte : un détecteur qui grep un
// nom est rendu vrai par le moindre commentaire qui le cite — le dépôt s'est déjà fait prendre.
// C'est le patron de `TestTheContractMountInstallsTheProductErrorHandler`, appliqué ici.
func TestLeDemarrageEntretientLesPartitionsDAudit(t *testing.T) {
	t.Parallel()

	loaded, err := packages.Load(&packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedImports | packages.NeedDeps |
			packages.NeedSyntax | packages.NeedTypesInfo,
	}, ".")
	require.NoError(t, err)
	require.Len(t, loaded, 1)
	require.Empty(t, loaded[0].Errors, "le paquet ne type-checke pas, l'analyse ne prouverait rien")

	pkg := loaded[0]
	called := map[string]bool{}

	for _, file := range pkg.Syntax {
		ast.Inspect(file, func(node ast.Node) bool {
			call, isCall := node.(*ast.CallExpr)
			if !isCall {
				return true
			}

			// `store.KeepAuditPartitions(…)` : un sélecteur, pas un identifiant nu.
			selector, isSelector := call.Fun.(*ast.SelectorExpr)
			if !isSelector {
				return true
			}

			target, isFunc := pkg.TypesInfo.Uses[selector.Sel].(*types.Func)
			if !isFunc || target.Pkg() == nil ||
				target.Pkg().Path() != "github.com/martialanouman/go-gateway-bo/internal/store" {
				return true
			}

			called[target.Name()] = true

			return true
		})
	}

	assert.Truef(t, called[partitionStartupCall],
		"le démarrage n'appelle pas store.%s : une base migrée il y a deux mois n'aurait plus de "+
			"partition pour le mois courant, et toute écriture d'audit — donc toute action tracée — "+
			"serait refusée", partitionStartupCall)

	assert.Truef(t, called[partitionRefreshCall],
		"le démarrage ne lance pas store.%s : un process qui traverse un changement de mois sans "+
			"redémarrer perdrait la partition suivante, et rien ne le dirait avant la première "+
			"écriture refusée", partitionRefreshCall)
}

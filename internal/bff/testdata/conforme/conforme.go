// Package conforme est le témoin positif de `compile_test.go` : il doit compiler. Sans lui, un
// harnais cassé — mauvais chemin, import erroné, `go build` introuvable — ferait échouer les deux
// fixtures et la porte resterait verte en ne prouvant rien.
package conforme

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

// API ne diffère de `testdata/divergent` que par la signature de `Health`. Tout le reste — le nom du
// type, l'import, l'appel au constructeur — est identique, pour que l'écart entre les deux fixtures
// soit exactement ce que la porte prétend mesurer.
type API struct{}

func (API) Health(_ context.Context, _ bff.HealthRequestObject) (bff.HealthResponseObject, error) {
	return bff.Health200JSONResponse{Status: bff.HealthStatusOk}, nil
}

var _ = bff.NewStrictHandler(API{}, nil)

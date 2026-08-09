// Package divergent est le cas de compilation négatif de `compile_test.go` : il ne doit **pas**
// compiler. Il vit sous `testdata/`, que `go build ./...`, `go list ./...` et `go vet ./...`
// ignorent — c'est ce qui lui permet d'être rouge en permanence sans rien casser.
package divergent

import (
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/bff"
)

// API porte l'opération du contrat sous la signature de l'interface **simple** au lieu de l'interface
// stricte. C'est la divergence vraisemblable, et non une faute arbitraire : le code engendré déclare
// les deux interfaces, et celle-ci rendrait un `http.ResponseWriter` nu où n'importe quel corps
// pourrait s'écrire — exactement ce que le DTO de sortie interdit.
type API struct{}

func (API) Health(_ http.ResponseWriter, _ *http.Request) {}

// Login est identique dans les deux fixtures : ce que la porte mesure est l'écart sur `Health`, et
// une méthode qui différerait ici brouillerait la mesure.
func (API) Login(_ context.Context, _ bff.LoginRequestObject) (bff.LoginResponseObject, error) {
	return bff.Login401JSONResponse{Code: "invalid_credentials", Message: "Refusé."}, nil
}

var _ = bff.NewStrictHandler(API{}, nil)

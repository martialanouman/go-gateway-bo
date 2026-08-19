// Package divergent est le cas de compilation négatif de `compile_test.go` : il ne doit **pas**
// compiler. Il vit sous `testdata/`, que `go build ./...`, `go list ./...` et `go vet ./...`
// ignorent — c'est ce qui lui permet d'être rouge en permanence sans rien casser.
package divergent

import (
	"context"
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

// Me est identique dans les deux fixtures, pour la même raison que `Login`.
func (API) Me(_ context.Context, _ bff.MeRequestObject) (bff.MeResponseObject, error) {
	return bff.Me401JSONResponse{Code: "unauthenticated", Message: "Reconnectez-vous."}, nil
}

// Logout est identique dans les deux fixtures, pour la même raison que `Login`.
func (API) Logout(_ context.Context, _ bff.LogoutRequestObject) (bff.LogoutResponseObject, error) {
	return bff.Logout204Response{}, nil
}

// EnrollTotp et VerifyMfa sont identiques dans les deux fixtures, pour la même raison que `Login`.
func (API) EnrollTotp(_ context.Context, _ bff.EnrollTotpRequestObject) (bff.EnrollTotpResponseObject,
	error,
) {
	return bff.EnrollTotp401JSONResponse{Code: "unauthenticated", Message: "Reconnectez-vous."}, nil
}

func (API) VerifyMfa(_ context.Context, _ bff.VerifyMfaRequestObject) (bff.VerifyMfaResponseObject,
	error,
) {
	return bff.VerifyMfa204Response{}, nil
}

var _ = bff.NewStrictHandler(API{}, nil)

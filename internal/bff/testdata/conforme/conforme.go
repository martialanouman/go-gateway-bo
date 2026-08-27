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

// Les quatre cérémonies WebAuthn sont identiques dans les deux fixtures, pour la même raison que
// `Login` : ce que la porte mesure est l'écart sur `Health`, et une méthode qui différerait ici
// brouillerait la mesure — le compilateur nommerait la méthode manquante plutôt que la signature
// divergente.
func (API) BeginWebauthnRegistration(_ context.Context,
	_ bff.BeginWebauthnRegistrationRequestObject,
) (bff.BeginWebauthnRegistrationResponseObject, error) {
	return bff.BeginWebauthnRegistration401JSONResponse{
		Code: "unauthenticated", Message: "Reconnectez-vous.",
	}, nil
}

func (API) FinishWebauthnRegistration(_ context.Context,
	_ bff.FinishWebauthnRegistrationRequestObject,
) (bff.FinishWebauthnRegistrationResponseObject, error) {
	return bff.FinishWebauthnRegistration401JSONResponse{
		Code: "unauthenticated", Message: "Reconnectez-vous.",
	}, nil
}

func (API) BeginWebauthnAssertion(_ context.Context,
	_ bff.BeginWebauthnAssertionRequestObject,
) (bff.BeginWebauthnAssertionResponseObject, error) {
	return bff.BeginWebauthnAssertion401JSONResponse{
		Code: "unauthenticated", Message: "Reconnectez-vous.",
	}, nil
}

func (API) DeleteWebauthnPasskey(_ context.Context,
	_ bff.DeleteWebauthnPasskeyRequestObject,
) (bff.DeleteWebauthnPasskeyResponseObject, error) {
	return bff.DeleteWebauthnPasskey204Response{}, nil
}

var _ = bff.NewStrictHandler(API{}, nil)

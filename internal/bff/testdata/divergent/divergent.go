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

func (API) ListOperators(_ context.Context, _ bff.ListOperatorsRequestObject) (bff.ListOperatorsResponseObject, error) {
	return nil, nil
}

func (API) CreateOperator(_ context.Context, _ bff.CreateOperatorRequestObject) (bff.CreateOperatorResponseObject, error) {
	return nil, nil
}

func (API) UpdateOperator(_ context.Context, _ bff.UpdateOperatorRequestObject) (bff.UpdateOperatorResponseObject, error) {
	return nil, nil
}

func (API) SetOperatorRoles(_ context.Context, _ bff.SetOperatorRolesRequestObject) (bff.SetOperatorRolesResponseObject, error) {
	return nil, nil
}

func (API) RequestOperatorAccessLink(_ context.Context, _ bff.RequestOperatorAccessLinkRequestObject) (bff.RequestOperatorAccessLinkResponseObject, error) {
	return nil, nil
}

func (API) SetPasswordFromAccessLink(_ context.Context, _ bff.SetPasswordFromAccessLinkRequestObject) (bff.SetPasswordFromAccessLinkResponseObject, error) {
	return nil, nil
}

func (API) ListRoles(_ context.Context, _ bff.ListRolesRequestObject) (bff.ListRolesResponseObject, error) {
	return nil, nil
}

func (API) CreateRole(_ context.Context, _ bff.CreateRoleRequestObject) (bff.CreateRoleResponseObject, error) {
	return nil, nil
}

func (API) UpdateRole(_ context.Context, _ bff.UpdateRoleRequestObject) (bff.UpdateRoleResponseObject, error) {
	return nil, nil
}

func (API) DeleteRole(_ context.Context, _ bff.DeleteRoleRequestObject) (bff.DeleteRoleResponseObject, error) {
	return nil, nil
}

func (API) ListNotifications(_ context.Context, _ bff.ListNotificationsRequestObject) (bff.ListNotificationsResponseObject, error) {
	return nil, nil
}

func (API) MarkNotificationRead(_ context.Context, _ bff.MarkNotificationReadRequestObject) (bff.MarkNotificationReadResponseObject, error) {
	return nil, nil
}

var _ = bff.NewStrictHandler(API{}, nil)

func (API) ListWebauthnPasskeys(_ context.Context,
	_ bff.ListWebauthnPasskeysRequestObject,
) (bff.ListWebauthnPasskeysResponseObject, error) {
	return bff.ListWebauthnPasskeys200JSONResponse{}, nil
}

func (API) ConfirmTotp(_ context.Context, _ bff.ConfirmTotpRequestObject,
) (bff.ConfirmTotpResponseObject, error) {
	return bff.ConfirmTotp204Response{}, nil
}

func (API) CreateCustomerGroup(_ context.Context, _ bff.CreateCustomerGroupRequestObject) (bff.CreateCustomerGroupResponseObject, error) {
	return nil, nil
}

func (API) GetCustomerGroup(_ context.Context, _ bff.GetCustomerGroupRequestObject) (bff.GetCustomerGroupResponseObject, error) {
	return nil, nil
}

func (API) UpdateCustomerGroup(_ context.Context, _ bff.UpdateCustomerGroupRequestObject) (bff.UpdateCustomerGroupResponseObject, error) {
	return nil, nil
}

func (API) DeleteCustomerGroup(_ context.Context, _ bff.DeleteCustomerGroupRequestObject) (bff.DeleteCustomerGroupResponseObject, error) {
	return nil, nil
}

func (API) ListCustomers(_ context.Context, _ bff.ListCustomersRequestObject) (bff.ListCustomersResponseObject, error) {
	return nil, nil
}

func (API) CreateCustomer(_ context.Context, _ bff.CreateCustomerRequestObject) (bff.CreateCustomerResponseObject, error) {
	return nil, nil
}

func (API) GetCustomer(_ context.Context, _ bff.GetCustomerRequestObject) (bff.GetCustomerResponseObject, error) {
	return nil, nil
}

func (API) UpdateCustomer(_ context.Context, _ bff.UpdateCustomerRequestObject) (bff.UpdateCustomerResponseObject, error) {
	return nil, nil
}

func (API) SetCustomerGroup(_ context.Context, _ bff.SetCustomerGroupRequestObject) (bff.SetCustomerGroupResponseObject, error) {
	return nil, nil
}

func (API) GetCustomerSuspensionImpact(_ context.Context, _ bff.GetCustomerSuspensionImpactRequestObject) (bff.GetCustomerSuspensionImpactResponseObject, error) {
	return nil, nil
}

func (API) SuspendCustomer(_ context.Context, _ bff.SuspendCustomerRequestObject) (bff.SuspendCustomerResponseObject, error) {
	return nil, nil
}

func (API) ReactivateCustomer(_ context.Context, _ bff.ReactivateCustomerRequestObject) (bff.ReactivateCustomerResponseObject, error) {
	return nil, nil
}

func (API) ListSenderIds(_ context.Context, _ bff.ListSenderIdsRequestObject) (bff.ListSenderIdsResponseObject, error) {
	return nil, nil
}

func (API) CreateSenderId(_ context.Context, _ bff.CreateSenderIdRequestObject) (bff.CreateSenderIdResponseObject, error) {
	return nil, nil
}

func (API) UpdateSenderId(_ context.Context, _ bff.UpdateSenderIdRequestObject) (bff.UpdateSenderIdResponseObject, error) {
	return nil, nil
}

func (API) DeleteSenderId(_ context.Context, _ bff.DeleteSenderIdRequestObject) (bff.DeleteSenderIdResponseObject, error) {
	return nil, nil
}

func (API) SetSenderIdRateLimit(_ context.Context, _ bff.SetSenderIdRateLimitRequestObject) (bff.SetSenderIdRateLimitResponseObject, error) {
	return nil, nil
}

func (API) DeleteSenderIdRateLimit(_ context.Context, _ bff.DeleteSenderIdRateLimitRequestObject) (bff.DeleteSenderIdRateLimitResponseObject, error) {
	return nil, nil
}

func (API) ListAccounts(_ context.Context, _ bff.ListAccountsRequestObject) (bff.ListAccountsResponseObject, error) {
	return nil, nil
}

func (API) CreateAccount(_ context.Context, _ bff.CreateAccountRequestObject) (bff.CreateAccountResponseObject, error) {
	return nil, nil
}

func (API) GetAccount(_ context.Context, _ bff.GetAccountRequestObject) (bff.GetAccountResponseObject, error) {
	return nil, nil
}

func (API) SetAccountChannels(_ context.Context, _ bff.SetAccountChannelsRequestObject) (bff.SetAccountChannelsResponseObject, error) {
	return nil, nil
}

func (API) SetAccountSmppOps(_ context.Context, _ bff.SetAccountSmppOpsRequestObject) (bff.SetAccountSmppOpsResponseObject, error) {
	return nil, nil
}

func (API) ListWebhooks(_ context.Context, _ bff.ListWebhooksRequestObject) (bff.ListWebhooksResponseObject, error) {
	return nil, nil
}

func (API) CreateWebhook(_ context.Context, _ bff.CreateWebhookRequestObject) (bff.CreateWebhookResponseObject, error) {
	return nil, nil
}

func (API) UpdateWebhook(_ context.Context, _ bff.UpdateWebhookRequestObject) (bff.UpdateWebhookResponseObject, error) {
	return nil, nil
}

func (API) RotateWebhookSecret(_ context.Context, _ bff.RotateWebhookSecretRequestObject) (bff.RotateWebhookSecretResponseObject, error) {
	return nil, nil
}

func (API) DeleteWebhook(_ context.Context, _ bff.DeleteWebhookRequestObject) (bff.DeleteWebhookResponseObject, error) {
	return nil, nil
}

func (API) ListCredentials(_ context.Context, _ bff.ListCredentialsRequestObject) (bff.ListCredentialsResponseObject, error) {
	return nil, nil
}

func (API) CreateCredential(_ context.Context, _ bff.CreateCredentialRequestObject) (bff.CreateCredentialResponseObject, error) {
	return nil, nil
}

func (API) RevokeCredential(_ context.Context, _ bff.RevokeCredentialRequestObject) (bff.RevokeCredentialResponseObject, error) {
	return nil, nil
}

func (API) RotateCredential(_ context.Context, _ bff.RotateCredentialRequestObject) (bff.RotateCredentialResponseObject, error) {
	return nil, nil
}

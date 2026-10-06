// Package compliant est le témoin positif de `compile_test.go` : il doit compiler. Sans lui, un
// harnais cassé — mauvais chemin, import erroné, `go build` introuvable — ferait échouer les deux
// fixtures et la porte resterait verte en ne prouvant rien.
package compliant

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

func (API) ListCustomerGroups(_ context.Context, _ bff.ListCustomerGroupsRequestObject,
) (bff.ListCustomerGroupsResponseObject, error) {
	return bff.ListCustomerGroups200JSONResponse{}, nil
}

func (API) CreateCustomerGroup(_ context.Context, _ bff.CreateCustomerGroupRequestObject,
) (bff.CreateCustomerGroupResponseObject, error) {
	return bff.CreateCustomerGroup201JSONResponse{}, nil
}

func (API) GetCustomerGroup(_ context.Context, _ bff.GetCustomerGroupRequestObject,
) (bff.GetCustomerGroupResponseObject, error) {
	return bff.GetCustomerGroup200JSONResponse{}, nil
}

func (API) UpdateCustomerGroup(_ context.Context, _ bff.UpdateCustomerGroupRequestObject,
) (bff.UpdateCustomerGroupResponseObject, error) {
	return bff.UpdateCustomerGroup200JSONResponse{}, nil
}

func (API) DeleteCustomerGroup(_ context.Context, _ bff.DeleteCustomerGroupRequestObject,
) (bff.DeleteCustomerGroupResponseObject, error) {
	return bff.DeleteCustomerGroup204Response{}, nil
}

func (API) ListCustomers(_ context.Context, _ bff.ListCustomersRequestObject,
) (bff.ListCustomersResponseObject, error) {
	return bff.ListCustomers200JSONResponse{}, nil
}

func (API) CreateCustomer(_ context.Context, _ bff.CreateCustomerRequestObject,
) (bff.CreateCustomerResponseObject, error) {
	return bff.CreateCustomer201JSONResponse{}, nil
}

func (API) GetCustomer(_ context.Context, _ bff.GetCustomerRequestObject,
) (bff.GetCustomerResponseObject, error) {
	return bff.GetCustomer200JSONResponse{}, nil
}

func (API) UpdateCustomer(_ context.Context, _ bff.UpdateCustomerRequestObject,
) (bff.UpdateCustomerResponseObject, error) {
	return bff.UpdateCustomer200JSONResponse{}, nil
}

func (API) SetCustomerGroup(_ context.Context, _ bff.SetCustomerGroupRequestObject,
) (bff.SetCustomerGroupResponseObject, error) {
	return bff.SetCustomerGroup200JSONResponse{}, nil
}

func (API) GetCustomerSuspensionImpact(_ context.Context, _ bff.GetCustomerSuspensionImpactRequestObject,
) (bff.GetCustomerSuspensionImpactResponseObject, error) {
	return bff.GetCustomerSuspensionImpact200JSONResponse{}, nil
}

func (API) SuspendCustomer(_ context.Context, _ bff.SuspendCustomerRequestObject,
) (bff.SuspendCustomerResponseObject, error) {
	return bff.SuspendCustomer200JSONResponse{}, nil
}

func (API) ReactivateCustomer(_ context.Context, _ bff.ReactivateCustomerRequestObject,
) (bff.ReactivateCustomerResponseObject, error) {
	return bff.ReactivateCustomer200JSONResponse{}, nil
}

func (API) ListSenderIds(_ context.Context, _ bff.ListSenderIdsRequestObject,
) (bff.ListSenderIdsResponseObject, error) {
	return bff.ListSenderIds200JSONResponse{}, nil
}

func (API) CreateSenderId(_ context.Context, _ bff.CreateSenderIdRequestObject,
) (bff.CreateSenderIdResponseObject, error) {
	return bff.CreateSenderId201JSONResponse{}, nil
}

func (API) UpdateSenderId(_ context.Context, _ bff.UpdateSenderIdRequestObject,
) (bff.UpdateSenderIdResponseObject, error) {
	return bff.UpdateSenderId200JSONResponse{}, nil
}

func (API) DeleteSenderId(_ context.Context, _ bff.DeleteSenderIdRequestObject,
) (bff.DeleteSenderIdResponseObject, error) {
	return bff.DeleteSenderId204Response{}, nil
}

func (API) SetSenderIdRateLimit(_ context.Context, _ bff.SetSenderIdRateLimitRequestObject,
) (bff.SetSenderIdRateLimitResponseObject, error) {
	return bff.SetSenderIdRateLimit200JSONResponse{}, nil
}

func (API) DeleteSenderIdRateLimit(_ context.Context, _ bff.DeleteSenderIdRateLimitRequestObject,
) (bff.DeleteSenderIdRateLimitResponseObject, error) {
	return bff.DeleteSenderIdRateLimit204Response{}, nil
}

func (API) ListAccounts(_ context.Context, _ bff.ListAccountsRequestObject,
) (bff.ListAccountsResponseObject, error) {
	return bff.ListAccounts200JSONResponse{}, nil
}

func (API) CreateAccount(_ context.Context, _ bff.CreateAccountRequestObject,
) (bff.CreateAccountResponseObject, error) {
	return bff.CreateAccount201JSONResponse{}, nil
}

func (API) GetAccount(_ context.Context, _ bff.GetAccountRequestObject,
) (bff.GetAccountResponseObject, error) {
	return bff.GetAccount200JSONResponse{}, nil
}

func (API) SetAccountChannels(_ context.Context, _ bff.SetAccountChannelsRequestObject,
) (bff.SetAccountChannelsResponseObject, error) {
	return bff.SetAccountChannels200JSONResponse{}, nil
}

func (API) SetAccountSmppOps(_ context.Context, _ bff.SetAccountSmppOpsRequestObject,
) (bff.SetAccountSmppOpsResponseObject, error) {
	return bff.SetAccountSmppOps200JSONResponse{}, nil
}

func (API) SetAccountSessionLimits(_ context.Context, _ bff.SetAccountSessionLimitsRequestObject,
) (bff.SetAccountSessionLimitsResponseObject, error) {
	return bff.SetAccountSessionLimits200JSONResponse{}, nil
}

func (API) ListAccountSessions(_ context.Context, _ bff.ListAccountSessionsRequestObject,
) (bff.ListAccountSessionsResponseObject, error) {
	return bff.ListAccountSessions200JSONResponse{}, nil
}

func (API) ListWebhooks(_ context.Context, _ bff.ListWebhooksRequestObject,
) (bff.ListWebhooksResponseObject, error) {
	return bff.ListWebhooks200JSONResponse{}, nil
}

func (API) CreateWebhook(_ context.Context, _ bff.CreateWebhookRequestObject,
) (bff.CreateWebhookResponseObject, error) {
	return bff.CreateWebhook201JSONResponse{}, nil
}

func (API) UpdateWebhook(_ context.Context, _ bff.UpdateWebhookRequestObject,
) (bff.UpdateWebhookResponseObject, error) {
	return bff.UpdateWebhook200JSONResponse{}, nil
}

func (API) RotateWebhookSecret(_ context.Context, _ bff.RotateWebhookSecretRequestObject,
) (bff.RotateWebhookSecretResponseObject, error) {
	return bff.RotateWebhookSecret200JSONResponse{}, nil
}

func (API) DeleteWebhook(_ context.Context, _ bff.DeleteWebhookRequestObject,
) (bff.DeleteWebhookResponseObject, error) {
	return bff.DeleteWebhook204Response{}, nil
}

func (API) ListCredentials(_ context.Context, _ bff.ListCredentialsRequestObject,
) (bff.ListCredentialsResponseObject, error) {
	return bff.ListCredentials200JSONResponse{}, nil
}

func (API) CreateCredential(_ context.Context, _ bff.CreateCredentialRequestObject,
) (bff.CreateCredentialResponseObject, error) {
	return bff.CreateCredential201JSONResponse{}, nil
}

func (API) RevokeCredential(_ context.Context, _ bff.RevokeCredentialRequestObject,
) (bff.RevokeCredentialResponseObject, error) {
	return bff.RevokeCredential204Response{}, nil
}

func (API) RotateCredential(_ context.Context, _ bff.RotateCredentialRequestObject,
) (bff.RotateCredentialResponseObject, error) {
	return bff.RotateCredential200JSONResponse{}, nil
}

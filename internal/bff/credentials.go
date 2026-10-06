package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

//nolint:gosec // G101 : des noms d'opérations du contrat, pas des secrets.
const (
	operationListCredentials  = "list-credentials"
	operationCreateCredential = "create-credential"
	operationRevokeCredential = "revoke-credential"
	operationRotateCredential = "rotate-credential"
	operationListBindFailures = "list-account-bind-failures"
)

func (a API) ListCredentials(ctx context.Context, request ListCredentialsRequestObject,
) (ListCredentialsResponseObject, error) {
	accountID, known := parseID(request.AccountId)
	if !known {
		return ListCredentials404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	response, err := a.Gateway.ListCredentialsWithResponse(ctx, accountID)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.accountRefusal(ctx, operationListCredentials, err)

		switch status {
		case http.StatusNotFound:
			return ListCredentials404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return ListCredentials422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ListCredentials503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	credentials := make(ListCredentials200JSONResponse, 0, len(*response.JSON200))
	for _, credential := range *response.JSON200 {
		credentials = append(credentials, credentialDTO(credential))
	}

	return credentials, nil
}

func (a API) CreateCredential(ctx context.Context, request CreateCredentialRequestObject,
) (CreateCredentialResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	accountID, known := parseID(request.AccountId)
	if !known {
		return CreateCredential404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	after := store.NewFields().Text("account_id", accountID.String()).Text("type", string(request.Body.Type))
	if request.Body.SystemId != nil {
		after = after.Text("system_id", *request.Body.SystemId)
	}

	var response *gateway.CreateCredentialResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionCredentialCreate, TargetType: auditTargetCredential, After: after,
	}), func(ctx context.Context, event *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.CreateCredentialWithResponse(ctx, accountID, gateway.CreateCredentialJSONRequestBody{
			Type: gateway.CreateCredentialJSONBodyType(request.Body.Type), SystemId: request.Body.SystemId,
		})
		if callErr != nil {
			return 0, callErr
		}

		if response.JSON201 != nil {
			event.TargetID = response.JSON201.Id.String()
		}

		return response.StatusCode(), nil
	})
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON201 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.accountRefusal(ctx, operationCreateCredential, err)

		switch status {
		case http.StatusNotFound:
			return CreateCredential404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusConflict:
			return CreateCredential409JSONResponse{
				TypeDIdentifiantPrisJSONResponse(credentialTaken(body.Code, request.Body.Type)),
			}, nil
		case http.StatusUnprocessableEntity:
			return CreateCredential422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return CreateCredential503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return CreateCredential201JSONResponse(credentialSecretDTO(*response.JSON201)), nil
}

func (a API) RevokeCredential(ctx context.Context, request RevokeCredentialRequestObject,
) (RevokeCredentialResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	accountID, credentialID, known := parseAccountItemPath(request.AccountId, request.CredentialId)
	if !known {
		return RevokeCredential404JSONResponse{IdentifiantInconnuJSONResponse(unknownCredential())}, nil
	}

	var response *gateway.RevokeCredentialResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionCredentialRevoke, TargetType: auditTargetCredential,
		TargetID: credentialID.String(), After: store.NewFields().Text("account_id", accountID.String()),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.RevokeCredentialWithResponse(ctx, accountID, credentialID)
		if callErr != nil {
			return 0, callErr
		}

		return response.StatusCode(), nil
	})
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err != nil {
		status, body, err := a.credentialRefusal(ctx, operationRevokeCredential, err)

		switch status {
		case http.StatusNotFound:
			return RevokeCredential404JSONResponse{IdentifiantInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return RevokeCredential422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return RevokeCredential503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return RevokeCredential204Response{}, nil
}

func (a API) RotateCredential(ctx context.Context, request RotateCredentialRequestObject,
) (RotateCredentialResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	accountID, credentialID, known := parseAccountItemPath(request.AccountId, request.CredentialId)
	if !known {
		return RotateCredential404JSONResponse{IdentifiantInconnuJSONResponse(unknownCredential())}, nil
	}

	after := store.NewFields().Text("account_id", accountID.String())
	if request.Body.GracePeriodSec != nil {
		after = after.Number("grace_period_sec", *request.Body.GracePeriodSec)
	}

	var response *gateway.RotateCredentialResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionCredentialRotate, TargetType: auditTargetCredential,
		TargetID: credentialID.String(), After: after,
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.RotateCredentialWithResponse(ctx, accountID, credentialID,
			gateway.RotateCredentialJSONRequestBody{GracePeriodSec: request.Body.GracePeriodSec})
		if callErr != nil {
			return 0, callErr
		}

		return response.StatusCode(), nil
	})
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.credentialRefusal(ctx, operationRotateCredential, err)

		switch status {
		case http.StatusNotFound:
			return RotateCredential404JSONResponse{IdentifiantInconnuJSONResponse(body)}, nil
		case http.StatusConflict:
			return RotateCredential409JSONResponse{SystemIdReprisJSONResponse(systemIDRetaken(body.Code))}, nil
		case http.StatusUnprocessableEntity:
			return RotateCredential422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return RotateCredential503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return RotateCredential200JSONResponse(credentialSecretDTO(*response.JSON200)), nil
}

func (a API) credentialRefusal(ctx context.Context, operation string, err error) (int, Error, error) {
	status, body, err := a.relayedRefusal(ctx, operation, err)
	if status == http.StatusNotFound {
		body = Error{Code: body.Code, Message: unknownCredential().Message}
	}

	return status, body, err
}

func credentialDTO(credential gateway.Credential) Credential {
	return Credential{
		Id:             credential.Id.String(),
		Type:           CredentialType(credential.Type),
		SystemId:       credential.SystemId,
		Status:         CredentialStatus(credential.Status),
		LastUsedAt:     credential.LastUsedAt,
		GraceExpiresAt: credential.GraceExpiresAt,
		CreatedAt:      credential.CreatedAt,
		RotatedAt:      credential.RotatedAt,
	}
}

// credentialSecretDTO est le seul chemin par lequel un secret d'identifiant sort du BFF (invariant b).
func credentialSecretDTO(created gateway.CredentialWithSecret) CredentialSecret {
	return CredentialSecret{
		Credential: credentialDTO(gateway.Credential{
			Id: created.Id, AccountId: created.AccountId, Type: gateway.CredentialType(created.Type),
			SystemId: created.SystemId, Status: gateway.CredentialStatus(created.Status),
			LastUsedAt: created.LastUsedAt, GraceExpiresAt: created.GraceExpiresAt,
			CreatedAt: created.CreatedAt, RotatedAt: created.RotatedAt,
		}),
		Secret: created.Secret,
	}
}

func unknownCredential() Error {
	return Error{Code: "not_found", Message: "Cet identifiant n'existe plus sur ce compte. Rechargez la fiche."}
}

// credentialTaken : pour un bind SMPP, la passerelle rend le même 409 que le type soit déjà pris
// sur ce compte ou que le system_id le soit sur un autre — le refus nomme les deux.
func credentialTaken(code string, credentialType CredentialType) Error {
	if credentialType == CredentialTypeApiKey {
		const refusal = "Ce compte a déjà une clé API, active ou révoquée : faites-la tourner pour obtenir une nouvelle clé."

		return Error{Code: code, Message: refusal, Errors: &[]FieldError{{Field: "type", Message: refusal}}}
	}

	const refusal = "Ce compte a déjà un identifiant SMPP, ou ce system_id appartient à un autre compte : " +
		"faites tourner l'identifiant existant, ou choisissez un autre system_id."

	return Error{Code: code, Message: refusal, Errors: &[]FieldError{{Field: "systemId", Message: refusal}}}
}

func systemIDRetaken(code string) Error {
	return Error{
		Code: code,
		Message: "Cet identifiant ne peut pas redevenir actif : un autre compte utilise désormais son system_id. " +
			"Ce compte ne pourra pas se lier en SMPP tant que ce system_id reste pris.",
	}
}

func (a API) ListAccountBindFailures(ctx context.Context, request ListAccountBindFailuresRequestObject,
) (ListAccountBindFailuresResponseObject, error) {
	accountID, known := parseID(request.AccountId)
	if !known {
		return ListAccountBindFailures404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	response, err := a.Gateway.ListAccountBindFailuresWithResponse(ctx, accountID, nil)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.accountRefusal(ctx, operationListBindFailures, err)

		switch status {
		case http.StatusNotFound:
			return ListAccountBindFailures404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return ListAccountBindFailures422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ListAccountBindFailures503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	failures := make(ListAccountBindFailures200JSONResponse, 0, len(response.JSON200.Data))
	for _, failure := range response.JSON200.Data {
		failures = append(failures, BindFailure{
			At:            failure.At,
			RemoteIp:      failure.RemoteIp,
			BindType:      BindType(failure.BindType),
			CommandStatus: BindFailureCommandStatus(failure.CommandStatus),
			Reason:        BindFailureReason(failure.Reason),
		})
	}

	return failures, nil
}

package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	operationListAccounts      = "list-smpp-accounts"
	operationCreateAccount     = "create-smpp-account"
	operationGetAccount        = "get-smpp-account"
	operationSetAccountChannel = "set-account-channels"
	operationSetAccountSmppOps = "set-account-smpp-ops"
)

func (a API) ListAccounts(ctx context.Context, request ListAccountsRequestObject,
) (ListAccountsResponseObject, error) {
	params := gateway.ListSmppAccountsParams{CustomerId: request.Params.CustomerId, Cursor: request.Params.Cursor}
	if request.Params.Status != nil {
		status := string(*request.Params.Status)
		params.Status = &status
	}

	response, err := a.Gateway.ListSmppAccountsWithResponse(ctx, &params)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationListAccounts, err)

		switch status {
		case http.StatusUnprocessableEntity:
			return ListAccounts422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ListAccounts503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	page := ListAccounts200JSONResponse{Items: make([]SmppAccount, 0, len(response.JSON200.Data))}
	for _, account := range response.JSON200.Data {
		page.Items = append(page.Items, accountDTO(account))
	}

	if response.JSON200.HasMore {
		page.NextCursor = response.JSON200.NextCursor
	}

	return page, nil
}

func (a API) CreateAccount(ctx context.Context, request CreateAccountRequestObject,
) (CreateAccountResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	var response *gateway.CreateSmppAccountResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionAccountCreate, TargetType: auditTargetAccount,
		After: store.NewFields().Text("customer_id", request.Body.CustomerId.String()).Text("name", request.Body.Name),
	}), func(ctx context.Context, event *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.CreateSmppAccountWithResponse(ctx, gateway.CreateSmppAccountJSONRequestBody{
			CustomerId: request.Body.CustomerId, Name: request.Body.Name,
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
		status, body, err := a.relayedRefusal(ctx, operationCreateAccount, err)

		switch status {
		case http.StatusConflict:
			return CreateAccount409JSONResponse{NomDeComptePrisJSONResponse(accountNameTaken(body.Code))}, nil
		case http.StatusUnprocessableEntity:
			return CreateAccount422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return CreateAccount503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return CreateAccount201JSONResponse(accountDTO(*response.JSON201)), nil
}

func (a API) GetAccount(ctx context.Context, request GetAccountRequestObject) (GetAccountResponseObject, error) {
	id, known := parseID(request.AccountId)
	if !known {
		return GetAccount404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	response, err := a.Gateway.GetSmppAccountWithResponse(ctx, id)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.accountRefusal(ctx, operationGetAccount, err)

		switch status {
		case http.StatusNotFound:
			return GetAccount404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return GetAccount422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return GetAccount503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return GetAccount200JSONResponse(accountDTO(*response.JSON200)), nil
}

func (a API) SetAccountChannels(ctx context.Context, request SetAccountChannelsRequestObject,
) (SetAccountChannelsResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	id, known := parseID(request.AccountId)
	if !known {
		return SetAccountChannels404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	var response *gateway.SetAccountChannelsResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionAccountChannels, TargetType: auditTargetAccount, TargetID: id.String(),
		After: store.NewFields().Flag("smpp_enabled", request.Body.SmppEnabled).
			Flag("rest_enabled", request.Body.RestEnabled),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.SetAccountChannelsWithResponse(ctx, id, gateway.SetAccountChannelsJSONRequestBody{
			SmppEnabled: request.Body.SmppEnabled, RestEnabled: request.Body.RestEnabled,
		})
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
		status, body, err := a.accountRefusal(ctx, operationSetAccountChannel, err)

		switch status {
		case http.StatusNotFound:
			return SetAccountChannels404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return SetAccountChannels422JSONResponse{RefusDeLaPasserelleJSONResponse(lastChannel(body.Code))}, nil
		case http.StatusServiceUnavailable:
			return SetAccountChannels503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return SetAccountChannels200JSONResponse(accountDTO(*response.JSON200)), nil
}

func (a API) SetAccountSmppOps(ctx context.Context, request SetAccountSmppOpsRequestObject,
) (SetAccountSmppOpsResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	id, known := parseID(request.AccountId)
	if !known {
		return SetAccountSmppOps404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	var response *gateway.SetAccountSmppOpsResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionAccountSmppOps, TargetType: auditTargetAccount, TargetID: id.String(),
		After: store.NewFields().Flag("query_sm_enabled", request.Body.QuerySmEnabled).
			Flag("cancel_sm_enabled", request.Body.CancelSmEnabled),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.SetAccountSmppOpsWithResponse(ctx, id, gateway.SetAccountSmppOpsJSONRequestBody{
			QuerySmEnabled: &request.Body.QuerySmEnabled, CancelSmEnabled: &request.Body.CancelSmEnabled,
		})
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
		status, body, err := a.accountRefusal(ctx, operationSetAccountSmppOps, err)

		switch status {
		case http.StatusNotFound:
			return SetAccountSmppOps404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return SetAccountSmppOps422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return SetAccountSmppOps503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return SetAccountSmppOps200JSONResponse(accountDTO(*response.JSON200)), nil
}

func (a API) accountRefusal(ctx context.Context, operation string, err error) (int, Error, error) {
	status, body, err := a.relayedRefusal(ctx, operation, err)
	if status == http.StatusNotFound {
		body = Error{Code: body.Code, Message: unknownAccount().Message}
	}

	return status, body, err
}

func accountDTO(account gateway.SmppAccount) SmppAccount {
	return SmppAccount{
		Id:              account.Id.String(),
		CustomerId:      account.CustomerId.String(),
		Name:            account.Name,
		Status:          CustomerStatus(account.Status),
		SmppEnabled:     account.SmppEnabled,
		RestEnabled:     account.RestEnabled,
		QuerySmEnabled:  enabledByDefault(account.QuerySmEnabled),
		CancelSmEnabled: enabledByDefault(account.CancelSmEnabled),
		CreatedAt:       account.CreatedAt,
	}
}

// enabledByDefault lit un drapeau que le contrat laisse facultatif : la passerelle l'active à la
// création d'un compte (`DEFAULT true`), et c'est donc ce qu'un champ absent veut dire.
func enabledByDefault(flag *bool) bool {
	return flag == nil || *flag
}

func unknownAccount() Error {
	return Error{Code: "not_found", Message: "Aucun compte ne porte cet identifiant. Rechargez la liste."}
}

func lastChannel(code string) Error {
	return Error{
		Code:    code,
		Message: "Un compte garde au moins un canal : activez l'autre avant de couper celui-ci.",
	}
}

func accountNameTaken(code string) Error {
	const refusal = "Ce client a déjà un compte de ce nom. Choisissez-en un autre."

	return Error{
		Code: code, Message: refusal,
		Errors: &[]FieldError{{Field: "name", Message: refusal}},
	}
}

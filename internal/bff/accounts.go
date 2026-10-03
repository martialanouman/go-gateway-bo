package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	operationListAccounts  = "list-smpp-accounts"
	operationCreateAccount = "create-smpp-account"
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

func accountDTO(account gateway.SmppAccount) SmppAccount {
	return SmppAccount{
		Id:         account.Id.String(),
		CustomerId: account.CustomerId.String(),
		Name:       account.Name,
		Status:     CustomerStatus(account.Status),
		CreatedAt:  account.CreatedAt,
	}
}

func accountNameTaken(code string) Error {
	const refusal = "Ce client a déjà un compte de ce nom. Choisissez-en un autre."

	return Error{
		Code: code, Message: refusal,
		Errors: &[]FieldError{{Field: "name", Message: refusal}},
	}
}

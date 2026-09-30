package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	operationListCustomers        = "list-customers"
	operationCreateCustomer       = "create-customer"
	operationGetCustomer          = "get-customer"
	operationUpdateCustomer       = "update-customer"
	operationSetCustomerGroup     = "set-customer-group"
	operationSuspendCustomer      = "suspend-customer"
	operationListCustomerAccounts = "list-customer-accounts"
)

func (a API) ListCustomers(ctx context.Context, request ListCustomersRequestObject,
) (ListCustomersResponseObject, error) {
	params := gateway.ListCustomersParams{GroupId: request.Params.GroupId, Cursor: request.Params.Cursor}
	if request.Params.Status != nil {
		status := string(*request.Params.Status)
		params.Status = &status
	}

	response, err := a.Gateway.ListCustomersWithResponse(ctx, &params)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationListCustomers, err)

		switch status {
		case http.StatusUnprocessableEntity:
			return ListCustomers422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ListCustomers503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	page := ListCustomers200JSONResponse{Items: make([]Customer, 0, len(response.JSON200.Data))}
	for _, customer := range response.JSON200.Data {
		page.Items = append(page.Items, customerDTO(customer))
	}

	if response.JSON200.HasMore {
		page.NextCursor = response.JSON200.NextCursor
	}

	return page, nil
}

func (a API) CreateCustomer(ctx context.Context, request CreateCustomerRequestObject,
) (CreateCustomerResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	after := store.NewFields().Text("name", request.Body.Name)
	if request.Body.GroupId != nil {
		after.Text("group_id", request.Body.GroupId.String())
	}

	var response *gateway.CreateCustomerResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionCustomerCreate, TargetType: auditTargetCustomer, After: after,
	}), func(ctx context.Context, event *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.CreateCustomerWithResponse(ctx, gateway.CreateCustomerJSONRequestBody{
			Name: request.Body.Name, GroupId: request.Body.GroupId,
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
		status, body, err := a.relayedRefusal(ctx, operationCreateCustomer, err)

		switch status {
		case http.StatusUnprocessableEntity:
			return CreateCustomer422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return CreateCustomer503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return CreateCustomer201JSONResponse(customerDTO(*response.JSON201)), nil
}

func (a API) GetCustomer(ctx context.Context, request GetCustomerRequestObject,
) (GetCustomerResponseObject, error) {
	id, known := parseID(request.CustomerId)
	if !known {
		return GetCustomer404JSONResponse{ClientInconnuJSONResponse(unknownCustomer())}, nil
	}

	response, err := a.Gateway.GetCustomerWithResponse(ctx, id)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.customerRefusal(ctx, operationGetCustomer, err)

		switch status {
		case http.StatusNotFound:
			return GetCustomer404JSONResponse{ClientInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return GetCustomer422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return GetCustomer503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return GetCustomer200JSONResponse(customerDTO(*response.JSON200)), nil
}

func (a API) UpdateCustomer(ctx context.Context, request UpdateCustomerRequestObject,
) (UpdateCustomerResponseObject, error) {
	id, known := parseID(request.CustomerId)
	if !known {
		return UpdateCustomer404JSONResponse{ClientInconnuJSONResponse(unknownCustomer())}, nil
	}

	var response *gateway.UpdateCustomerResponse

	err := a.relayCustomerChange(ctx, actionCustomerUpdate, id, store.NewFields().Text("name", request.Body.Name),
		func(ctx context.Context) (int, error) {
			var callErr error

			response, callErr = a.Gateway.UpdateCustomerWithResponse(ctx, id,
				gateway.UpdateCustomerJSONRequestBody{Name: &request.Body.Name})
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
		status, body, err := a.customerRefusal(ctx, operationUpdateCustomer, err)

		switch status {
		case http.StatusNotFound:
			return UpdateCustomer404JSONResponse{ClientInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return UpdateCustomer422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return UpdateCustomer503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return UpdateCustomer200JSONResponse(customerDTO(*response.JSON200)), nil
}

func (a API) SetCustomerGroup(ctx context.Context, request SetCustomerGroupRequestObject,
) (SetCustomerGroupResponseObject, error) {
	id, known := parseID(request.CustomerId)
	if !known {
		return SetCustomerGroup404JSONResponse{ClientInconnuJSONResponse(unknownCustomer())}, nil
	}

	groupID := ""
	if request.Body.GroupId != nil {
		groupID = request.Body.GroupId.String()
	}

	var response *gateway.SetCustomerGroupResponse

	err := a.relayCustomerChange(ctx, actionCustomerGroup, id, store.NewFields().Text("group_id", groupID), func(ctx context.Context) (int, error) {
		var callErr error

		response, callErr = a.Gateway.SetCustomerGroupWithResponse(ctx, id,
			gateway.SetCustomerGroupJSONRequestBody{GroupId: request.Body.GroupId})
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
		status, body, err := a.customerRefusal(ctx, operationSetCustomerGroup, err)

		switch status {
		case http.StatusNotFound:
			return SetCustomerGroup404JSONResponse{ClientInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return SetCustomerGroup422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return SetCustomerGroup503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return SetCustomerGroup200JSONResponse(customerDTO(*response.JSON200)), nil
}

func (a API) GetCustomerSuspensionImpact(ctx context.Context, request GetCustomerSuspensionImpactRequestObject,
) (GetCustomerSuspensionImpactResponseObject, error) {
	id, known := parseID(request.CustomerId)
	if !known {
		return GetCustomerSuspensionImpact404JSONResponse{ClientInconnuJSONResponse(unknownCustomer())}, nil
	}

	response, err := a.Gateway.ListCustomerAccountsWithResponse(ctx, id)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.customerRefusal(ctx, operationListCustomerAccounts, err)

		switch status {
		case http.StatusNotFound:
			return GetCustomerSuspensionImpact404JSONResponse{ClientInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return GetCustomerSuspensionImpact422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return GetCustomerSuspensionImpact503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return GetCustomerSuspensionImpact200JSONResponse(suspensionImpact(*response.JSON200)), nil
}

func suspensionImpact(accounts []gateway.SmppAccount) SuspensionImpact {
	impact := SuspensionImpact{Accounts: len(accounts)}
	for _, account := range accounts {
		switch account.Status {
		case gateway.SmppAccountStatusActive:
			impact.ActiveAccounts++
		case gateway.SmppAccountStatusClosed:
			impact.ClosedAccounts++
		case gateway.SmppAccountStatusSuspended:
		}
	}

	return impact
}

func (a API) SuspendCustomer(ctx context.Context, request SuspendCustomerRequestObject,
) (SuspendCustomerResponseObject, error) {
	id, known := parseID(request.CustomerId)
	if !known {
		return SuspendCustomer404JSONResponse{ClientInconnuJSONResponse(unknownCustomer())}, nil
	}

	var response *gateway.SuspendCustomerResponse

	err := a.relayCustomerChange(ctx, actionCustomerSuspend, id, store.NewFields(),
		func(ctx context.Context) (int, error) {
			var callErr error

			response, callErr = a.Gateway.SuspendCustomerWithResponse(ctx, id)
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
		status, body, err := a.customerRefusal(ctx, operationSuspendCustomer, err)

		switch status {
		case http.StatusNotFound:
			return SuspendCustomer404JSONResponse{ClientInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return SuspendCustomer422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return SuspendCustomer503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return SuspendCustomer200JSONResponse(customerDTO(*response.JSON200)), nil
}

func (a API) ReactivateCustomer(ctx context.Context, request ReactivateCustomerRequestObject,
) (ReactivateCustomerResponseObject, error) {
	id, known := parseID(request.CustomerId)
	if !known {
		return ReactivateCustomer404JSONResponse{ClientInconnuJSONResponse(unknownCustomer())}, nil
	}

	var response *gateway.UpdateCustomerResponse

	err := a.relayCustomerChange(ctx, actionCustomerReactivate, id, store.NewFields(),
		func(ctx context.Context) (int, error) {
			active := gateway.CustomerUpdateStatusActive

			var callErr error

			response, callErr = a.Gateway.UpdateCustomerWithResponse(ctx, id,
				gateway.UpdateCustomerJSONRequestBody{Status: &active})
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
		status, body, err := a.customerRefusal(ctx, operationUpdateCustomer, err)

		switch status {
		case http.StatusNotFound:
			return ReactivateCustomer404JSONResponse{ClientInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return ReactivateCustomer422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ReactivateCustomer503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return ReactivateCustomer200JSONResponse(customerDTO(*response.JSON200)), nil
}

func (a API) relayCustomerChange(ctx context.Context, action string, id gateway.Id, after *store.Fields,
	call func(context.Context) (int, error),
) error {
	actor, err := actorOf(ctx)
	if err != nil {
		return err
	}

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: action, TargetType: auditTargetCustomer, TargetID: id.String(), After: after,
	}), func(ctx context.Context, _ *store.Event) (int, error) { return call(ctx) })

	return err
}

// customerRefusal rédige en français le 404 : la passerelle l'écrit en anglais.
func (a API) customerRefusal(ctx context.Context, operation string, err error) (int, Error, error) {
	status, body, err := a.relayedRefusal(ctx, operation, err)
	if status == http.StatusNotFound {
		body = Error{Code: body.Code, Message: unknownCustomer().Message}
	}

	return status, body, err
}

func unknownCustomer() Error {
	return Error{Code: "not_found", Message: "Aucun client ne porte cet identifiant. Rechargez la liste."}
}

func customerDTO(customer gateway.Customer) Customer {
	dto := Customer{
		Id:        customer.Id.String(),
		Name:      customer.Name,
		Status:    CustomerStatus(customer.Status),
		CreatedAt: customer.CreatedAt,
		UpdatedAt: customer.UpdatedAt,
	}

	if customer.GroupId != nil {
		group := customer.GroupId.String()
		dto.GroupId = &group
	}

	return dto
}

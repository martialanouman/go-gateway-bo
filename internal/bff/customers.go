package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	operationListCustomers  = "list-customers"
	operationCreateCustomer = "create-customer"
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

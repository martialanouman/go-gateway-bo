package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

const operationListCustomerGroups = "list-customer-groups"

func (a API) ListCustomerGroups(ctx context.Context, request ListCustomerGroupsRequestObject,
) (ListCustomerGroupsResponseObject, error) {
	var params gateway.ListCustomerGroupsParams
	if request.Params.Status != nil {
		status := string(*request.Params.Status)
		params.Status = &status
	}

	response, err := a.Gateway.ListCustomerGroupsWithResponse(ctx, &params)
	if err != nil {
		return nil, err
	}

	if err = gateway.ErrorFrom(response.StatusCode(), response.Body); err != nil {
		return a.refusedListing(ctx, err)
	}

	if response.JSON200 == nil {
		return nil, gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	groups := make(ListCustomerGroups200JSONResponse, 0, len(*response.JSON200))
	for _, group := range *response.JSON200 {
		groups = append(groups, CustomerGroup{
			Id:          group.Id.String(),
			Name:        group.Name,
			Description: group.Description,
			Status:      CustomerGroupStatus(group.Status),
			CreatedAt:   group.CreatedAt,
			UpdatedAt:   group.UpdatedAt,
		})
	}

	return groups, nil
}

func (a API) refusedListing(ctx context.Context, err error) (ListCustomerGroupsResponseObject, error) {
	status, body, relayed := relayError(err)
	if relayed && status >= http.StatusInternalServerError {
		a.Logger.WarnContext(ctx, "la passerelle a échoué", "operation", operationListCustomerGroups, "error", err)
	}

	switch {
	case relayed && status == http.StatusUnprocessableEntity:
		return ListCustomerGroups422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
	case relayed && status == http.StatusServiceUnavailable:
		return ListCustomerGroups503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
	default:
		return nil, err
	}
}

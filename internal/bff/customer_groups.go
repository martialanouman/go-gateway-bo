package bff

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	operationListCustomerGroups  = "list-customer-groups"
	operationCreateCustomerGroup = "create-customer-group"
	operationGetCustomerGroup    = "get-customer-group"
	operationUpdateCustomerGroup = "update-customer-group"
	operationDeleteCustomerGroup = "delete-customer-group"
)

func (a API) ListCustomerGroups(ctx context.Context, request ListCustomerGroupsRequestObject,
) (ListCustomerGroupsResponseObject, error) {
	var params gateway.ListCustomerGroupsParams
	if request.Params.Status != nil {
		status := string(*request.Params.Status)
		params.Status = &status
	}

	response, err := a.Gateway.ListCustomerGroupsWithResponse(ctx, &params)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationListCustomerGroups, err)

		switch status {
		case http.StatusUnprocessableEntity:
			return ListCustomerGroups422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ListCustomerGroups503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	groups := make(ListCustomerGroups200JSONResponse, 0, len(*response.JSON200))
	for _, group := range *response.JSON200 {
		groups = append(groups, customerGroupDTO(group))
	}

	return groups, nil
}

func (a API) CreateCustomerGroup(ctx context.Context, request CreateCustomerGroupRequestObject,
) (CreateCustomerGroupResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	description := request.Body.Description
	if description != nil && strings.TrimSpace(*description) == "" {
		description = nil
	}

	after := store.NewFields().Text("name", request.Body.Name)
	if description != nil {
		after.Text("description", *description)
	}

	var response *gateway.CreateCustomerGroupResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionGroupCreate, TargetType: auditTargetCustomerGroup, After: after,
	}), func(ctx context.Context, event *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.CreateCustomerGroupWithResponse(ctx, gateway.CreateCustomerGroupJSONRequestBody{
			Name: request.Body.Name, Description: description,
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
		status, body, err := a.relayedRefusal(ctx, operationCreateCustomerGroup, err)

		switch status {
		case http.StatusConflict:
			return CreateCustomerGroup409JSONResponse{NomDeGroupePrisJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return CreateCustomerGroup422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return CreateCustomerGroup503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return CreateCustomerGroup201JSONResponse(customerGroupDTO(*response.JSON201)), nil
}

func (a API) GetCustomerGroup(ctx context.Context, request GetCustomerGroupRequestObject,
) (GetCustomerGroupResponseObject, error) {
	id, known := groupID(request.GroupId)
	if !known {
		return GetCustomerGroup404JSONResponse{GroupeInconnuJSONResponse(unknownGroup())}, nil
	}

	response, err := a.Gateway.GetCustomerGroupWithResponse(ctx, id)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationGetCustomerGroup, err)

		switch status {
		case http.StatusNotFound:
			return GetCustomerGroup404JSONResponse{GroupeInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return GetCustomerGroup422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return GetCustomerGroup503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return GetCustomerGroup200JSONResponse(customerGroupDTO(*response.JSON200)), nil
}

func (a API) UpdateCustomerGroup(ctx context.Context, request UpdateCustomerGroupRequestObject,
) (UpdateCustomerGroupResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	id, known := groupID(request.GroupId)
	if !known {
		return UpdateCustomerGroup404JSONResponse{GroupeInconnuJSONResponse(unknownGroup())}, nil
	}

	if refusal, refused := descriptionCleared(request.Body.Description); refused {
		return UpdateCustomerGroup422JSONResponse{RefusDeLaPasserelleJSONResponse(refusal)}, nil
	}

	patch := gateway.UpdateCustomerGroupJSONRequestBody{
		Name: request.Body.Name, Description: request.Body.Description,
	}
	after := store.NewFields()

	if request.Body.Name != nil {
		after.Text("name", *request.Body.Name)
	}

	if request.Body.Description != nil {
		after.Text("description", *request.Body.Description)
	}

	if request.Body.Status != nil {
		status := gateway.CustomerGroupUpdateStatus(*request.Body.Status)
		patch.Status = &status
		after.Text("status", string(status))
	}

	var response *gateway.UpdateCustomerGroupResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionGroupUpdate, TargetType: auditTargetCustomerGroup,
		TargetID: request.GroupId, After: after,
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.UpdateCustomerGroupWithResponse(ctx, id, patch)
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
		status, body, err := a.relayedRefusal(ctx, operationUpdateCustomerGroup, err)

		switch status {
		case http.StatusNotFound:
			return UpdateCustomerGroup404JSONResponse{GroupeInconnuJSONResponse(body)}, nil
		case http.StatusConflict:
			return UpdateCustomerGroup409JSONResponse{NomDeGroupePrisJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return UpdateCustomerGroup422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return UpdateCustomerGroup503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return UpdateCustomerGroup200JSONResponse(customerGroupDTO(*response.JSON200)), nil
}

func (a API) DeleteCustomerGroup(ctx context.Context, request DeleteCustomerGroupRequestObject,
) (DeleteCustomerGroupResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	id, known := groupID(request.GroupId)
	if !known {
		return DeleteCustomerGroup404JSONResponse{GroupeInconnuJSONResponse(unknownGroup())}, nil
	}

	var response *gateway.DeleteCustomerGroupResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionGroupDelete, TargetType: auditTargetCustomerGroup,
		TargetID: request.GroupId,
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.DeleteCustomerGroupWithResponse(ctx, id)
		if callErr != nil {
			return 0, callErr
		}

		return response.StatusCode(), nil
	})
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationDeleteCustomerGroup, err)

		switch status {
		case http.StatusNotFound:
			return DeleteCustomerGroup404JSONResponse{GroupeInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return DeleteCustomerGroup422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return DeleteCustomerGroup503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return DeleteCustomerGroup204Response{}, nil
}

// relayedRefusal traduit l'échec d'une opération de groupe. Un statut nul rend `err` à l'appelant,
// qui le laisse devenir un 500 journalisé ; tout autre statut vient avec le corps à servir. 404 et 409
// sont rédigés ici, en français : la passerelle les écrit en anglais et sans nommer le geste.
func (a API) relayedRefusal(ctx context.Context, operation string, err error) (int, Error, error) {
	status, body, relayed := relayError(err)
	if !relayed {
		return 0, Error{}, err
	}

	if status >= http.StatusInternalServerError {
		a.Logger.WarnContext(ctx, "la passerelle a échoué", "operation", operation, "error", err)
	}

	switch status {
	case http.StatusNotFound:
		body = Error{Code: body.Code, Message: unknownGroup().Message}
	case http.StatusConflict:
		body = groupNameTaken(body.Code)
	}

	return status, body, err
}

func customerGroupDTO(group gateway.CustomerGroup) CustomerGroup {
	return CustomerGroup{
		Id:          group.Id.String(),
		Name:        group.Name,
		Description: group.Description,
		Status:      CustomerGroupStatus(group.Status),
		CreatedAt:   group.CreatedAt,
		UpdatedAt:   group.UpdatedAt,
	}
}

// groupID refuse un identifiant qui n'est pas un UUID avant tout appel : la passerelle le refuserait
// en 422 sur le format, là où, pour l'opérateur, c'est un groupe qui n'existe pas.
func groupID(raw string) (gateway.Id, bool) {
	id, err := uuid.Parse(raw)

	return id, err == nil
}

// descriptionCleared refuse une description vide : la passerelle lit `null` comme « ne change pas »
// (dette `patch-null-ne-peut-pas-effacer-un-champ` de go-gateway), et une chaîne vide passerait pour
// un effacement qu'elle ne sait pas faire proprement.
func descriptionCleared(description *string) (Error, bool) {
	if description == nil || strings.TrimSpace(*description) != "" {
		return Error{}, false
	}

	const refusal = "Une description ne peut pas être vidée : la passerelle ne sait pas encore effacer " +
		"ce champ. Remplacez-la par un autre texte, ou laissez-la telle quelle."

	return Error{
		Code: "description_not_clearable", Message: refusal,
		Errors: &[]FieldError{{Field: "description", Message: refusal}},
	}, true
}

func unknownGroup() Error {
	return Error{Code: "not_found", Message: "Aucun groupe ne porte cet identifiant. Rechargez la liste."}
}

func groupNameTaken(code string) Error {
	const refusal = "Un autre groupe porte déjà ce nom. Choisissez-en un autre."

	return Error{
		Code: code, Message: refusal,
		Errors: &[]FieldError{{Field: "name", Message: refusal}},
	}
}

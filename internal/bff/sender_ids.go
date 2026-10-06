package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	operationListSenderIDs  = "list-sender-ids"
	operationCreateSenderID = "create-sender-id"
	operationUpdateSenderID = "update-sender-id"
	operationDeleteSenderID = "delete-sender-id"
)

func (a API) ListSenderIds(ctx context.Context, request ListSenderIdsRequestObject,
) (ListSenderIdsResponseObject, error) {
	customerID, known := parseID(request.CustomerId)
	if !known {
		return ListSenderIds404JSONResponse{ClientInconnuJSONResponse(unknownCustomer())}, nil
	}

	response, err := a.Gateway.ListSenderIdsWithResponse(ctx, customerID, nil)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.customerRefusal(ctx, operationListSenderIDs, err)

		switch status {
		case http.StatusNotFound:
			return ListSenderIds404JSONResponse{ClientInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return ListSenderIds422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ListSenderIds503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	senders := make(ListSenderIds200JSONResponse, 0, len(*response.JSON200))
	for _, sender := range *response.JSON200 {
		senders = append(senders, senderIDDTO(sender))
	}

	return senders, nil
}

func (a API) CreateSenderId(ctx context.Context, request CreateSenderIdRequestObject,
) (CreateSenderIdResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	customerID, known := parseID(request.CustomerId)
	if !known {
		return CreateSenderId422JSONResponse{RefusDeLaPasserelleJSONResponse(unknownCustomer())}, nil
	}

	var response *gateway.CreateSenderIdResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionSenderIDCreate, TargetType: auditTargetSenderID,
		After: store.NewFields().Text("customer_id", customerID.String()).Text("address", request.Body.Address),
	}), func(ctx context.Context, event *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.CreateSenderIdWithResponse(ctx, customerID,
			gateway.CreateSenderIdJSONRequestBody{Address: request.Body.Address})
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
		status, body, err := a.relayedRefusal(ctx, operationCreateSenderID, err)

		switch status {
		case http.StatusConflict:
			return CreateSenderId409JSONResponse{SenderIdPrisJSONResponse(senderAddressTaken(body.Code))}, nil
		case http.StatusUnprocessableEntity:
			return CreateSenderId422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return CreateSenderId503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return CreateSenderId201JSONResponse(senderIDDTO(*response.JSON201)), nil
}

func (a API) UpdateSenderId(ctx context.Context, request UpdateSenderIdRequestObject,
) (UpdateSenderIdResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	customerID, senderID, known := parseSenderPath(request.CustomerId, request.SenderId)
	if !known {
		return UpdateSenderId404JSONResponse{SenderIdInconnuJSONResponse(unknownSenderID())}, nil
	}

	status := gateway.SenderIdUpdateStatus(request.Body.Status)

	var response *gateway.UpdateSenderIdResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionSenderIDUpdate, TargetType: auditTargetSenderID, TargetID: senderID.String(),
		After: store.NewFields().Text("customer_id", customerID.String()).Text("status", string(status)),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.UpdateSenderIdWithResponse(ctx, customerID, senderID,
			gateway.UpdateSenderIdJSONRequestBody{Status: &status})
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
		status, body, err := a.senderIDRefusal(ctx, operationUpdateSenderID, err)

		switch status {
		case http.StatusNotFound:
			return UpdateSenderId404JSONResponse{SenderIdInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return UpdateSenderId422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return UpdateSenderId503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return UpdateSenderId200JSONResponse(senderIDDTO(*response.JSON200)), nil
}

func (a API) DeleteSenderId(ctx context.Context, request DeleteSenderIdRequestObject,
) (DeleteSenderIdResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	customerID, senderID, known := parseSenderPath(request.CustomerId, request.SenderId)
	if !known {
		return DeleteSenderId404JSONResponse{SenderIdInconnuJSONResponse(unknownSenderID())}, nil
	}

	var response *gateway.DeleteSenderIdResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionSenderIDDelete, TargetType: auditTargetSenderID, TargetID: senderID.String(),
		After: store.NewFields().Text("customer_id", customerID.String()),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.DeleteSenderIdWithResponse(ctx, customerID, senderID)
		if callErr != nil {
			return 0, callErr
		}

		return response.StatusCode(), nil
	})
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err != nil {
		status, body, err := a.senderIDRefusal(ctx, operationDeleteSenderID, err)

		switch status {
		case http.StatusNotFound:
			return DeleteSenderId404JSONResponse{SenderIdInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return DeleteSenderId422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return DeleteSenderId503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return DeleteSenderId204Response{}, nil
}

func (a API) senderIDRefusal(ctx context.Context, operation string, err error) (int, Error, error) {
	status, body, err := a.relayedRefusal(ctx, operation, err)
	if status == http.StatusNotFound {
		body = Error{Code: body.Code, Message: unknownSenderID().Message}
	}

	return status, body, err
}

func parseSenderPath(rawCustomer, rawSender string) (gateway.Id, gateway.SenderIdPathParam, bool) {
	customerID, customerKnown := parseID(rawCustomer)
	senderID, senderKnown := parseID(rawSender)

	return customerID, senderID, customerKnown && senderKnown
}

func senderIDDTO(sender gateway.SenderId) SenderId {
	return SenderId{
		Id:        sender.Id.String(),
		Address:   sender.Address,
		Status:    SenderIdStatus(sender.Status),
		CreatedAt: sender.CreatedAt,
	}
}

func unknownSenderID() Error {
	return Error{Code: "not_found", Message: "Ce client n'a aucun nom d'expéditeur de cet identifiant. Rechargez la fiche."}
}

func senderAddressTaken(code string) Error {
	const refusal = "Ce client a déjà enregistré ce nom. Retrouvez-le dans la liste de ses noms d'expéditeur."

	return Error{
		Code: code, Message: refusal,
		Errors: &[]FieldError{{Field: "address", Message: refusal}},
	}
}

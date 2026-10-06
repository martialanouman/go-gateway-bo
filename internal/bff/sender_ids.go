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

	operationSetSenderIDRateLimit    = "set-sender-id-rate-limit"
	operationDeleteSenderIDRateLimit = "delete-sender-id-rate-limit"
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

	change := gateway.UpdateSenderIdJSONRequestBody{}
	after := store.NewFields().Text("customer_id", customerID.String())

	var before *store.Fields

	if request.Body.Status != nil {
		status := gateway.SenderIdUpdateStatus(*request.Body.Status)
		change.Status = &status
		after = after.Text("status", string(status))
	}

	if request.Body.TrafficCategory != nil {
		category := gateway.TrafficCategory(*request.Body.TrafficCategory)
		change.TrafficCategory = &category
		after = after.Text("traffic_category", string(category))

		current, found, err := a.senderIDCategory(ctx, customerID, senderID)
		if err == nil && !found {
			return UpdateSenderId404JSONResponse{SenderIdInconnuJSONResponse(unknownSenderID())}, nil
		}

		if err != nil {
			return updateSenderIDRefusal(a.senderIDRefusal(ctx, operationListSenderIDs, err))
		}

		before = store.NewFields().Text("traffic_category", string(current))
	}

	var response *gateway.UpdateSenderIdResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionSenderIDUpdate, TargetType: auditTargetSenderID, TargetID: senderID.String(),
		Before: before, After: after,
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.UpdateSenderIdWithResponse(ctx, customerID, senderID, change)
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
		return updateSenderIDRefusal(a.senderIDRefusal(ctx, operationUpdateSenderID, err))
	}

	return UpdateSenderId200JSONResponse(senderIDDTO(*response.JSON200)), nil
}

func updateSenderIDRefusal(status int, body Error, err error) (UpdateSenderIdResponseObject, error) {
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

// senderIDCategory relit la catégorie en amont : l'audit garde celle que le sender ID quitte, et le
// navigateur n'a pas autorité pour la dire.
func (a API) senderIDCategory(ctx context.Context, customerID gateway.Id, senderID gateway.SenderIdPathParam,
) (gateway.TrafficCategory, bool, error) {
	response, err := a.Gateway.ListSenderIdsWithResponse(ctx, customerID, nil)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		return "", false, err
	}

	for _, sender := range *response.JSON200 {
		if sender.Id == senderID {
			return sender.TrafficCategory, true, nil
		}
	}

	return "", false, nil
}

func (a API) SetSenderIdRateLimit(ctx context.Context, request SetSenderIdRateLimitRequestObject,
) (SetSenderIdRateLimitResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	customerID, senderID, known := parseSenderPath(request.CustomerId, request.SenderId)
	if !known {
		return SetSenderIdRateLimit404JSONResponse{SenderIdInconnuJSONResponse(unknownSenderID())}, nil
	}

	limit := gateway.SetSenderIdRateLimitJSONRequestBody{
		MaxPerSec: request.Body.MaxPerSec, BurstCapacity: request.Body.BurstCapacity,
	}

	after := store.NewFields().Text("customer_id", customerID.String()).Number("max_per_sec", limit.MaxPerSec)
	if limit.BurstCapacity != nil {
		after = after.Number("burst_capacity", *limit.BurstCapacity)
	}

	var response *gateway.SetSenderIdRateLimitResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionSenderIDRateLimit, TargetType: auditTargetSenderID, TargetID: senderID.String(),
		After: after,
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.SetSenderIdRateLimitWithResponse(ctx, customerID, senderID, limit)
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
		status, body, err := a.senderIDRefusal(ctx, operationSetSenderIDRateLimit, err)

		switch status {
		case http.StatusNotFound:
			return SetSenderIdRateLimit404JSONResponse{SenderIdInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return SetSenderIdRateLimit422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return SetSenderIdRateLimit503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return SetSenderIdRateLimit200JSONResponse(senderIDDTO(*response.JSON200)), nil
}

func (a API) DeleteSenderIdRateLimit(ctx context.Context, request DeleteSenderIdRateLimitRequestObject,
) (DeleteSenderIdRateLimitResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	customerID, senderID, known := parseSenderPath(request.CustomerId, request.SenderId)
	if !known {
		return DeleteSenderIdRateLimit404JSONResponse{SenderIdInconnuJSONResponse(unknownSenderID())}, nil
	}

	var response *gateway.DeleteSenderIdRateLimitResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionSenderIDRateLimit, TargetType: auditTargetSenderID, TargetID: senderID.String(),
		After: store.NewFields().Text("customer_id", customerID.String()).Text("rate_limit", "removed"),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.DeleteSenderIdRateLimitWithResponse(ctx, customerID, senderID)
		if callErr != nil {
			return 0, callErr
		}

		return response.StatusCode(), nil
	})
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err != nil {
		status, body, err := a.senderIDRefusal(ctx, operationDeleteSenderIDRateLimit, err)

		switch status {
		case http.StatusNotFound:
			return DeleteSenderIdRateLimit404JSONResponse{SenderIdInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return DeleteSenderIdRateLimit422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return DeleteSenderIdRateLimit503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return DeleteSenderIdRateLimit204Response{}, nil
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
		case http.StatusConflict:
			return DeleteSenderId409JSONResponse{SenderIdDejaUtiliseJSONResponse(senderIDAlreadyUsed(body.Code))}, nil
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
	dto := SenderId{
		Id:                          sender.Id.String(),
		Address:                     sender.Address,
		Status:                      SenderIdStatus(sender.Status),
		TrafficCategory:             TrafficCategory(sender.TrafficCategory),
		RecentCategoryMismatches24h: sender.RecentCategoryMismatches24h,
		FirstUsedAt:                 sender.FirstUsedAt,
		CreatedAt:                   sender.CreatedAt,
	}

	if sender.RateLimit != nil {
		dto.RateLimit = &SenderIdRateLimit{
			MaxPerSec: sender.RateLimit.MaxPerSec, BurstCapacity: sender.RateLimit.BurstCapacity,
		}
	}

	return dto
}

func senderIDAlreadyUsed(code string) Error {
	return Error{Code: code, Message: "Ce nom a déjà servi à envoyer : il ne se supprime plus, désactivez-le plutôt."}
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

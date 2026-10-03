package bff

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const (
	operationListWebhooks  = "list-webhooks"
	operationCreateWebhook = "create-webhook"
	operationUpdateWebhook = "update-webhook"
	operationDeleteWebhook = "delete-webhook"
)

// webhookSecretBytes vaut la sortie de SHA-256, avec quoi la passerelle signe en HMAC : la RFC 2104
// déconseille une clé plus courte que l'empreinte.
const webhookSecretBytes = 32

func (a API) ListWebhooks(ctx context.Context, request ListWebhooksRequestObject) (ListWebhooksResponseObject, error) {
	accountID, known := parseID(request.AccountId)
	if !known {
		return ListWebhooks404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	response, err := a.Gateway.ListWebhooksWithResponse(ctx, accountID)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.accountRefusal(ctx, operationListWebhooks, err)

		switch status {
		case http.StatusNotFound:
			return ListWebhooks404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return ListWebhooks422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return ListWebhooks503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	webhooks := make(ListWebhooks200JSONResponse, 0, len(*response.JSON200))
	for _, webhook := range *response.JSON200 {
		webhooks = append(webhooks, webhookDTO(webhook))
	}

	return webhooks, nil
}

func (a API) CreateWebhook(ctx context.Context, request CreateWebhookRequestObject,
) (CreateWebhookResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	accountID, known := parseID(request.AccountId)
	if !known {
		return CreateWebhook404JSONResponse{CompteInconnuJSONResponse(unknownAccount())}, nil
	}

	secret, err := newWebhookSecret()
	if err != nil {
		return nil, err
	}

	var response *gateway.CreateWebhookResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionWebhookCreate, TargetType: auditTargetWebhook,
		After: store.NewFields().Text("account_id", accountID.String()).
			Text("event_type", string(request.Body.EventType)).Text("url", request.Body.Url),
	}), func(ctx context.Context, event *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.CreateWebhookWithResponse(ctx, accountID, gateway.CreateWebhookJSONRequestBody{
			EventType: gateway.WebhookCreateEventType(request.Body.EventType), Url: request.Body.Url, Secret: secret,
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
		status, body, err := a.accountRefusal(ctx, operationCreateWebhook, err)

		switch status {
		case http.StatusNotFound:
			return CreateWebhook404JSONResponse{CompteInconnuJSONResponse(body)}, nil
		case http.StatusConflict:
			return CreateWebhook409JSONResponse{TypeDeWebhookPrisJSONResponse(webhookEventTaken(body.Code))}, nil
		case http.StatusUnprocessableEntity:
			return CreateWebhook422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return CreateWebhook503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return CreateWebhook201JSONResponse{Webhook: webhookDTO(*response.JSON201), Secret: secret}, nil
}

func (a API) UpdateWebhook(ctx context.Context, request UpdateWebhookRequestObject,
) (UpdateWebhookResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	accountID, webhookID, known := parseWebhookPath(request.AccountId, request.WebhookId)
	if !known {
		return UpdateWebhook404JSONResponse{WebhookInconnuJSONResponse(unknownWebhook())}, nil
	}

	update := gateway.UpdateWebhookJSONRequestBody{Url: request.Body.Url}
	after := store.NewFields().Text("account_id", accountID.String())

	if request.Body.Url != nil {
		after = after.Text("url", *request.Body.Url)
	}

	if request.Body.Status != nil {
		status := gateway.WebhookUpdateStatus(*request.Body.Status)
		update.Status = &status
		after = after.Text("status", string(status))
	}

	var response *gateway.UpdateWebhookResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionWebhookUpdate, TargetType: auditTargetWebhook, TargetID: webhookID.String(),
		After: after,
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.UpdateWebhookWithResponse(ctx, accountID, webhookID, update)
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
		status, body, err := a.webhookRefusal(ctx, operationUpdateWebhook, err)

		switch status {
		case http.StatusNotFound:
			return UpdateWebhook404JSONResponse{WebhookInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return UpdateWebhook422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return UpdateWebhook503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return UpdateWebhook200JSONResponse(webhookDTO(*response.JSON200)), nil
}

func (a API) RotateWebhookSecret(ctx context.Context, request RotateWebhookSecretRequestObject,
) (RotateWebhookSecretResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	accountID, webhookID, known := parseWebhookPath(request.AccountId, request.WebhookId)
	if !known {
		return RotateWebhookSecret404JSONResponse{WebhookInconnuJSONResponse(unknownWebhook())}, nil
	}

	secret, err := newWebhookSecret()
	if err != nil {
		return nil, err
	}

	var response *gateway.UpdateWebhookResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionWebhookRotate, TargetType: auditTargetWebhook, TargetID: webhookID.String(),
		After: store.NewFields().Text("account_id", accountID.String()),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.UpdateWebhookWithResponse(ctx, accountID, webhookID,
			gateway.UpdateWebhookJSONRequestBody{Secret: &secret})
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
		status, body, err := a.webhookRefusal(ctx, operationUpdateWebhook, err)

		switch status {
		case http.StatusNotFound:
			return RotateWebhookSecret404JSONResponse{WebhookInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return RotateWebhookSecret422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return RotateWebhookSecret503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return RotateWebhookSecret200JSONResponse{Webhook: webhookDTO(*response.JSON200), Secret: secret}, nil
}

func (a API) DeleteWebhook(ctx context.Context, request DeleteWebhookRequestObject,
) (DeleteWebhookResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	accountID, webhookID, known := parseWebhookPath(request.AccountId, request.WebhookId)
	if !known {
		return DeleteWebhook404JSONResponse{WebhookInconnuJSONResponse(unknownWebhook())}, nil
	}

	var response *gateway.DeleteWebhookResponse

	_, err = auditRelayed(ctx, a.Audit.Record, a.Logger, a.event(ctx, store.Event{
		OperatorID: actor, Action: actionWebhookDelete, TargetType: auditTargetWebhook, TargetID: webhookID.String(),
		After: store.NewFields().Text("account_id", accountID.String()),
	}), func(ctx context.Context, _ *store.Event) (int, error) {
		var callErr error

		response, callErr = a.Gateway.DeleteWebhookWithResponse(ctx, accountID, webhookID)
		if callErr != nil {
			return 0, callErr
		}

		return response.StatusCode(), nil
	})
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err != nil {
		status, body, err := a.webhookRefusal(ctx, operationDeleteWebhook, err)

		switch status {
		case http.StatusNotFound:
			return DeleteWebhook404JSONResponse{WebhookInconnuJSONResponse(body)}, nil
		case http.StatusUnprocessableEntity:
			return DeleteWebhook422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return DeleteWebhook503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	return DeleteWebhook204Response{}, nil
}

func (a API) webhookRefusal(ctx context.Context, operation string, err error) (int, Error, error) {
	status, body, err := a.relayedRefusal(ctx, operation, err)
	if status == http.StatusNotFound {
		body = Error{Code: body.Code, Message: unknownWebhook().Message}
	}

	return status, body, err
}

// newWebhookSecret : le secret ne vit que dans la requête vers la passerelle et dans la réponse au
// navigateur, jamais dans un journal ni une base (invariant b).
func newWebhookSecret() (string, error) {
	secret := make([]byte, webhookSecretBytes)
	if _, err := rand.Read(secret); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(secret), nil
}

func parseWebhookPath(rawAccount, rawWebhook string) (gateway.Id, gateway.Id, bool) {
	accountID, accountKnown := parseID(rawAccount)
	webhookID, webhookKnown := parseID(rawWebhook)

	return accountID, webhookID, accountKnown && webhookKnown
}

func webhookDTO(webhook gateway.Webhook) Webhook {
	return Webhook{
		Id:        webhook.Id.String(),
		EventType: WebhookEventType(webhook.EventType),
		Url:       webhook.Url,
		Status:    WebhookStatus(webhook.Status),
	}
}

func unknownWebhook() Error {
	return Error{Code: "not_found", Message: "Ce compte n'a aucun webhook de cet identifiant. Rechargez la fiche."}
}

func webhookEventTaken(code string) Error {
	const refusal = "Ce compte a déjà un webhook pour ce type d'événement. Supprimez-le, puis recréez-le."

	return Error{
		Code: code, Message: refusal,
		Errors: &[]FieldError{{Field: "eventType", Message: refusal}},
	}
}

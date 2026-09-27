package bff

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

type notificationRefusal int

const (
	notificationReadable notificationRefusal = iota
	notificationUnauthenticated
	notificationNotElevated
)

type notificationReader struct {
	operatorID string
	sources    []string
}

// readerOf tient lieu de garde : l'exemption de `guard.go` saute session et élévation, parce que la
// visibilité dépend de la source de chaque ligne et non d'une clé à l'entrée.
func (a API) readerOf(ctx context.Context) (notificationReader, notificationRefusal, error) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return notificationReader{}, notificationReadable, err
	}

	if !alive {
		return notificationReader{}, notificationUnauthenticated, nil
	}

	if !resolved.Elevated {
		return notificationReader{}, notificationNotElevated, nil
	}

	grants, err := a.Sessions.Grants(ctx, resolved.OperatorID)
	if err != nil {
		return notificationReader{}, notificationReadable, err
	}

	return notificationReader{
		operatorID: resolved.OperatorID,
		sources:    permissions.VisibleNotificationSources(grants.Permissions),
	}, notificationReadable, nil
}

func (a API) ListNotifications(ctx context.Context, request ListNotificationsRequestObject,
) (ListNotificationsResponseObject, error) {
	reader, refusal, err := a.readerOf(ctx)
	if err != nil {
		return nil, err
	}

	switch refusal {
	case notificationUnauthenticated:
		return ListNotifications401JSONResponse{SessionAbsenteJSONResponse(notAuthenticated())}, nil
	case notificationNotElevated:
		return ListNotifications403JSONResponse{PermissionRefuseeJSONResponse(secondFactorRequired())}, nil
	}

	var cursor string
	if request.Params.Cursor != nil {
		cursor = *request.Params.Cursor
	}

	page, err := a.Notifications.Page(ctx, reader.operatorID, reader.sources, cursor)
	if errors.Is(err, store.ErrNotificationCursor) {
		return ListNotifications400JSONResponse{RequeteInvalideJSONResponse(Error{
			Code: "invalid_cursor",
			Message: "Ce curseur de pagination n'est pas reconnu : la liste reprend depuis les " +
				"notifications les plus récentes si on la recharge.",
		})}, nil
	}

	if err != nil {
		return nil, err
	}

	items := make([]NotificationEntry, 0, len(page.Items))
	for _, view := range page.Items {
		entry, err := notificationEntry(view)
		if err != nil {
			return nil, err
		}

		items = append(items, entry)
	}

	response := ListNotifications200JSONResponse{Items: items, UnreadCount: page.UnreadCount}
	if page.NextCursor != "" {
		response.NextCursor = &page.NextCursor
	}

	return response, nil
}

// notificationEntry ne recopie jamais `details` : il passe par le DTO de `BillingAlert`, et un champ
// que ce DTO ne déclare pas ne sort pas.
func notificationEntry(view store.NotificationView) (NotificationEntry, error) {
	entry := NotificationEntry{
		Id:        view.ID,
		Source:    NotificationEntrySource(view.Source),
		Severity:  NotificationEntrySeverity(view.Severity),
		Kind:      NotificationEntryKind(view.Kind),
		Message:   view.Message,
		CreatedAt: view.CreatedAt,
		Read:      view.Read,
	}

	if entry.Kind == NotificationEntryKindBillingAlert {
		var details BillingAlert
		if err := json.Unmarshal(view.Details, &details); err != nil {
			return NotificationEntry{}, fmt.Errorf("relire les faits de la notification %s : %w", view.ID, err)
		}

		entry.Details = &details
	}

	return entry, nil
}

func (a API) MarkNotificationRead(ctx context.Context, request MarkNotificationReadRequestObject,
) (MarkNotificationReadResponseObject, error) {
	reader, refusal, err := a.readerOf(ctx)
	if err != nil {
		return nil, err
	}

	switch refusal {
	case notificationUnauthenticated:
		return MarkNotificationRead401JSONResponse{SessionAbsenteJSONResponse(notAuthenticated())}, nil
	case notificationNotElevated:
		return MarkNotificationRead403JSONResponse{PermissionRefuseeJSONResponse(secondFactorRequired())}, nil
	}

	err = a.Notifications.MarkRead(ctx, reader.operatorID, request.NotificationId, reader.sources,
		a.event(ctx, store.Event{
			OperatorID: reader.operatorID,
			Action:     actionNotificationRead,
			TargetType: auditTargetNotification,
		}))
	if errors.Is(err, store.ErrNotificationUnknown) {
		return MarkNotificationRead404JSONResponse{NotificationInconnueJSONResponse(Error{
			Code: "notification_unknown",
			Message: "Cette notification n'est pas dans votre centre : elle n'existe pas, ou sa " +
				"source demande une permission que votre compte n'a pas.",
		})}, nil
	}

	if err != nil {
		return nil, err
	}

	return MarkNotificationRead204Response{}, nil
}

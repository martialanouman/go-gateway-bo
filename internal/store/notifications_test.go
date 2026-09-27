package store_test

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func notificationsOn(t *testing.T) (*store.Notifications, string) {
	t.Helper()

	pool, dsn := migratedPool(t)

	return store.NewNotifications(pool), dsn
}

func billing(n int) store.NewNotification {
	return store.NewNotification{
		Source: "billing_alert_stream", Severity: "warning", Kind: "billing_alert",
		Details: map[string]any{
			"customerId": fmt.Sprintf("cust-%d", n), "ownerType": "customer",
			"ownerId": fmt.Sprintf("cust-%d", n), "alert": "mo_floor_reached", "balance": -5000,
		},
	}
}

// recordOrInsertMessage pose une notification via `Record` quand elle porte des faits, ou par une
// écriture directe pour les sources en texte libre (M9), que `Record` ne sert pas ici.
func recordOrInsertMessage(t *testing.T, notifications *store.Notifications, dsn string, fresh store.NewNotification) {
	t.Helper()

	if fresh.Details != nil {
		_, err := notifications.Record(t.Context(), fresh)
		require.NoError(t, err)

		return
	}

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	_, err = conn.Exec(t.Context(),
		`INSERT INTO notifications (source, severity, kind, message) VALUES ($1, $2, 'message', 'Connecteur en erreur')`,
		fresh.Source, fresh.Severity)
	require.NoError(t, err)
}

// notificationOperatorSeq rend chaque opérateur d'essai unique : plusieurs cas en posent deux dans
// la même base, et l'index unique sur `lower(email)` refuserait un doublon.
var notificationOperatorSeq atomic.Int64

// seedNotificationOperator délègue à `insertOperator` (logins_test.go) : le paquet porte déjà un
// identifiant `seedOperator` (constraints_test.go, une constante), donc ce nom lui reste propre.
func seedNotificationOperator(t *testing.T, dsn string) string {
	t.Helper()

	email := fmt.Sprintf("operateur-notifications-%d@exemple.test", notificationOperatorSeq.Add(1))

	return insertOperator(t, dsn, email, "hash")
}

func TestSourcesTableCoversExactlyTheSQLCheck(t *testing.T) {
	t.Parallel()

	_, dsn := notificationsOn(t)

	var definition string
	queryOn(t, dsn, `SELECT pg_get_constraintdef(oid) FROM pg_constraint
		WHERE conrelid = 'notifications'::regclass AND conname = 'notifications_source_check'`, &definition)

	declared := regexp.MustCompile(`'([a-z_]+)'::text`).FindAllStringSubmatch(definition, -1)
	require.NotEmpty(t, declared, "contrainte introuvable ou illisible : %q", definition)

	var inSQL []string
	for _, match := range declared {
		inSQL = append(inSQL, match[1])
	}

	assert.ElementsMatch(t, inSQL, slices.Collect(maps.Keys(permissions.NotificationSourceKeys)))
}

func TestAPageHoldsOnlyVisibleSourcesAndStaysFull(t *testing.T) {
	t.Parallel()

	notifications, dsn := notificationsOn(t)
	operator := seedNotificationOperator(t, dsn)

	// 35 lignes, dont 10 invisibles intercalées parmi les plus récentes : un filtre appliqué après
	// le LIMIT rendrait une première page courte.
	for i := range 35 {
		fresh := billing(i)
		if i >= 15 && i%2 == 0 {
			fresh = store.NewNotification{Source: "alertmanager", Severity: "critical", Kind: "message"}
		}
		recordOrInsertMessage(t, notifications, dsn, fresh)
	}

	page, err := notifications.Page(t.Context(), operator, []string{"billing_alert_stream"}, "")
	require.NoError(t, err)

	assert.Len(t, page.Items, store.NotificationPageSize)
	for _, item := range page.Items {
		assert.Equal(t, "billing_alert_stream", item.Source)
	}
	assert.NotEmpty(t, page.NextCursor)
	assert.Equal(t, 25, page.UnreadCount)
}

func TestPagesFollowTheCursorWithoutGapOrRepeat(t *testing.T) {
	t.Parallel()

	notifications, dsn := notificationsOn(t)
	operator := seedNotificationOperator(t, dsn)

	for i := range 45 {
		recordOrInsertMessage(t, notifications, dsn, billing(i))
	}

	var ids []string

	seen := map[string]bool{}
	cursor := ""

	for page := 1; ; page++ {
		got, err := notifications.Page(t.Context(), operator, []string{"billing_alert_stream"}, cursor)
		require.NoError(t, err)

		switch {
		case page < 3:
			require.Lenf(t, got.Items, store.NotificationPageSize, "page %d", page)
			require.NotEmptyf(t, got.NextCursor, "page %d devrait annoncer une suite", page)
		case page == 3:
			require.Len(t, got.Items, 5)
			require.Empty(t, got.NextCursor)
		default:
			t.Fatalf("une quatrième page n'était pas attendue")
		}

		if page == 1 {
			assert.Equal(t, got.Items[store.NotificationPageSize-1].ID, got.NextCursor)
		}

		for _, item := range got.Items {
			require.Falsef(t, seen[item.ID], "id %s vu deux fois", item.ID)
			seen[item.ID] = true

			ids = append(ids, item.ID)
		}

		if got.NextCursor == "" {
			break
		}

		cursor = got.NextCursor
	}

	require.Len(t, ids, 45)

	for i := 1; i < len(ids); i++ {
		assert.Less(t, ids[i], ids[i-1], "l'ordre doit rester strictement décroissant")
	}
}

func TestAnUnreadableCursorIsRefused(t *testing.T) {
	t.Parallel()

	notifications, dsn := notificationsOn(t)
	operator := seedNotificationOperator(t, dsn)

	_, err := notifications.Page(t.Context(), operator, []string{"billing_alert_stream"}, "pas-un-uuid")
	assert.ErrorIs(t, err, store.ErrNotificationCursor)
}

func TestReadIsPerOperator(t *testing.T) {
	t.Parallel()

	notifications, dsn := notificationsOn(t)
	first := seedNotificationOperator(t, dsn)
	second := seedNotificationOperator(t, dsn)

	created, err := notifications.Record(t.Context(), billing(1))
	require.NoError(t, err)

	event := store.Event{OperatorID: first, Action: "notification.read", TargetType: "notification"}
	require.NoError(t, notifications.MarkRead(t.Context(), first, created.ID, []string{"billing_alert_stream"}, event))

	firstPage, err := notifications.Page(t.Context(), first, []string{"billing_alert_stream"}, "")
	require.NoError(t, err)
	require.Len(t, firstPage.Items, 1)
	assert.True(t, firstPage.Items[0].Read)
	assert.Equal(t, 0, firstPage.UnreadCount)

	secondPage, err := notifications.Page(t.Context(), second, []string{"billing_alert_stream"}, "")
	require.NoError(t, err)
	require.Len(t, secondPage.Items, 1)
	assert.False(t, secondPage.Items[0].Read)
	assert.Equal(t, 1, secondPage.UnreadCount)
}

func TestMarkingTwiceWritesOneAuditLine(t *testing.T) {
	t.Parallel()

	notifications, dsn := notificationsOn(t)
	operator := seedNotificationOperator(t, dsn)

	created, err := notifications.Record(t.Context(), billing(1))
	require.NoError(t, err)

	event := store.Event{OperatorID: operator, Action: "notification.read", TargetType: "notification"}

	require.NoError(t, notifications.MarkRead(t.Context(), operator, created.ID, []string{"billing_alert_stream"}, event))
	require.NoError(t, notifications.MarkRead(t.Context(), operator, created.ID, []string{"billing_alert_stream"}, event))

	var lines int64
	queryOn(t, dsn, `SELECT count(*) FROM audit_log WHERE action = 'notification.read' AND target_id = $1`,
		&lines, created.ID)
	assert.EqualValues(t, 1, lines)
}

func TestMarkingAnInvisibleOrMissingNotificationIsUnknown(t *testing.T) {
	t.Parallel()

	notifications, dsn := notificationsOn(t)
	operator := seedNotificationOperator(t, dsn)

	conn, err := pgx.Connect(t.Context(), dsn)
	require.NoError(t, err)

	defer func() { _ = conn.Close(context.WithoutCancel(t.Context())) }()

	var invisibleID string
	err = conn.QueryRow(t.Context(), `
		INSERT INTO notifications (source, severity, kind, message)
		VALUES ('alertmanager', 'critical', 'message', 'Connecteur en erreur')
		RETURNING id::text`).Scan(&invisibleID)
	require.NoError(t, err)

	event := store.Event{OperatorID: operator, Action: "notification.read", TargetType: "notification"}

	cases := map[string]string{
		"visible seulement sous alerts:read": invisibleID,
		"absente":                            "0198f2c0-0000-7000-8000-000000000000",
		"pas un identifiant":                 "x",
	}

	for name, id := range cases {
		t.Run(name, func(t *testing.T) {
			err := notifications.MarkRead(t.Context(), operator, id, []string{"billing_alert_stream"}, event)
			assert.ErrorIs(t, err, store.ErrNotificationUnknown)
		})
	}
}

func TestRecordRendersWhatWasWritten(t *testing.T) {
	t.Parallel()

	notifications, _ := notificationsOn(t)

	fresh := billing(1)

	view, err := notifications.Record(t.Context(), fresh)
	require.NoError(t, err)

	assert.NotEmpty(t, view.ID)
	assert.Equal(t, "billing_alert", view.Kind)
	assert.Nil(t, view.Message)
	assert.False(t, view.Read)

	expected, err := json.Marshal(fresh.Details)
	require.NoError(t, err)
	assert.JSONEq(t, string(expected), string(view.Details))
}

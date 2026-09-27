package hub

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const billingFrame = `{"v":1,"feed":"billing-alerts","service":"billing","instance":"b-1",
"emitted_at":"2026-09-27T10:00:00Z","customer_id":"cust-9","owner_type":"customer",
"owner_id":"cust-9","alert":"mo_floor_reached","balance":-5000}`

const billingPath = "/admin/stream/billing-alerts"

var recordedAt = time.Date(2026, 9, 27, 10, 0, 1, 0, time.UTC)

type fakeRecorder struct {
	mu     sync.Mutex
	alerts []BillingAlert
}

func (r *fakeRecorder) record(_ context.Context, alert BillingAlert) (Notification, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.alerts = append(r.alerts, alert)

	return Notification{
		ID: "n-1", Source: "billing_alert_stream", Severity: "warning", Kind: "billing_alert",
		Details: &alert, CreatedAt: recordedAt,
	}, nil
}

func (r *fakeRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()

	return len(r.alerts)
}

func granting(keys ...string) Access {
	return func(context.Context) (bool, []string, error) { return true, keys, nil }
}

func notificationsSocket(t *testing.T, h *Hub, access Access, topics string) *websocket.Conn {
	t.Helper()

	conn := dial(t, serveOn(t, h, access))
	send(t, conn, `{"action":"subscribe","topics":[`+topics+`]}`)

	return conn
}

func awaitBillingFeed(t *testing.T, gateway *upstream) {
	t.Helper()

	require.Eventually(t, func() bool { return gateway.openedOn(billingPath) == 1 }, wait, 10*time.Millisecond)
}

func nextData(t *testing.T, conn *websocket.Conn, topic string) received {
	t.Helper()

	for {
		message := next(t, conn)
		if message.Topic == topic && message.Data != nil {
			return message
		}
	}
}

// nothingWithin lit jusqu'à l'échéance : coder/websocket ferme la connexion à son expiration, c'est
// donc toujours la dernière lecture d'un test.
func nothingWithin(t *testing.T, conn *websocket.Conn, topic string) {
	t.Helper()

	ctx, cancel := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancel()

	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			require.ErrorIs(t, err, context.DeadlineExceeded)

			return
		}

		var message received
		require.NoError(t, json.Unmarshal(raw, &message))
		assert.False(t, message.Topic == topic && message.Data != nil, "trame reçue sur %s : %s", topic, raw)
	}
}

func TestTheLeaseHolderRecordsThenBroadcastsTheNotification(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	recorder := &fakeRecorder{}
	h := fastHub()
	h.record = recorder.record

	runHub(t, h, gateway.dial, rdb, namespace)
	conn := notificationsSocket(t, h, granting("billing:read"), `"notifications"`)
	awaitStatus(t, conn, "notifications", "live")
	awaitBillingFeed(t, gateway)

	gateway.emit(t, billingPath, billingFrame)

	assert.JSONEq(t, `{"id":"n-1","source":"billing_alert_stream","severity":"warning","kind":"billing_alert",`+
		`"details":{"customerId":"cust-9","ownerType":"customer","ownerId":"cust-9","alert":"mo_floor_reached",`+
		`"balance":-5000},"createdAt":"2026-09-27T10:00:01Z"}`,
		string(nextData(t, conn, "notifications").Data))
	assert.Equal(t, 1, recorder.count())
}

func TestANotificationReachesOnlySocketsAllowedItsSource(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	h := fastHub()
	h.record = (&fakeRecorder{}).record

	runHub(t, h, gateway.dial, rdb, namespace)
	billing := notificationsSocket(t, h, granting("billing:read"), `"notifications"`)
	alerts := notificationsSocket(t, h, granting("alerts:read"), `"notifications"`)
	awaitStatus(t, billing, "notifications", "live")
	awaitStatus(t, alerts, "notifications", "live")
	awaitBillingFeed(t, gateway)

	gateway.emit(t, billingPath, billingFrame)

	assert.Equal(t, "n-1", idOf(t, nextData(t, billing, "notifications")))
	nothingWithin(t, alerts, "notifications")
}

func TestARevokedPermissionStopsNotificationFrames(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	h := fastHub()
	h.record = (&fakeRecorder{}).record
	h.revalidateEvery = 20 * time.Millisecond

	var revoked atomic.Bool

	var revokedChecks atomic.Int32

	runHub(t, h, gateway.dial, rdb, namespace)
	conn := notificationsSocket(t, h, func(context.Context) (bool, []string, error) {
		if revoked.Load() {
			revokedChecks.Add(1)

			return true, nil, nil
		}

		return true, []string{"billing:read"}, nil
	}, `"notifications"`)
	awaitStatus(t, conn, "notifications", "live")
	awaitBillingFeed(t, gateway)

	revoked.Store(true)
	// Le deuxième appel ne commence qu'après que le premier a été appliqué.
	require.Eventually(t, func() bool { return revokedChecks.Load() >= 2 }, wait, 5*time.Millisecond)
	assert.Equal(t, 1, subscribers(h, NotificationsTopic))

	gateway.emit(t, billingPath, billingFrame)

	nothingWithin(t, conn, "notifications")
}

func TestAFailedRecordStillRelaysTheBillingAlert(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	h := fastHub()
	h.record = func(context.Context, BillingAlert) (Notification, error) {
		return Notification{}, errors.New("base injoignable")
	}

	runHub(t, h, gateway.dial, rdb, namespace)
	conn := notificationsSocket(t, h, granting("billing:read"), `"billing.alerts","notifications"`)
	awaitStatus(t, conn, "notifications", "live")
	awaitBillingFeed(t, gateway)

	gateway.emit(t, billingPath, billingFrame)

	assert.JSONEq(t, `{"customerId":"cust-9","ownerType":"customer","ownerId":"cust-9",`+
		`"alert":"mo_floor_reached","balance":-5000}`, string(nextData(t, conn, "billing.alerts").Data))
	nothingWithin(t, conn, "notifications")
}

func TestNotificationsFollowTheBillingFeedStatus(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	gateway := newUpstream(t)
	h := fastHub()
	h.upstreamSilence = 300 * time.Millisecond

	runHub(t, h, gateway.dial, rdb, namespace)
	conn := notificationsSocket(t, h, granting(), `"notifications"`)
	awaitStatus(t, conn, "notifications", "live")
	awaitStatus(t, conn, "notifications", "stale")
}

func TestNotificationsNeedNoPermissionToSubscribe(t *testing.T) {
	t.Parallel()

	conn := notificationsSocket(t, quietHub(), granting(), `"notifications"`)

	message := next(t, conn)
	assert.Equal(t, "notifications", message.Topic)
	assert.Nil(t, message.Error)
	assert.Equal(t, "stale", message.Status)
}

func idOf(t *testing.T, message received) string {
	t.Helper()

	var notification Notification
	require.NoError(t, json.Unmarshal(message.Data, &notification))

	return notification.ID
}

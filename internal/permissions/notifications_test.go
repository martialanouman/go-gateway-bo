package permissions_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

func TestBillingNotificationsNeedBillingRead(t *testing.T) {
	t.Parallel()

	assert.Equal(t, []string{"billing_alert_stream"},
		permissions.VisibleNotificationSources([]string{"billing:read"}))
	assert.Equal(t, []string{"alertmanager", "bff_evaluator"},
		permissions.VisibleNotificationSources([]string{"alerts:read"}))
	assert.Empty(t, permissions.VisibleNotificationSources([]string{"audit:read"}))
	assert.NotNil(t, permissions.VisibleNotificationSources(nil))
}

func TestAnUnknownSourceIsVisibleToNobody(t *testing.T) {
	t.Parallel()

	everything := []string{"billing:read", "alerts:read", "audit:read"}
	assert.False(t, permissions.NotificationSourceAllowed("carrier_pigeon", everything))
	assert.True(t, permissions.NotificationSourceAllowed("billing_alert_stream", []string{"billing:read"}))
	assert.False(t, permissions.NotificationSourceAllowed("billing_alert_stream", []string{"alerts:read"}))
}

package permissions

import (
	"slices"
)

const (
	NotificationSourceBilling      = "billing_alert_stream"
	NotificationSourceAlertmanager = "alertmanager"
	NotificationSourceEvaluator    = "bff_evaluator"
)

// NotificationSourceKeys décide qui voit une notification : la permission de sa source, pas une clé
// propre au centre. Un solde ne s'affiche qu'avec `billing:read`, quel que soit le rôle.
// Une source absente de cette table est invisible de tous.
var NotificationSourceKeys = map[string]Key{
	NotificationSourceBilling:      BillingRead,
	NotificationSourceAlertmanager: AlertsRead,
	NotificationSourceEvaluator:    AlertsRead,
}

func VisibleNotificationSources(granted []string) []string {
	visible := []string{}

	for source, key := range NotificationSourceKeys {
		if slices.Contains(granted, string(key)) {
			visible = append(visible, source)
		}
	}

	slices.Sort(visible)

	return visible
}

func NotificationSourceAllowed(source string, granted []string) bool {
	key, known := NotificationSourceKeys[source]

	return known && slices.Contains(granted, string(key))
}

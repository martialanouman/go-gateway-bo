package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// Topic est le nom sous lequel un flux est diffusé au client (§5.2).
type Topic string

const (
	TrafficTopic  Topic = "metrics.traffic"
	SessionsTopic Topic = "sessions.events"
	BillingTopic  Topic = "billing.alerts"

	NotificationsTopic Topic = "notifications"
)

// feed relie un flux de l'API Admin au sujet qui le diffuse. Une permission vide ouvre le sujet à tout
// opérateur authentifié : le catalogue n'a aucune clé pour lire le trafic, comme l'entrée « Trafic »
// du rail (`web/src/lib/navigation.ts`).
type feed struct {
	path       string
	topic      Topic
	permission permissions.Key
	relay      func(raw []byte) ([]byte, error)
	// recheck relit une trame venue du canal Redis dans le DTO du sujet : ce qui atteint une socket
	// est toujours sérialisé par lui, jamais recopié.
	recheck func(published []byte) ([]byte, error)
}

var feeds = []feed{
	{
		path: "/admin/stream/metrics", topic: TrafficTopic,
		relay: relay(TrafficTopic, upstreamSnapshot.outgoing), recheck: recheck[TrafficSnapshot](TrafficTopic),
	},
	{
		path: "/admin/stream/sessions", topic: SessionsTopic, permission: permissions.SessionsRead,
		relay: relay(SessionsTopic, upstreamSessionEvent.outgoing), recheck: recheck[SessionEvent](SessionsTopic),
	},
	{
		path: "/admin/stream/billing-alerts", topic: BillingTopic, permission: permissions.BillingRead,
		relay: relay(BillingTopic, upstreamBillingAlert.outgoing), recheck: recheck[BillingAlert](BillingTopic),
	},
}

// subject est ce qu'un client peut demander. `notifications` n'a pas de flux amont : le hub l'écrit
// lui-même depuis `billing.alerts`, et filtre chaque trame selon la source qu'elle porte.
type subject struct {
	topic      Topic
	permission permissions.Key
}

var subjects = append(feedSubjects(), subject{topic: NotificationsTopic})

func feedSubjects() []subject {
	out := make([]subject, 0, len(feeds))
	for _, f := range feeds {
		out = append(out, subject{topic: f.topic, permission: f.permission})
	}

	return out
}

func subjectOf(topic Topic) (subject, bool) {
	for _, s := range subjects {
		if s.topic == topic {
			return s, true
		}
	}

	return subject{}, false
}

func feedOf(topic Topic) (feed, bool) {
	for _, f := range feeds {
		if f.topic == topic {
			return f, true
		}
	}

	return feed{}, false
}

// upstreamVersion est le `StreamFrameVersion` du contrat (6.9.0). Un renommage de champ, lui, est
// attrapé par `contract_test.go` ; ce numéro signale un changement de forme que la passerelle annonce.
const upstreamVersion = 1

// Les trois trames amont, d'après les schémas `MetricSnapshot`, `SessionEvent` et `BillingAlert` du
// contrat Admin, confrontés à ces structs par `contract_test.go`.
type (
	upstreamSnapshot struct {
		V         int              `json:"v"`
		Instance  string           `json:"instance"`
		EmittedAt time.Time        `json:"emitted_at"`
		Samples   []upstreamSample `json:"samples"`
	}

	upstreamSample struct {
		Kind   string            `json:"kind"`
		Labels map[string]string `json:"labels"`
		Value  float64           `json:"value"`
	}

	upstreamSessionEvent struct {
		V         int       `json:"v"`
		EmittedAt time.Time `json:"emitted_at"`
		AccountID string    `json:"account_id"`
		SystemID  string    `json:"system_id"`
		State     string    `json:"state"`
		Sessions  *int      `json:"sessions"`
	}

	upstreamBillingAlert struct {
		V          int       `json:"v"`
		EmittedAt  time.Time `json:"emitted_at"`
		CustomerID string    `json:"customer_id"`
		OwnerType  string    `json:"owner_type"`
		OwnerID    string    `json:"owner_id"`
		Alert      string    `json:"alert"`
		Balance    int64     `json:"balance"`
	}
)

// Les DTO de sortie : ce que le client reçoit dans `data`, et rien d'autre.
type (
	TrafficSnapshot struct {
		Instance string          `json:"instance"`
		Samples  []TrafficSample `json:"samples"`
	}

	TrafficSample struct {
		Kind   string            `json:"kind"`
		Labels map[string]string `json:"labels,omitempty"`
		Value  float64           `json:"value"`
	}

	SessionEvent struct {
		AccountID string `json:"accountId"`
		SystemID  string `json:"systemId"`
		State     string `json:"state"`
		Sessions  *int   `json:"sessions,omitempty"`
	}

	BillingAlert struct {
		CustomerID string `json:"customerId"`
		OwnerType  string `json:"ownerType"`
		OwnerID    string `json:"ownerId"`
		Alert      string `json:"alert"`
		Balance    int64  `json:"balance"`
	}

	Notification struct {
		ID        string        `json:"id"`
		Source    string        `json:"source"`
		Severity  string        `json:"severity"`
		Kind      string        `json:"kind"`
		Message   *string       `json:"message,omitempty"`
		Details   *BillingAlert `json:"details,omitempty"`
		CreatedAt time.Time     `json:"createdAt"`
	}
)

// Recorder écrit une alerte de facturation et rend la notification écrite.
type Recorder func(ctx context.Context, alert BillingAlert) (Notification, error)

func (f upstreamSnapshot) outgoing() (int, time.Time, TrafficSnapshot) {
	samples := make([]TrafficSample, 0, len(f.Samples))
	for _, s := range f.Samples {
		samples = append(samples, TrafficSample(s))
	}

	return f.V, f.EmittedAt, TrafficSnapshot{Instance: f.Instance, Samples: samples}
}

func (f upstreamSessionEvent) outgoing() (int, time.Time, SessionEvent) {
	return f.V, f.EmittedAt, SessionEvent{
		AccountID: f.AccountID, SystemID: f.SystemID, State: f.State, Sessions: f.Sessions,
	}
}

func (f upstreamBillingAlert) outgoing() (int, time.Time, BillingAlert) {
	return f.V, f.EmittedAt, BillingAlert{
		CustomerID: f.CustomerID, OwnerType: f.OwnerType, OwnerID: f.OwnerID, Alert: f.Alert, Balance: f.Balance,
	}
}

func relay[U, D any](topic Topic, outgoing func(U) (int, time.Time, D)) func([]byte) ([]byte, error) {
	return func(raw []byte) ([]byte, error) {
		var frame U
		if err := json.Unmarshal(raw, &frame); err != nil {
			return nil, fmt.Errorf("trame illisible : %w", err)
		}

		version, emittedAt, data := outgoing(frame)
		if version != upstreamVersion {
			return nil, fmt.Errorf("trame en version %d, %d attendue", version, upstreamVersion)
		}

		return json.Marshal(dataMessage[D]{Topic: topic, TS: emittedAt, Data: data})
	}
}

func recheck[D any](topic Topic) func([]byte) ([]byte, error) {
	return func(published []byte) ([]byte, error) {
		// Pas de DisallowUnknownFields : la re-sérialisation suffit à retirer un champ non déclaré, et
		// rejeter la trame figerait le sujet sur les instances d'une version plus ancienne.
		var message dataMessage[D]
		if err := json.Unmarshal(published, &message); err != nil {
			return nil, fmt.Errorf("trame du canal hors du DTO de %s : %w", topic, err)
		}

		if message.Topic != topic {
			return nil, fmt.Errorf("trame du canal annoncée sur %s, relue sur %s", message.Topic, topic)
		}

		return json.Marshal(message)
	}
}

// Les messages du serveur vers le client (§5.2).
type (
	dataMessage[D any] struct {
		Topic Topic     `json:"topic"`
		TS    time.Time `json:"ts"`
		Data  D         `json:"data"`
	}

	statusMessage struct {
		Topic  Topic      `json:"topic"`
		Status string     `json:"status"`
		Since  *time.Time `json:"since,omitempty"`
	}

	errorMessage struct {
		Topic string `json:"topic,omitempty"`
		Error Error  `json:"error"`
	}

	// Error a la forme du DTO d'erreur du BFF.
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
)

// clientMessage est le seul message que le client envoie.
type clientMessage struct {
	Action string   `json:"action"`
	Topics []string `json:"topics"`
}

func mustMarshal(message any) []byte {
	encoded, err := json.Marshal(message)
	if err != nil {
		panic(fmt.Sprintf("hub : un message déclaré ne se sérialise pas : %v", err))
	}

	return encoded
}

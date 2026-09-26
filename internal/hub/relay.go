package hub

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Run tient l'instance dans le groupe jusqu'à l'annulation de ctx : elle brigue le bail, consomme la
// passerelle quand elle le porte, et rediffuse ce qu'elle lit sur Redis — le porteur compris. Un seul
// chemin : Redis injoignable, les sujets passent `stale`, sans repli sur une consommation directe.
func (h *Hub) Run(ctx context.Context, dial Dialer, rdb *redis.Client, namespace string) {
	channel := namespace + ":realtime"
	leader := lease{rdb: rdb, key: namespace + ":realtime:leader", holder: h.instance, ttl: h.leaseTTL}

	var group sync.WaitGroup

	group.Go(func() { h.follow(ctx, rdb, channel) })
	group.Go(func() { h.lead(ctx, dial, rdb, channel, leader) })

	<-ctx.Done()
	close(h.stopping)
	group.Wait()
}

// leaderView est l'état des sujets vu par le porteur du bail : chaque changement part aussitôt sur
// le canal, et le battement de cœur le republie en entier.
type leaderView struct {
	publish  func([]byte)
	mu       sync.Mutex
	statuses map[Topic]statusMessage
}

func newLeaderView(publish func([]byte)) *leaderView {
	statuses := map[Topic]statusMessage{}
	for _, f := range feeds {
		statuses[f.topic] = statusMessage{Topic: f.topic, Status: "stale"}
	}

	return &leaderView{publish: publish, statuses: statuses}
}

func (v *leaderView) set(topic Topic, status string, since *time.Time) {
	message := statusMessage{Topic: topic, Status: status, Since: since}

	v.mu.Lock()
	v.statuses[topic] = message
	v.mu.Unlock()

	v.publish(mustMarshal(message))
}

func (v *leaderView) heartbeat() []byte {
	v.mu.Lock()
	defer v.mu.Unlock()

	beat := heartbeatMessage{Heartbeat: make([]statusMessage, 0, len(feeds))}
	for _, f := range feeds {
		beat.Heartbeat = append(beat.Heartbeat, v.statuses[f.topic])
	}

	return mustMarshal(beat)
}

type heartbeatMessage struct {
	Heartbeat []statusMessage `json:"heartbeat"`
}

func (h *Hub) lead(ctx context.Context, dial Dialer, rdb *redis.Client, channel string, leader lease) {
	attempt := time.NewTicker(h.leaseEvery)
	defer attempt.Stop()

	for {
		held, err := leader.acquire(ctx)
		if err != nil && ctx.Err() == nil {
			h.logger.Debug("bail temps réel injoignable", "error", err)
		}

		if held {
			h.hold(ctx, dial, rdb, channel, leader)
		}

		select {
		case <-ctx.Done():
			return
		case <-attempt.C:
		}
	}
}

// hold consomme la passerelle tant que le bail se renouvelle. Un renouvellement refusé ou en échec
// arrête les consommateurs aussitôt : un successeur peut déjà être en train de joindre la passerelle.
func (h *Hub) hold(ctx context.Context, dial Dialer, rdb *redis.Client, channel string, leader lease) {
	holding, release := context.WithCancel(ctx)

	view := newLeaderView(func(message []byte) {
		if err := rdb.Publish(holding, channel, message).Err(); err != nil && holding.Err() == nil {
			h.logger.Debug("republication temps réel perdue", "error", err)
		}
	})

	var consumers sync.WaitGroup

	for _, f := range feeds {
		consumers.Go(func() { h.consume(holding, f, dial, view) })
	}

	renewal := time.NewTicker(h.leaseEvery)
	defer renewal.Stop()

	heartbeat := time.NewTicker(h.heartbeatEvery)
	defer heartbeat.Stop()

	view.publish(view.heartbeat())

	for held := true; held; {
		select {
		case <-ctx.Done():
			held = false

		case <-heartbeat.C:
			view.publish(view.heartbeat())

		case <-renewal.C:
			renewed, err := leader.renew(holding)
			if err != nil || !renewed {
				h.logger.Warn("bail temps réel perdu : les flux amont s'arrêtent", "error", err)
				held = false
			}
		}
	}

	release()
	consumers.Wait()

	if ctx.Err() != nil {
		// Rendu à l'arrêt propre, pour qu'un successeur n'attende pas son expiration.
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), writeTimeout)
		defer cancel()

		if err := leader.release(releaseCtx); err != nil {
			h.logger.Debug("bail temps réel non rendu", "error", err)
		}
	}
}

// follow rediffuse ce que le canal porte. Sans battement de cœur depuis heartbeatTimeout — porteur
// mort, Redis coupé, abonnement rompu —, tous les sujets passent `stale` : afficher `live` sur des
// chiffres figés serait pire que les dire périmés.
func (h *Hub) follow(ctx context.Context, rdb *redis.Client, channel string) {
	subscription := rdb.Subscribe(ctx, channel)
	defer func() { _ = subscription.Close() }()

	messages := subscription.Channel()

	watchdog := time.NewTicker(h.heartbeatEvery)
	defer watchdog.Stop()

	var lastBeat time.Time

	for {
		select {
		case <-ctx.Done():
			return

		case message, open := <-messages:
			if !open {
				return
			}

			if h.receive([]byte(message.Payload)) {
				lastBeat = time.Now()
			}

		case <-watchdog.C:
			if !lastBeat.IsZero() && time.Since(lastBeat) > h.heartbeatTimeout {
				since := lastBeat.UTC()
				h.markStale(&since)
				lastBeat = time.Time{}
			}
		}
	}
}

// receive rend vrai sur un battement de cœur.
func (h *Hub) receive(payload []byte) bool {
	var message struct {
		Topic     Topic           `json:"topic"`
		Status    string          `json:"status"`
		Heartbeat []statusMessage `json:"heartbeat"`
	}

	if err := json.Unmarshal(payload, &message); err != nil {
		h.logger.Warn("message temps réel illisible sur le canal", "error", err)

		return false
	}

	switch {
	case message.Heartbeat != nil:
		for _, status := range message.Heartbeat {
			h.setStatus(status)
		}

		return true

	case message.Status != "":
		var status statusMessage
		if json.Unmarshal(payload, &status) == nil {
			h.setStatus(status)
		}

	default:
		h.publish(message.Topic, payload)
	}

	return false
}

func (h *Hub) markStale(since *time.Time) {
	for _, f := range feeds {
		if h.status(f.topic) == "live" {
			h.setStatus(statusMessage{Topic: f.topic, Status: "stale", Since: since})
		}
	}
}

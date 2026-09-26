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
		// Relevé avant l'appel : c'est l'instant le plus tôt où le bail a pu être posé, donc le plus
		// prudent pour en calculer l'échéance.
		asked := time.Now()

		held, err := leader.acquire(ctx)
		if err != nil && ctx.Err() == nil {
			h.logger.Debug("bail temps réel injoignable", "error", err)
		}

		if held {
			h.hold(ctx, dial, rdb, channel, leader, asked)
		}

		select {
		case <-ctx.Done():
			return
		case <-attempt.C:
		}
	}
}

// hold consomme la passerelle tant que le bail est à coup sûr détenu. L'échéance est **locale** :
// les consommateurs s'arrêtent un intervalle de renouvellement avant l'expiration du bail compté
// depuis le dernier renouvellement réussi, que Redis réponde ou non. Un appel Redis bloqué — partition,
// connexion à moitié morte — ne peut donc plus laisser deux instances sur la passerelle.
func (h *Hub) hold(ctx context.Context, dial Dialer, rdb *redis.Client, channel string, leader lease, asked time.Time) {
	holding, stopHolding := context.WithCancel(ctx)
	defer stopHolding()

	view := newLeaderView(func(message []byte) {
		publishing, cancel := context.WithTimeout(holding, h.leaseEvery)
		defer cancel()

		if err := rdb.Publish(publishing, channel, message).Err(); err != nil && holding.Err() == nil {
			h.logger.Debug("republication temps réel perdue", "error", err)
		}
	})

	lost := make(chan struct{})
	renewed := make(chan time.Time, 1)

	var workers sync.WaitGroup

	workers.Go(func() { h.renew(holding, leader, renewed, lost) })
	workers.Go(func() { h.beat(holding, view) })

	for _, f := range feeds {
		workers.Go(func() { h.consume(holding, f, dial, view) })
	}

	margin := h.leaseTTL - h.leaseEvery

	deadline := time.NewTimer(time.Until(asked.Add(margin)))
	defer deadline.Stop()

	for held := true; held; {
		select {
		case <-ctx.Done():
			held = false

		case <-lost:
			h.logger.Warn("bail temps réel perdu : les flux amont s'arrêtent")
			held = false

		case at := <-renewed:
			deadline.Reset(time.Until(at.Add(margin)))

		case <-deadline.C:
			h.logger.Warn("bail temps réel non renouvelé à temps : les flux amont s'arrêtent")
			held = false
		}
	}

	stopHolding()
	workers.Wait()

	if ctx.Err() != nil {
		// Rendu à l'arrêt propre, pour qu'un successeur n'attende pas son expiration.
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), writeTimeout)
		defer cancel()

		if err := leader.release(releaseCtx); err != nil {
			h.logger.Debug("bail temps réel non rendu", "error", err)
		}
	}
}

// renew signale chaque renouvellement réussi, avec l'instant où il a été demandé. Une erreur n'est
// pas une perte : l'échéance locale tranche. Seul un refus explicite — la valeur a changé — en est une.
func (h *Hub) renew(ctx context.Context, leader lease, renewed chan time.Time, lost chan<- struct{}) {
	ticker := time.NewTicker(h.leaseEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		asked := time.Now()

		attempt, cancel := context.WithTimeout(ctx, h.leaseEvery)
		ok, err := leader.renew(attempt)
		cancel()

		switch {
		case err != nil:
			if ctx.Err() == nil {
				h.logger.Debug("bail temps réel non renouvelé", "error", err)
			}
		case !ok:
			close(lost)

			return
		default:
			select {
			case <-renewed:
			default:
			}
			renewed <- asked
		}
	}
}

// beat publie l'état des sujets dès la prise du bail, puis toutes les heartbeatEvery.
func (h *Hub) beat(ctx context.Context, view *leaderView) {
	ticker := time.NewTicker(h.heartbeatEvery)
	defer ticker.Stop()

	for {
		view.publish(view.heartbeat())

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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

	// Armé dès le départ et jamais désarmé : un état live reçu sans battement ensuite doit finir
	// stale. markStale ne touche que les sujets live, le rappeler à chaque tick ne coûte rien.
	lastBeat := time.Now()

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
			if time.Since(lastBeat) > h.heartbeatTimeout {
				since := lastBeat.UTC()
				h.markStale(&since)
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

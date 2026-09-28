// Package hub agrège les trois flux temps réel de l'API Admin et les ré-émet par sujet, une socket par
// opérateur (§4.2, §5.2).
package hub

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

const (
	// queueSize borne ce qu'une socket peut avoir en retard. Au-delà, elle est coupée : jeter des trames
	// une à une pourrait perdre une annonce `stale` sans que personne le voie.
	queueSize = 64

	maxClientMessage = 4 << 10
	// maxUpstreamFrame laisse de la marge à un instantané de métriques : le défaut de coder/websocket,
	// 32 Kio, couperait le flux à la première grosse trame.
	maxUpstreamFrame = 1 << 20

	writeTimeout = 5 * time.Second

	firstBackoff = time.Second
	maxBackoff   = 30 * time.Second

	statusSessionEnded websocket.StatusCode = 4401

	goingAway = "Le serveur s'arrête : la connexion va se rétablir."
)

// Access dit si la session de la socket est encore vivante, et quelles permissions elle porte.
type Access func(ctx context.Context) (alive bool, permissions []string, err error)

// Dialer ouvre un flux de l'API Admin, désigné par son chemin. onPing est appelé à chaque ping de la
// passerelle : c'est ce qui prouve qu'un flux silencieux est encore vivant.
type Dialer func(ctx context.Context, path string, onPing func()) (*websocket.Conn, error)

type Hub struct {
	logger          *slog.Logger
	record          Recorder
	instance        string
	revalidateEvery time.Duration

	// Le bail vit 6 s et se renouvelle toutes les 2 s : un porteur tué est remplacé en 8 s au plus.
	leaseTTL   time.Duration
	leaseEvery time.Duration
	// Trois battements manqués rendent les sujets `stale`.
	heartbeatEvery   time.Duration
	heartbeatTimeout time.Duration
	// La passerelle pingue toutes les 20 s (`go-gateway/internal/adminapi/stream.go`) : 60 s, soit
	// trois intervalles, tolèrent un ping en retard avec marge.
	upstreamSilence time.Duration

	mu          sync.Mutex
	subscribers map[Topic]map[*client]struct{}
	statuses    map[Topic]statusMessage
	// serving compte les sockets de Serve ; draining, posé sous mu, ferme la porte avant l'attente :
	// un Add concurrent d'un Wait déjà commencé est une course.
	serving  sync.WaitGroup
	open     int
	draining bool

	stopping chan struct{}
}

// New prend un record nil dans les tests seulement : aucune notification n'est alors écrite.
func New(logger *slog.Logger, record Recorder) *Hub {
	statuses := map[Topic]statusMessage{}
	for _, s := range subjects {
		statuses[s.topic] = statusMessage{Topic: s.topic, Status: "stale"}
	}

	return &Hub{
		logger:           logger,
		record:           record,
		instance:         rand.Text(),
		revalidateEvery:  30 * time.Second,
		leaseTTL:         6 * time.Second,
		leaseEvery:       2 * time.Second,
		heartbeatEvery:   2 * time.Second,
		heartbeatTimeout: 6 * time.Second,
		upstreamSilence:  60 * time.Second,
		subscribers:      map[Topic]map[*client]struct{}{},
		statuses:         statuses,
		stopping:         make(chan struct{}),
	}
}

type client struct {
	queue       chan []byte
	lagging     chan struct{}
	markLagging sync.Once
	granted     []string
}

// offer n'attend jamais : un client en retard ne ralentit ni le flux amont, ni les autres sockets.
func (c *client) offer(frame []byte) {
	select {
	case c.queue <- frame:
	default:
		c.markLagging.Do(func() { close(c.lagging) })
	}
}

func (h *Hub) publish(topic Topic, frame []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.subscribers[topic] {
		c.offer(frame)
	}
}

func (h *Hub) publishNotification(frame []byte, source string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.subscribers[NotificationsTopic] {
		if permissions.NotificationSourceAllowed(source, c.granted) {
			c.offer(frame)
		}
	}
}

// setStatus reporte l'état de `billing.alerts` sur `notifications`, qui n'a pas d'autre source. Le
// report se fait ici, et non chez le porteur, pour que les instances qui suivent le fassent aussi.
func (h *Hub) setStatus(message statusMessage) {
	h.applyStatus(message)

	if message.Topic == BillingTopic {
		message.Topic = NotificationsTopic
		h.applyStatus(message)
	}
}

// applyStatus ne rediffuse qu'un changement : le battement de cœur republie tous les états toutes les
// 2 s, et les clients n'ont pas à les recevoir à chaque fois.
func (h *Hub) applyStatus(message statusMessage) {
	h.mu.Lock()
	current, known := h.statuses[message.Topic]
	unchanged := known && current.Status == message.Status && sameInstant(current.Since, message.Since)
	h.statuses[message.Topic] = message
	h.mu.Unlock()

	if !unchanged {
		h.publish(message.Topic, mustMarshal(message))
	}
}

func (h *Hub) status(topic Topic) string {
	h.mu.Lock()
	defer h.mu.Unlock()

	return h.statuses[topic].Status
}

func sameInstant(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

// subscribe envoie l'état courant du sujet sous le verrou : aucune trame ne peut le précéder.
func (h *Hub) subscribe(c *client, topic Topic) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.subscribers[topic] == nil {
		h.subscribers[topic] = map[*client]struct{}{}
	}

	if _, already := h.subscribers[topic][c]; already {
		return
	}

	h.subscribers[topic][c] = struct{}{}
	c.offer(mustMarshal(h.statuses[topic]))
}

func (h *Hub) unsubscribe(c *client, topic Topic) {
	h.mu.Lock()
	defer h.mu.Unlock()

	delete(h.subscribers[topic], c)
}

func (h *Hub) unsubscribeAll(c *client) {
	for _, s := range subjects {
		h.unsubscribe(c, s.topic)
	}
}

func (h *Hub) setGranted(c *client, granted []string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	c.granted = granted
}

// Serve tient une socket client jusqu'à sa fermeture, l'annulation de ctx ou l'arrêt du hub. Toutes
// les écritures passent par la file, depuis cette seule goroutine.
func (h *Hub) Serve(ctx context.Context, conn *websocket.Conn, access Access) {
	defer func() { _ = conn.CloseNow() }()

	// (critère 4) montée tardive non comptée : l'arrêt n'attend ni sa réponse, ni qu'elle traîne.
	if !h.enter() {
		_ = conn.Close(websocket.StatusGoingAway, goingAway)

		return
	}
	defer h.leave()

	conn.SetReadLimit(maxClientMessage)

	alive, granted, err := access(ctx)
	if err != nil || !alive {
		h.closeForSession(conn, err)

		return
	}

	readCtx, stopReading := context.WithCancel(ctx)
	defer stopReading()

	c := &client{queue: make(chan []byte, queueSize), lagging: make(chan struct{})}
	h.setGranted(c, granted)
	defer h.unsubscribeAll(c)

	requests := make(chan []byte)
	go read(readCtx, conn, requests)

	revalidation := time.NewTicker(h.revalidateEvery)
	defer revalidation.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-h.stopping:
			_ = conn.Close(websocket.StatusGoingAway, goingAway)

			return

		case <-c.lagging:
			_ = conn.Close(websocket.StatusPolicyViolation,
				"Connexion trop lente : les messages en retard ont été abandonnés.")

			return

		case raw, open := <-requests:
			if !open {
				return
			}

			h.handle(c, raw, granted)

		case frame := <-c.queue:
			// Une écriture bloquée par un client qui ne lit plus s'arrête ici. L'annuler plus tôt
			// fermerait la connexion avant que le 1008 parte, y compris quand elle aurait pu partir.
			writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			err = conn.Write(writeCtx, websocket.MessageText, frame)
			cancel()

			if err != nil {
				return
			}

		case <-revalidation.C:
			checkCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			alive, granted, err = access(checkCtx)
			cancel()

			if err != nil || !alive {
				h.closeForSession(conn, err)

				return
			}

			h.setGranted(c, granted)
			h.dropForbidden(c, granted)
		}
	}
}

func (h *Hub) enter() bool {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.draining {
		return false
	}

	h.serving.Add(1)
	h.open++

	return true
}

func (h *Hub) leave() {
	h.mu.Lock()
	h.open--
	h.mu.Unlock()

	h.serving.Done()
}

func read(ctx context.Context, conn *websocket.Conn, requests chan<- []byte) {
	defer close(requests)

	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			return
		}

		select {
		case requests <- raw:
		case <-ctx.Done():
			return
		}
	}
}

func (h *Hub) closeForSession(conn *websocket.Conn, err error) {
	if err != nil {
		h.logger.Error("la session d'une socket n'a pas pu être vérifiée", "error", err)
		_ = conn.Close(websocket.StatusInternalError,
			"Le serveur n'a pas pu vérifier la session : la connexion va se rétablir.")

		return
	}

	_ = conn.Close(statusSessionEnded, "La session a pris fin : reconnectez-vous pour rétablir le temps réel.")
}

func (h *Hub) handle(c *client, raw []byte, granted []string) {
	var request clientMessage
	if err := json.Unmarshal(raw, &request); err != nil ||
		(request.Action != "subscribe" && request.Action != "unsubscribe") {
		c.offer(mustMarshal(errorMessage{Error: Error{
			Code: "invalid_message",
			Message: "Ce message n'a pas été compris : seules les actions subscribe et unsubscribe, avec " +
				"une liste de sujets, sont acceptées.",
		}}))

		return
	}

	for _, name := range request.Topics {
		s, known := subjectOf(Topic(name))
		if !known {
			c.offer(mustMarshal(errorMessage{Topic: name, Error: Error{
				Code:    "unknown_topic",
				Message: "Le sujet « " + name + " » n'existe pas : rien ne sera diffusé sous ce nom.",
			}}))

			continue
		}

		switch {
		case request.Action == "unsubscribe":
			h.unsubscribe(c, s.topic)
		case allowed(s, granted):
			h.subscribe(c, s.topic)
		default:
			c.offer(mustMarshal(forbidden(s)))
		}
	}
}

func (h *Hub) dropForbidden(c *client, granted []string) {
	for _, s := range subjects {
		if allowed(s, granted) {
			continue
		}

		h.mu.Lock()
		_, subscribed := h.subscribers[s.topic][c]
		delete(h.subscribers[s.topic], c)
		h.mu.Unlock()

		if subscribed {
			c.offer(mustMarshal(forbidden(s)))
		}
	}
}

func allowed(s subject, granted []string) bool {
	return s.permission == "" || slices.Contains(granted, string(s.permission))
}

func forbidden(s subject) errorMessage {
	return errorMessage{Topic: string(s.topic), Error: Error{
		Code: "permission_denied",
		Message: "Ce sujet n'est pas diffusé à votre compte : il demande la permission « " +
			string(s.permission) + " ». Un administrateur peut vous l'accorder.",
	}}
}

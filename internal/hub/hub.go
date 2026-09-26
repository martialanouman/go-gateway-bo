// Package hub agrège les trois flux temps réel de l'API Admin et les ré-émet par sujet, une socket par
// opérateur (§4.2, §5.2).
package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"slices"
	"sync"
	"time"

	"github.com/coder/websocket"
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
)

// Access dit si la session de la socket est encore vivante, et quelles permissions elle porte.
type Access func(ctx context.Context) (alive bool, permissions []string, err error)

// Dialer ouvre un flux de l'API Admin, désigné par son chemin.
type Dialer func(ctx context.Context, path string) (*websocket.Conn, error)

type Hub struct {
	logger          *slog.Logger
	revalidateEvery time.Duration

	mu          sync.Mutex
	subscribers map[Topic]map[*client]struct{}
	statuses    map[Topic]statusMessage

	stopping chan struct{}
}

func New(logger *slog.Logger) *Hub {
	statuses := map[Topic]statusMessage{}
	for _, f := range feeds {
		statuses[f.topic] = statusMessage{Topic: f.topic, Status: "stale"}
	}

	return &Hub{
		logger:          logger,
		revalidateEvery: 30 * time.Second,
		subscribers:     map[Topic]map[*client]struct{}{},
		statuses:        statuses,
		stopping:        make(chan struct{}),
	}
}

type client struct {
	queue   chan []byte
	lagging chan struct{}
	// abandon interrompt l'écriture en cours : sur une fenêtre TCP pleine, elle tiendrait la socket
	// jusqu'à writeTimeout.
	abandon     context.CancelFunc
	markLagging sync.Once
}

// offer n'attend jamais : un client en retard ne ralentit ni le flux amont, ni les autres sockets.
func (c *client) offer(frame []byte) {
	select {
	case c.queue <- frame:
	default:
		c.markLagging.Do(func() {
			close(c.lagging)
			c.abandon()
		})
	}
}

func (h *Hub) publish(topic Topic, frame []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.subscribers[topic] {
		c.offer(frame)
	}
}

func (h *Hub) setStatus(topic Topic, status string, since *time.Time) {
	message := statusMessage{Topic: topic, Status: status, Since: since}

	h.mu.Lock()
	h.statuses[topic] = message
	h.mu.Unlock()

	h.publish(topic, mustMarshal(message))
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
	for _, f := range feeds {
		h.unsubscribe(c, f.topic)
	}
}

// Serve tient une socket client jusqu'à sa fermeture, l'annulation de ctx ou l'arrêt du hub. Toutes
// les écritures passent par la file, depuis cette seule goroutine.
func (h *Hub) Serve(ctx context.Context, conn *websocket.Conn, access Access) {
	defer func() { _ = conn.CloseNow() }()

	conn.SetReadLimit(maxClientMessage)

	alive, granted, err := access(ctx)
	if err != nil || !alive {
		h.closeForSession(conn, err)

		return
	}

	clientCtx, abandon := context.WithCancel(ctx)
	defer abandon()

	c := &client{queue: make(chan []byte, queueSize), lagging: make(chan struct{}), abandon: abandon}
	defer h.unsubscribeAll(c)

	requests := make(chan []byte)
	go read(clientCtx, conn, requests)

	revalidation := time.NewTicker(h.revalidateEvery)
	defer revalidation.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-h.stopping:
			_ = conn.Close(websocket.StatusGoingAway, "Le serveur s'arrête : la connexion va se rétablir.")

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
			writeCtx, cancel := context.WithTimeout(clientCtx, writeTimeout)
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

			h.dropForbidden(c, granted)
		}
	}
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
		f, known := feedOf(Topic(name))
		if !known {
			c.offer(mustMarshal(errorMessage{Topic: name, Error: Error{
				Code:    "unknown_topic",
				Message: "Le sujet « " + name + " » n'existe pas : rien ne sera diffusé sous ce nom.",
			}}))

			continue
		}

		switch {
		case request.Action == "unsubscribe":
			h.unsubscribe(c, f.topic)
		case allowed(f, granted):
			h.subscribe(c, f.topic)
		default:
			c.offer(mustMarshal(forbidden(f)))
		}
	}
}

func (h *Hub) dropForbidden(c *client, granted []string) {
	for _, f := range feeds {
		if allowed(f, granted) {
			continue
		}

		h.mu.Lock()
		_, subscribed := h.subscribers[f.topic][c]
		delete(h.subscribers[f.topic], c)
		h.mu.Unlock()

		if subscribed {
			c.offer(mustMarshal(forbidden(f)))
		}
	}
}

func allowed(f feed, granted []string) bool {
	return f.permission == "" || slices.Contains(granted, string(f.permission))
}

func forbidden(f feed) errorMessage {
	return errorMessage{Topic: string(f.topic), Error: Error{
		Code: "permission_denied",
		Message: "Ce sujet n'est pas diffusé à votre compte : il demande la permission « " +
			string(f.permission) + " ». Un administrateur peut vous l'accorder.",
	}}
}

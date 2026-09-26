package hub

import (
	"context"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Run consomme les trois flux amont jusqu'à l'annulation de ctx, puis ferme toutes les sockets client.
func (h *Hub) Run(ctx context.Context, dial Dialer) {
	var consumers sync.WaitGroup

	for _, f := range feeds {
		consumers.Go(func() { h.consume(ctx, f, dial) })
	}

	<-ctx.Done()
	close(h.stopping)
	consumers.Wait()
}

// consume garde un flux ouvert. Invariant (e) : sa chute rend son seul sujet `stale`, horodaté, et
// ne touche pas aux autres.
func (h *Hub) consume(ctx context.Context, f feed, dial Dialer) {
	backoff := firstBackoff

	for {
		conn, err := dial(ctx, f.path)
		if err == nil {
			h.setStatus(f.topic, "live", nil)

			connected := time.Now()
			err = h.pump(ctx, conn, f)

			// Seule une connexion qui a tenu remet le backoff à zéro : un amont qui ferme aussitôt
			// ouvert serait sinon rappelé chaque seconde.
			if time.Since(connected) >= maxBackoff {
				backoff = firstBackoff
			}

			since := time.Now().UTC()
			h.setStatus(f.topic, "stale", &since)
		}

		if ctx.Err() != nil {
			return
		}

		h.logger.Debug("flux amont indisponible", "path", f.path, "retry_in", backoff.String(), "error", err)

		retry := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			retry.Stop()

			return
		case <-retry.C:
		}

		backoff = min(backoff*2, maxBackoff)
	}
}

func (h *Hub) pump(ctx context.Context, conn *websocket.Conn, f feed) error {
	defer func() { _ = conn.CloseNow() }()

	conn.SetReadLimit(maxUpstreamFrame)

	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			return err
		}

		frame, err := f.relay(raw)
		if err != nil {
			h.logger.Warn("trame amont écartée", "path", f.path, "error", err)

			continue
		}

		h.publish(f.topic, frame)
	}
}

package hub

import (
	"context"
	"errors"
	"time"

	"github.com/coder/websocket"
)

var errUpstreamSilent = errors.New("flux amont muet au-delà de son échéance")

// consume garde un flux ouvert tant que l'instance porte le bail. Invariant (e) : sa chute rend son
// seul sujet `stale`, horodaté, et ne touche pas aux autres.
func (h *Hub) consume(ctx context.Context, f feed, dial Dialer, view *leaderView) {
	backoff := firstBackoff

	for {
		alive := make(chan struct{}, 1)

		conn, err := dial(ctx, f.path, func() {
			select {
			case alive <- struct{}{}:
			default:
			}
		})
		if err == nil {
			view.set(f.topic, "live", nil)

			connected := time.Now()
			err = h.pump(ctx, conn, f, view, alive)

			// Seule une connexion qui a tenu remet le backoff à zéro : un amont qui ferme aussitôt
			// ouvert serait sinon rappelé chaque seconde.
			if time.Since(connected) >= maxBackoff {
				backoff = firstBackoff
			}

			since := time.Now().UTC()
			view.set(f.topic, "stale", &since)
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

// pump relaie un flux jusqu'à sa chute. Une passerelle partie sans fermer la connexion
// laisserait `Read` bloqué et le sujet `live` ; une trame valide ou un ping réarme l'échéance, rien
// d'autre.
func (h *Hub) pump(ctx context.Context, conn *websocket.Conn, f feed, view *leaderView, alive <-chan struct{}) error {
	defer func() { _ = conn.CloseNow() }()

	// Fermée dès l'annulation, même si la boucle est bloquée dans une publication vers Redis : à
	// l'échéance locale du bail, la passerelle doit être lâchée tout de suite.
	stopClosing := context.AfterFunc(ctx, func() { _ = conn.CloseNow() })
	defer stopClosing()

	conn.SetReadLimit(maxUpstreamFrame)

	readCtx, stopReading := context.WithCancel(ctx)
	defer stopReading()

	frames := make(chan []byte)
	failed := make(chan error, 1)

	go func() {
		for {
			_, raw, err := conn.Read(readCtx)
			if err != nil {
				failed <- err

				return
			}

			select {
			case frames <- raw:
			case <-readCtx.Done():
				return
			}
		}
	}()

	silence := time.NewTimer(h.upstreamSilence)
	defer silence.Stop()

	warned := false

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()

		case err := <-failed:
			return err

		case <-silence.C:
			return errUpstreamSilent

		case <-alive:
			silence.Reset(h.upstreamSilence)

		case raw := <-frames:
			frame, err := f.relay(raw)
			if err != nil {
				if !warned {
					h.logger.Warn("trames amont écartées sur cette connexion", "path", f.path, "error", err)
					warned = true
				}

				continue
			}

			silence.Reset(h.upstreamSilence)
			view.publish(frame)
		}
	}
}

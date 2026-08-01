package bff

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

const readHeaderTimeout = 10 * time.Second

// Serve écoute jusqu'à l'annulation de ctx, puis laisse aux requêtes en vol le
// temps de grâce avant de fermer.
//
// Le listener est un paramètre plutôt qu'une adresse : les tests écoutent sur un
// port éphémère, et l'échec d'écoute se diagnostique à l'appelant, avant qu'une
// goroutine ne soit lancée.
func Serve(ctx context.Context, listener net.Listener, handler http.Handler, grace time.Duration) error {
	server := &http.Server{Handler: handler, ReadHeaderTimeout: readHeaderTimeout}

	serveErr := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		serveErr <- err
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}

	// `WithoutCancel` est porteur : ctx est déjà annulé à ce point, et en dériver
	// un délai rendrait la grâce nulle — les requêtes en vol seraient coupées.
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), grace)
	defer cancel()

	return errors.Join(server.Shutdown(shutdownCtx), <-serveErr)
}

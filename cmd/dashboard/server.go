package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// readHeaderTimeout borne le temps qu'une connexion peut passer à n'envoyer que des en-têtes. Sans
// lui, quelques dizaines de connexions ouvertes et muettes suffisent à saturer le serveur.
//
// `ReadTimeout` et `WriteTimeout` restent délibérément à zéro : ils couperaient la WebSocket que le
// hub ouvrira en M2, dont c'est le métier de rester ouverte. Un corps de requête lent n'est donc pas
// borné aujourd'hui — c'est un report assumé, pas un oubli. Aucun test ne rougit si cette constante
// disparaît : le vérifier demanderait de tenir une connexion muette assez longtemps pour que le
// test dure plus que la porte qu'il garde.
const readHeaderTimeout = 10 * time.Second

// serve sert jusqu'à l'annulation de ctx, puis laisse aux requêtes en vol le délai de grâce pour se
// terminer avant de fermer.
//
// Le contexte n'est **pas** passé aux requêtes : l'annuler couperait précisément celles que le délai
// de grâce est là pour laisser finir.
func serve(
	ctx context.Context,
	ln net.Listener,
	handler http.Handler,
	grace time.Duration,
	logger *slog.Logger,
) error {
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
	}

	// Une postcondition unique quel que soit le chemin : quand serve rend la main, plus rien n'est
	// servi. No-op après un arrêt réussi ; après un délai de grâce expiré, c'est ce qui coupe les
	// connexions que l'attente n'a pas suffi à libérer.
	defer func() { _ = srv.Close() }()

	closed := make(chan error, 1)
	go func() {
		err := srv.Serve(ln)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}

		closed <- err
	}()

	select {
	case err := <-closed:
		return err
	case <-ctx.Done():
	}

	logger.Info("arrêt demandé, attente des requêtes en vol", "grace", grace.String())

	// WithoutCancel est ce qui donne son sens au délai : ctx est déjà annulé, et en dériver
	// directement rendrait un contexte expiré, donc un arrêt immédiat.
	graceCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), grace)
	defer cancel()

	if err := srv.Shutdown(graceCtx); err != nil {
		return fmt.Errorf("arrêt interrompu après %s : %w", grace, err)
	}

	logger.Info("le serveur s'est arrêté")

	return <-closed
}

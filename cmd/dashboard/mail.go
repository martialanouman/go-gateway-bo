package main

import (
	"context"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strings"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const crlf = "\r\n"

// smtpDialTimeout borne la connexion, smtpDeadline la conversation entière : le store tient la
// transaction et le verrou de ligne pendant tout l'envoi, donc les deux doivent rester courts.
const (
	smtpDialTimeout = 10 * time.Second
	smtpDeadline    = 30 * time.Second
)

// composeAccessLinkMail écrit le message SMTP en clair, en-têtes et corps CRLF compris (RFC 5322).
func composeAccessLinkMail(product, from, publicURL string, link store.PendingLink, token string) string {
	subject := mime.QEncoding.Encode("UTF-8", fmt.Sprintf("%s : votre lien d'accès", product))

	headers := strings.Join([]string{
		"From: " + from,
		"To: " + link.Email,
		"Subject: " + subject,
		"Date: " + time.Now().Format(time.RFC1123Z),
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: 8bit",
	}, crlf)

	return headers + crlf + crlf + accessLinkBody(product, publicURL, link, token)
}

// formatDuration rend une durée en heures entières et en français, seule unité que store.ActivationTTL
// et store.ResetTTL expriment.
func formatDuration(d time.Duration) string {
	hours := int(d.Hours())
	if hours == 1 {
		return "1 heure"
	}

	return fmt.Sprintf("%d heures", hours)
}

func accessLinkBody(product, publicURL string, link store.PendingLink, token string) string {
	ttl := store.ActivationTTL
	consequence := "Il permet de choisir un mot de passe et d'activer le compte."

	if link.Kind == store.LinkReset {
		ttl = store.ResetTTL
		consequence = "À son usage, le mot de passe et le second facteur seront remplacés et les " +
			"sessions en cours seront fermées."
	}

	return strings.Join([]string{
		"Bonjour " + link.DisplayName + ",",
		"",
		"Un lien d'accès a été créé pour votre compte " + product + " : " + publicURL + "/access#" + token,
		"",
		"Ce lien reste valable " + formatDuration(ttl) + " et ne peut être utilisé qu'une seule fois. " +
			consequence,
		"",
		"Si vous n'attendiez pas ce message, ignorez-le : rien ne change tant que le lien n'est pas " +
			"utilisé.",
	}, crlf)
}

// smtpSender envoie chaque lien par net/smtp, sans STARTTLS ni AUTH (hors périmètre, Mailpit n'en
// exige aucun). Le worker ne porte aucune requête HTTP : il n'y a pas d'en-tête Host à lire, donc la
// base des liens vient de la configuration, jamais de la requête qui a demandé le lien.
//
// L'erreur rendue ne cite ni le message, ni le jeton, ni l'adresse du destinataire : le store en
// journalise le détail sans jamais leur donner d'empreinte publique.
func smtpSender(cfg config.MailConfig, product string) store.SendLink {
	return func(ctx context.Context, link store.PendingLink, token string) error {
		conn, err := net.DialTimeout("tcp", cfg.Addr, smtpDialTimeout)
		if err != nil {
			return fmt.Errorf("connexion au serveur SMTP : %w", err)
		}
		defer conn.Close()

		if err = conn.SetDeadline(time.Now().Add(smtpDeadline)); err != nil {
			return fmt.Errorf("délai de la connexion SMTP : %w", err)
		}

		// Le seul lien entre ctx et une conn qui ne le connaît pas : fermer la connexion annule tout
		// appel bloqué dessus, sans attendre le plafond de 30 s posé ci-dessus.
		done := make(chan struct{})
		defer close(done)

		go func() {
			select {
			case <-ctx.Done():
				_ = conn.Close()
			case <-done:
			}
		}()

		host, _, err := net.SplitHostPort(cfg.Addr)
		if err != nil {
			return fmt.Errorf("hôte SMTP : %w", err)
		}

		client, err := smtp.NewClient(conn, host)
		if err != nil {
			return fmt.Errorf("poignée de main SMTP : %w", err)
		}
		defer client.Close()

		if err = client.Mail(cfg.From); err != nil {
			return fmt.Errorf("commande MAIL SMTP : %w", err)
		}

		if err = client.Rcpt(link.Email); err != nil {
			return fmt.Errorf("commande RCPT SMTP : %w", err)
		}

		writer, err := client.Data()
		if err != nil {
			return fmt.Errorf("commande DATA SMTP : %w", err)
		}

		message := composeAccessLinkMail(product, cfg.From, cfg.PublicURL, link, token)

		if _, err = writer.Write([]byte(message)); err != nil {
			_ = writer.Close()

			return fmt.Errorf("écriture du message SMTP : %w", err)
		}

		if err = writer.Close(); err != nil {
			return fmt.Errorf("clôture du message SMTP : %w", err)
		}

		return client.Quit()
	}
}

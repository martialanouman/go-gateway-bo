package main

import (
	"bufio"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

func TestLeLienPartDeLAdressePubliqueEtJamaisDAilleurs(t *testing.T) {
	message := composeAccessLinkMail("Cockpit", "ops@exemple.test", "https://cockpit.exemple.test",
		store.PendingLink{
			Email: "nadia@exemple.test", DisplayName: "Nadia", Kind: store.LinkActivation,
			ExpiresAt: time.Now().Add(store.ActivationTTL),
		}, "JETON")

	assert.Contains(t, message, "https://cockpit.exemple.test/access#JETON")
	assert.Contains(t, message, "valable 72 heures et")
	assert.Contains(t, message,
		"Si vous n'attendiez pas ce message, ignorez-le : rien ne change tant que le lien n'est pas "+
			"utilisé.")
	assert.Contains(t, message, "Content-Type: text/plain; charset=utf-8")
}

func TestLeLienDeResetDitCeQueSonUsageChange(t *testing.T) {
	message := composeAccessLinkMail("Cockpit", "ops@exemple.test", "https://cockpit.exemple.test",
		store.PendingLink{
			Email: "nadia@exemple.test", DisplayName: "Nadia", Kind: store.LinkReset,
			ExpiresAt: time.Now().Add(store.ResetTTL),
		}, "JETON")

	assert.Contains(t, message, "https://cockpit.exemple.test/access#JETON")
	// "Contains" seul passerait aussi pour "1 heures" : la borne exacte du singulier compte.
	assert.Contains(t, message, "valable 1 heure et")
	assert.NotContains(t, message, "1 heures")
	assert.Contains(t, message, "le mot de passe et le second facteur seront remplacés")
	assert.Contains(t, message, "les sessions")
	assert.Contains(t, message,
		"Si vous n'attendiez pas ce message, ignorez-le : rien ne change tant que le lien n'est pas "+
			"utilisé.")
}

// Un message SMTP est délimité en CRLF (RFC 5321 §2.3.1) : un simple "\n" est ce qu'un client mail
// tolérant masquerait, et Mailpit non.
func TestLeMessageEstDelimiteEnCRLF(t *testing.T) {
	message := composeAccessLinkMail("Cockpit", "ops@exemple.test", "https://cockpit.exemple.test",
		store.PendingLink{
			Email: "nadia@exemple.test", DisplayName: "Nadia", Kind: store.LinkActivation,
			ExpiresAt: time.Now().Add(store.ActivationTTL),
		}, "JETON")

	assert.Contains(t, message, "\r\n\r\n")
	assert.NotContains(t, message, "\n\n")
}

// Les en-têtes obligatoires d'un message SMTP minimal : sans eux, certains relais (Mailpit compris,
// selon la RFC 5322 §3.6) refusent ou horodatent le message eux-mêmes.
func TestLesEnTetesObligatoiresSontPresents(t *testing.T) {
	message := composeAccessLinkMail("Cockpit", "ops@exemple.test", "https://cockpit.exemple.test",
		store.PendingLink{
			Email: "nadia@exemple.test", DisplayName: "Nadia", Kind: store.LinkActivation,
			ExpiresAt: time.Now().Add(store.ActivationTTL),
		}, "JETON")

	assert.Contains(t, message, "From: ops@exemple.test")
	assert.Contains(t, message, "To: nadia@exemple.test")
	assert.Contains(t, message, "MIME-Version: 1.0")
	assert.Contains(t, message, "Content-Transfer-Encoding: 8bit")
	assert.Contains(t, message, "Date: ")
}

// fakeSMTPServer répond à la main aux trois premières étapes d'une conversation SMTP (EHLO, MAIL
// FROM), puis à RCPT TO avec la réplique donnée — celle d'un vrai serveur, texte compris. Elle rend
// l'adresse d'écoute et s'arrête d'elle-même après une connexion.
func fakeSMTPServer(t *testing.T, rcptReply string) string {
	t.Helper()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		reader := bufio.NewReader(conn)
		fmt.Fprint(conn, "220 fake.test Service ready\r\n")
		_, _ = reader.ReadString('\n') // EHLO
		fmt.Fprint(conn, "250 fake.test\r\n")
		_, _ = reader.ReadString('\n') // MAIL FROM
		fmt.Fprint(conn, "250 OK\r\n")
		_, _ = reader.ReadString('\n') // RCPT TO
		fmt.Fprint(conn, rcptReply+"\r\n")
	}()

	return ln.Addr().String()
}

// Un refus RCPT réel cite couramment l'adresse rejetée dans son texte (RFC 5321 §4.2, exemple
// classique du code 550) : ce test prouve que ce texte n'atteint jamais l'erreur rendue par
// smtpSender, ni le jeton ni le corps du message qu'un serveur plus bavard pourrait aussi citer.
func TestUnRefusRCPTNeCiteNiLAdresseNiLeJetonNiLeCorps(t *testing.T) {
	addr := fakeSMTPServer(t, "550 5.1.1 <nadia@exemple.test>: Recipient address rejected")

	send := smtpSender(config.MailConfig{
		Addr: addr, From: "ops@exemple.test", PublicURL: "https://cockpit.exemple.test",
	}, "Cockpit")

	err := send(t.Context(), store.PendingLink{
		Email: "nadia@exemple.test", DisplayName: "Nadia", Kind: store.LinkActivation,
		ExpiresAt: time.Now().Add(store.ActivationTTL),
	}, "JETON-SECRET")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "550")
	assert.NotContains(t, err.Error(), "nadia@exemple.test")
	assert.NotContains(t, err.Error(), "JETON-SECRET")
	assert.NotContains(t, err.Error(), "Recipient address rejected")
}

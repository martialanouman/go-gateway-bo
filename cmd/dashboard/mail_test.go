package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

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

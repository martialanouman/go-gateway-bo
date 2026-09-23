package bff

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// Les bornes du contrat se comptent en caractères : cent lettres accentuées font deux cents octets,
// et un compte en octets refuserait un nom que le client, qui compte en caractères, a laissé passer.
func TestLesBornesSeComptentEnCaracteres(t *testing.T) {
	t.Parallel()

	assert.True(t, within(strings.Repeat("é", 100), 1, 100))
	assert.False(t, within(strings.Repeat("é", 101), 1, 100))
	assert.False(t, within("ab", 3, 320), "une adresse sous la borne basse passe")
}

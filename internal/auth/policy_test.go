package auth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// La borne se compte en caractères et non en octets : douze lettres accentuées font vingt-quatre
// octets, et onze en font vingt-deux — un compte en octets accepterait les deux.
func TestLaPolitiqueCompteDesCaracteresEtNonDesOctets(t *testing.T) {
	assert.True(t, PasswordLongEnough(strings.Repeat("é", MinimumPasswordLength)))
	assert.False(t, PasswordLongEnough(strings.Repeat("é", MinimumPasswordLength-1)))
}

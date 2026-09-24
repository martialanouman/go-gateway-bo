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

func TestCheckPasswordNamesWhatIsMissing(t *testing.T) {
	for password, missing := range map[string][]string{
		"Abcdefghij1!":  nil,
		"Ab1!":          {"douze caractères au moins"},
		"abcdefghij1!":  {"une majuscule"},
		"ABCDEFGHIJ1!":  {"une minuscule"},
		"Abcdefghijk!":  {"un chiffre"},
		"Abcdefghijk1":  {"un caractère spécial"},
		"Élévationxx1 ": nil, // majuscule accentuée, espace = caractère spécial
	} {
		assert.Equal(t, missing, CheckPassword(password), password)
	}
}

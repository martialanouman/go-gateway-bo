package auth

import (
	"unicode"
	"unicode/utf8"
)

// MinimumPasswordLength est la borne de longueur, commune à `PasswordLongEnough` et `CheckPassword`.
const MinimumPasswordLength = 12

func PasswordLongEnough(password string) bool {
	return utf8.RuneCountInString(password) >= MinimumPasswordLength
}

// CheckPassword rend ce qui manque, en français ; vide veut dire conforme.
//
// La composition est un choix de l'utilisateur contre SP 800-63B, signalé le 24/09/2026.
func CheckPassword(password string) []string {
	var upper, lower, digit, special bool

	for _, r := range password {
		switch {
		case unicode.IsUpper(r):
			upper = true
		case unicode.IsLower(r):
			lower = true
		case unicode.IsDigit(r):
			digit = true
		case !unicode.IsLetter(r):
			special = true
		}
	}

	var missing []string

	for _, rule := range []struct {
		ok   bool
		name string
	}{
		{utf8.RuneCountInString(password) >= MinimumPasswordLength, "douze caractères au moins"},
		{upper, "une majuscule"},
		{lower, "une minuscule"},
		{digit, "un chiffre"},
		{special, "un caractère spécial"},
	} {
		if !rule.ok {
			missing = append(missing, rule.name)
		}
	}

	return missing
}

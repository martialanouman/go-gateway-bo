package auth

import "unicode/utf8"

// MinimumPasswordLength est la seule politique de mot de passe du produit, pour le compte
// propriétaire du bootstrap comme pour ceux que crée `operators:manage`. Aucune exigence de
// composition : la longueur est la seule contrainte dont l'effet sur la difficulté se démontre, là où
// « une majuscule et un chiffre » produit surtout `Motdepasse1`.
const MinimumPasswordLength = 12

func PasswordLongEnough(password string) bool {
	return utf8.RuneCountInString(password) >= MinimumPasswordLength
}

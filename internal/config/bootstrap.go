package config

import (
	"errors"
	"fmt"
	"strings"
)

// Noms des variables du **premier opérateur**. Elles ne sont lues que par `cmd/bootstrap`, jamais
// par le serveur : un tableau de bord qui tourne depuis six mois n'a aucune raison de les porter.
const (
	EnvBootstrapOperatorEmail    = "DASHBOARD_BOOTSTRAP_OPERATOR_EMAIL"
	EnvBootstrapOperatorName     = "DASHBOARD_BOOTSTRAP_OPERATOR_NAME"
	EnvBootstrapOperatorPassword = "DASHBOARD_BOOTSTRAP_OPERATOR_PASSWORD"
)

// minimumOperatorPasswordLength borne le mot de passe du compte propriétaire. Douze caractères, et
// aucune exigence de composition : la longueur est la seule contrainte dont l'effet sur la difficulté
// se démontre, là où « une majuscule et un chiffre » produit surtout `Motdepasse1`.
//
// C'est la **seule** politique de mot de passe du produit à ce jour, et elle ne s'applique qu'ici :
// la spec n'en énonce aucune, et l'écran de gestion des opérateurs (step-029) tranchera pour les
// comptes suivants. Le dire plutôt que de laisser croire que le produit en porte une.
const minimumOperatorPasswordLength = 12

// Bootstrap est la configuration de la **commande** `bootstrap`, pas du serveur.
//
// Elle vit dans ce paquet et non dans `cmd/bootstrap` pour la raison même qui a fait poser
// `forbidigo` : l'environnement se lit à un seul endroit, ou bien la règle n'est plus qu'une phrase
// de documentation. Ce que ça coûte est écrit sur `Variables`.
type Bootstrap struct {
	OperatorEmail string
	OperatorName  string
	// OperatorPassword est un secret : il ne sort ni dans un message d'erreur, ni dans un journal, ni
	// dans le compte rendu de la commande.
	OperatorPassword string
}

// Complete dit si les trois valeurs sont présentes.
//
// **LoadBootstrap n'exige rien**, et c'est ce qui rend la commande rejouable : un déploiement la
// rappelle à chaque livraison, et six mois après l'installation ces variables n'existent plus dans
// son environnement. C'est `cmd/bootstrap` qui exige — et seulement quand la base ne porte aucun
// opérateur, c'est-à-dire au seul moment où elles servent.
func (b Bootstrap) Complete() bool {
	return b.OperatorEmail != "" && b.OperatorName != "" && b.OperatorPassword != ""
}

// MissingNames rend les variables absentes, pour que le refus les nomme sans jamais citer de valeur.
func (b Bootstrap) MissingNames() []string {
	var missing []string

	for _, candidate := range []struct {
		name  string
		value string
	}{
		{EnvBootstrapOperatorEmail, b.OperatorEmail},
		{EnvBootstrapOperatorName, b.OperatorName},
		{EnvBootstrapOperatorPassword, b.OperatorPassword},
	} {
		if candidate.value == "" {
			missing = append(missing, candidate.name)
		}
	}

	return missing
}

// LoadBootstrap lit et valide ce qui est présent. Comme Load, **toute lecture est
// inconditionnelle** : c'est ce qui permet à Variables de la sonder avec un environnement vide.
func LoadBootstrap(lookup Lookup) (Bootstrap, error) {
	r := reader{lookup: lookup}

	cfg := Bootstrap{
		OperatorEmail:    r.operatorEmail(EnvBootstrapOperatorEmail),
		OperatorName:     r.optional(EnvBootstrapOperatorName),
		OperatorPassword: r.operatorPassword(EnvBootstrapOperatorPassword),
	}

	if err := errors.Join(r.problems...); err != nil {
		return Bootstrap{}, fmt.Errorf("configuration du premier opérateur invalide :\n%w", err)
	}

	return cfg, nil
}

// operatorEmail ne valide pas une adresse au sens de la RFC 5322 — aucune bibliothèque ne le fait
// bien, et une adresse interne rejetée par excès de zèle empêcherait l'installation. Il exige la
// forme minimale que le produit suppose ensuite : un `@` entouré de quelque chose.
func (r *reader) operatorEmail(name string) string {
	value := r.optional(name)
	if value == "" {
		return ""
	}

	local, domain, found := strings.Cut(value, "@")
	if !found || local == "" || domain == "" {
		// La valeur n'est pas citée : une adresse d'opérateur est une donnée personnelle, et ce
		// message part dans la sortie d'erreur d'un déploiement.
		r.reject(name, "adresse électronique attendue, de la forme `nom@domaine`")

		return ""
	}

	return value
}

func (r *reader) operatorPassword(name string) string {
	value, found := r.lookup(name)
	// Pas de `TrimSpace` ici, contrairement aux autres lectures : une espace de bord fait partie d'un
	// mot de passe, et la retirer en silence produirait un compte dont le mot de passe n'est pas celui
	// qu'on croit avoir posé.
	if !found || value == "" {
		return ""
	}

	if len([]rune(value)) < minimumOperatorPasswordLength {
		r.reject(name, "mot de passe d'au moins %d caractères attendu ; la valeur n'est pas citée",
			minimumOperatorPasswordLength)

		return ""
	}

	return value
}

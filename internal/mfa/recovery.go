package mfa

import (
	"crypto/rand"
	"fmt"
	"strings"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
)

// RecoveryCodeCount — dix codes. Assez pour couvrir plusieurs pertes d'appareil sans que la liste
// devienne une seconde façon de se connecter qu'on garde dans un tiroir.
const RecoveryCodeCount = 10

// recoveryCodeSymbols — dix caractères, soit cinquante bits. C'est ce que la borne haute d'une saisie
// à la main autorise, et c'est aussi ce qui justifie argon2id plutôt que SHA-256 : cinquante bits se
// parcourent en quelques dizaines d'heures contre du SHA-256, et jamais contre un hachage à vingt-six
// millisecondes le candidat.
const recoveryCodeSymbols = 10

// recoveryCodeGroup coupe l'affichage en deux moitiés — `XXXXX-XXXXX`. Le tiret n'est pas dans
// l'alphabet et la normalisation le jette : un opérateur qui recopie sans lui est accepté.
const recoveryCodeGroup = 5

// crockfordAlphabet est le base32 de Crockford : les trente-deux symboles, sans `I`, `L`, `O` ni `U`.
// Les trois premiers sont ceux qu'on transcrit de travers en `1`, `1` et `0` ; le quatrième est écarté
// par la spécification de Crockford pour éviter les mots qu'on n'a pas voulu écrire.
//
// **Trente-deux divise deux cent cinquante-six**, donc `octet % 32` est uniforme : c'est ce qui
// autorise le tirage ci-dessous à ne pas rejeter d'échantillon. Un alphabet de trente-trois symboles
// y introduirait un biais silencieux.
const crockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// newRecoveryCodes tire les dix codes et leurs hachages, dans le même ordre.
func newRecoveryCodes() (codes, hashes []string, err error) {
	raw := make([]byte, RecoveryCodeCount*recoveryCodeSymbols)
	if _, err = rand.Read(raw); err != nil {
		return nil, nil, fmt.Errorf("tirer les codes de récupération : %w", err)
	}

	codes = make([]string, 0, RecoveryCodeCount)
	hashes = make([]string, 0, RecoveryCodeCount)

	for index := range RecoveryCodeCount {
		symbols := raw[index*recoveryCodeSymbols : (index+1)*recoveryCodeSymbols]

		var code strings.Builder
		for _, value := range symbols {
			code.WriteByte(crockfordAlphabet[int(value)%len(crockfordAlphabet)])
		}

		hash, hashErr := auth.Hash(code.String())
		if hashErr != nil {
			return nil, nil, hashErr
		}

		codes = append(codes, formatRecoveryCode(code.String()))
		hashes = append(hashes, hash)
	}

	return codes, hashes, nil
}

// formatRecoveryCode rend le code tel qu'il s'affiche. La forme est cosmétique : c'est la valeur
// normalisée qui est hachée, donc un opérateur qui recopie avec ou sans le tiret entre également.
func formatRecoveryCode(code string) string {
	return code[:recoveryCodeGroup] + "-" + code[recoveryCodeGroup:]
}

// NormalizeRecoveryCode ramène ce qu'un opérateur a tapé à la forme qui a été hachée : majuscules,
// les trois confusions de Crockford résolues, et tout le reste jeté — tirets, espaces, et ce qui
// n'appartient pas à l'alphabet.
//
// Elle est **la même** à l'écriture et à la lecture : deux normalisations distinctes feraient hacher
// une valeur et en chercher une autre, et le symptôme serait un code de récupération qui ne marche
// jamais.
func NormalizeRecoveryCode(presented string) string {
	var normalized strings.Builder

	for _, symbol := range strings.ToUpper(presented) {
		switch symbol {
		case 'I', 'L':
			normalized.WriteByte('1')
		case 'O':
			normalized.WriteByte('0')
		default:
			if strings.ContainsRune(crockfordAlphabet, symbol) {
				normalized.WriteRune(symbol)
			}
		}
	}

	return normalized.String()
}

// MatchRecoveryCode rend l'index du code qui colle, ou `-1`.
//
// **Il parcourt tous les hachages jusqu'au bout, même après en avoir trouvé un qui colle.** Sortir au
// premier ferait de la durée de la réponse un indicateur du rang du code employé — vingt-six
// millisecondes par hachage, donc jusqu'à deux cent soixante millisecondes d'écart entre le premier
// et le dernier, largement au-dessus du bruit d'une requête. C'est l'inverse de `Verify`, qui sort au
// premier pas : là-bas l'écart porte sur trois HMAC-SHA1 et ne dit rien de plus que l'heure du
// téléphone.
//
// « Tous » et non « les dix » : chaque code consommé est **détruit**, donc la boucle rétrécit. La
// durée trahit alors le nombre de codes restants — ce que `GET /auth/me` rend de toute façon au même
// porteur de session, donc sans rien divulguer de neuf. Ce qui est protégé ici est *lequel* a servi,
// et ça, la boucle le tient quelle que soit sa longueur.
//
// **Aucune porte ne garde cette boucle, et ça a été vérifié plutôt que supposé** (critère 4) : mesuré
// le 12/08/2026, remplacer `matched = index` par un `return index` laisse `internal/mfa`,
// `internal/store`, `internal/bff` et les quarante-et-un scénarios **verts**. Ce qui manquerait pour
// la garder serait un test de durée, que le dépôt écarte partout ailleurs pour la même raison —
// instable en CI. Ce qui garde ces trois lignes est la revue, comme `hmac.Equal` en step-022 et
// `subtle.ConstantTimeCompare` en step-021.
//
// **Un hachage illisible ne matche pas et n'est pas rapporté**, et c'est un manque assumé plutôt
// qu'un oubli : aucun journal n'atteint encore ce paquet, comme dans `auth.passwordMatches`. Une
// ligne abîmée est donc silencieuse, et son symptôme est un code de récupération légitime qui échoue.
// Le premier journal du BFF devra la remonter.
func MatchRecoveryCode(hashes []string, presented string) int {
	normalized := NormalizeRecoveryCode(presented)
	matched := -1

	for index, hash := range hashes {
		ok, err := auth.Verify(hash, normalized)
		if err == nil && ok {
			matched = index
		}
	}

	return matched
}

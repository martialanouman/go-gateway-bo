// Package mfa porte le **second facteur** : l'enrôlement d'un authentificateur TOTP, la
// confrontation d'un code au pas de temps qu'on lui donne, le chiffrement du secret au repos et les
// codes de récupération.
//
// Il est frère d'`internal/session`, qui porte la session : ni l'un ni l'autre ne s'importe, et c'est
// `internal/bff` qui les compose. Il **emprunte** en revanche à `internal/auth`, qui porte le premier
// facteur : le hachage des codes de récupération et l'empreinte du challenge y vivent déjà, et les
// réécrire ici en ferait deux rédactions du même format.
//
// **Il ne lit aucune horloge.** Le pas de temps lui est passé en argument, et il vient de
// PostgreSQL : deux instances aux horloges décalées accepteraient sinon un code que l'autre refuse,
// et compareraient l'anti-rejeu à deux échelles différentes. C'est la raison pour laquelle rien ici
// n'appelle `totp.Validate`, qui lit l'horloge du process — seul `hotp.ValidateCustom`, qui prend le
// compteur en argument, est employé.
package mfa

import (
	"errors"
	"fmt"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/hotp"
	"github.com/pquerna/otp/totp"
)

// PeriodSeconds est la durée d'un pas de temps. Le pas est `epoch / PeriodSeconds`, et c'est
// PostgreSQL qui le calcule — cette constante voyage donc jusqu'à la requête, comme la fenêtre
// glissante des sessions.
const PeriodSeconds = 30

// driftSteps est la tolérance de dérive, de chaque côté du pas courant : une fenêtre d'acceptation de
// 90 secondes en tout.
//
// C'est exactement ce que `totp.Validate` de la bibliothèque emploie — `Skew: 1`, lu dans
// `totp/totp.go:34-49` de la v1.5.0 — et donc ce que les applications compatibles Google
// Authenticator supposent. **Une rédaction précédente affirmait le contraire**, « le défaut de la
// bibliothèque est zéro » : ce zéro-là est la valeur zéro du **champ** `ValidateOpts.Skew`, que la
// documentation décrit, et non ce que la fonction fait. Le chiffre était juste, l'objet mesuré ne
// l'était pas.
//
// Zéro refuserait un téléphone en avance d'une seconde ; deux doubleraient la durée pendant laquelle
// un code intercepté vaut encore, pour couvrir des horloges qu'aucun téléphone moderne n'a.
const driftSteps = 1

// digits et algorithm ne sont pas des arbitrages de sécurité mais d'interopérabilité : beaucoup
// d'applications d'authentification ignorent les paramètres que l'URI porte et supposent six chiffres
// et SHA-1. Ce qui protège est le secret, pas la fonction de hachage — 160 bits tirés d'un CSPRNG.
const (
	digits    = otp.DigitsSix
	algorithm = otp.AlgorithmSHA1
)

// secretBytes — vingt octets, la longueur que la RFC 6238 §5.1 recommande pour HMAC-SHA1. C'est aussi
// le défaut de `totp.Generate`, écrit ici plutôt que subi : `hotp.Generate`, lui, en tire dix.
const secretBytes = 20

// issuer est ce que l'application d'authentification affiche à côté du compte.
//
// Codé en dur et non configurable, ce qui a un prix connu : deux déploiements du même produit — une
// préproduction et une production — apparaissent sous le même nom dans le téléphone d'un opérateur
// qui enrôle les deux. La sortie serait une variable de plus, et elle appartient à la step qui aura
// une préproduction.
const issuer = "Passerelle SMS Admin"

// UnreadableSecretError dit qu'une colonne `mfa_totp_secret` ne se relit pas.
//
// **Ce n'est pas un refus de second facteur**, et les confondre coûterait cher : un secret abîmé se
// lirait alors comme un code mal tapé, et l'opérateur retenterait indéfiniment pendant que personne ne
// regarde la base. Même arbitrage que `auth.MalformedHashError`.
//
// La valeur fautive n'est jamais citée : c'est un secret, et un message d'erreur remonte dans un
// journal.
type UnreadableSecretError struct {
	// Reason nomme ce qui n'allait pas, en termes fixes : aucune valeur lue n'y entre.
	Reason string
}

func (e UnreadableSecretError) Error() string {
	return "secret de second facteur illisible : " + e.Reason
}

// Authenticator porte le second facteur TOTP. Il tient la clé de chiffrement dérivée, et rien
// d'autre : ni pool, ni configuration, ni HTTP.
type Authenticator struct {
	key []byte
}

// NewAuthenticator dérive la clé de chiffrement de la passphrase de configuration.
func NewAuthenticator(passphrase []byte) (*Authenticator, error) {
	key, err := deriveKey(passphrase)
	if err != nil {
		return nil, err
	}

	return &Authenticator{key: key}, nil
}

// Enrollment est ce qu'un enrôlement produit. Ses deux moitiés ne vont pas au même endroit, et c'est
// la seule chose à savoir en le lisant.
type Enrollment struct {
	// Ce qui est montré **une seule fois** et jamais réaffiché ensuite.
	Secret        string
	OtpauthURI    string
	RecoveryCodes []string

	// Ce qui va en base. Aucun de ces deux champs ne traverse un DTO : les réponses se composent
	// champ par champ, donc les y oublier est impossible plutôt qu'improbable.
	SealedSecret       string
	RecoveryCodeHashes []string
}

// Enroll tire un secret, l'URI que l'application scannera et dix codes de récupération.
//
// L'identifiant de l'opérateur sert de **données associées** au chiffrement : voir `seal`.
func (a *Authenticator) Enroll(operatorID, accountName string) (Enrollment, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: accountName,
		Period:      PeriodSeconds,
		SecretSize:  secretBytes,
		Digits:      digits,
		Algorithm:   algorithm,
	})
	if err != nil {
		return Enrollment{}, fmt.Errorf("tirer un secret de second facteur : %w", err)
	}

	sealed, err := a.seal(key.Secret(), operatorID)
	if err != nil {
		return Enrollment{}, err
	}

	codes, hashes, err := newRecoveryCodes()
	if err != nil {
		return Enrollment{}, err
	}

	return Enrollment{
		Secret:             key.Secret(),
		OtpauthURI:         key.URL(),
		RecoveryCodes:      codes,
		SealedSecret:       sealed,
		RecoveryCodeHashes: hashes,
	}, nil
}

// Verify confronte un code au pas de temps courant et à ses voisins, et rend **le pas qui l'a
// validé** — c'est lui, et non le code, que l'anti-rejeu mémorise.
//
// Il sort au premier pas qui colle. La durée trahit alors lequel des trois a répondu, ce qui ne dit
// rien de plus que l'écart d'horloge du téléphone — et l'écart entre trois HMAC-SHA1 est de toute
// façon noyé dans le bruit de la requête. C'est l'inverse du chemin des codes de récupération, où le
// même raccourci trahirait **quel** code a servi, sur un écart de vingt-six millisecondes.
func (a *Authenticator) Verify(sealedSecret, operatorID, code string, step int64) (int64, bool, error) {
	secret, err := a.open(sealedSecret, operatorID)
	if err != nil {
		return 0, false, err
	}

	options := hotp.ValidateOpts{Digits: digits, Algorithm: algorithm}

	for offset := -driftSteps; offset <= driftSteps; offset++ {
		candidate := step + int64(offset)
		if candidate < 0 {
			continue
		}

		ok, validateErr := hotp.ValidateCustom(code, uint64(candidate), secret, options)
		if ok {
			return candidate, true, nil
		}

		// Un code qui n'a pas six chiffres est un refus, pas une panne : la bibliothèque en fait une
		// erreur, et la traiter comme telle ferait rendre 500 à qui tape cinq chiffres.
		if validateErr != nil && !errors.Is(validateErr, otp.ErrValidateInputInvalidLength) {
			return 0, false, UnreadableSecretError{Reason: "le secret déchiffré n'est pas du base32"}
		}
	}

	return 0, false, nil
}

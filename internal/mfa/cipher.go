package mfa

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
)

// sealedPrefix marque le format de ce qui est en base. Il n'a de valeur que le jour où un second
// format existera : sans lui, une rotation d'algorithme ne saurait pas distinguer ce qu'elle doit
// relire de ce qu'elle vient d'écrire, et devrait deviner.
const sealedPrefix = "v1."

// keyLength — AES-256 exige exactement trente-deux octets. C'est pour ça que la passphrase de
// configuration ne peut pas servir telle quelle : elle est bornée en bas, jamais en haut.
const keyLength = 32

// derivationInfo lie la clé dérivée à son usage. Deux usages qui partiraient de la même passphrase
// obtiendraient ainsi deux clés distinctes, et le suffixe laisse la porte à une rotation qui ne
// changerait pas la variable d'environnement.
const derivationInfo = "dashboard-totp-secret-v1"

// deriveKey étire la passphrase vers les trente-deux octets d'AES-256.
//
// **Sans sel**, et c'est un choix plutôt qu'un oubli : HKDF sans sel est défini par la RFC 5869 §2.2,
// qui emploie alors une chaîne de zéros. Le sel sert à décorréler des entrées de faible entropie ;
// celle-ci est bornée à trente-deux caractères et le README la fait tirer d'un CSPRNG. Un sel
// obligerait par ailleurs à le stocker quelque part, donc à ajouter un état que perdre rendrait la
// base illisible — précisément ce que cette clé fait déjà toute seule.
func deriveKey(passphrase []byte) ([]byte, error) {
	key, err := hkdf.Key(sha256.New, passphrase, nil, derivationInfo, keyLength)
	if err != nil {
		return nil, fmt.Errorf("dériver la clé de chiffrement du second facteur : %w", err)
	}

	return key, nil
}

// seal chiffre le secret TOTP pour le repos.
//
// **L'identifiant de l'opérateur est passé en données associées**, et c'est la garde qui compte ici :
// sans elle, un `UPDATE` qui recopie la colonne d'une ligne sur une autre donnerait à un opérateur le
// second facteur d'un autre, et rien ne le refuserait — un chiffré ne sait pas à qui il appartient.
// Avec elle, le déchiffrement échoue.
func (a *Authenticator) seal(secret, operatorID string) (string, error) {
	aead, err := a.aead()
	if err != nil {
		return "", err
	}

	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", fmt.Errorf("tirer le nonce du chiffrement : %w", err)
	}

	// Le nonce est préfixé au chiffré : `Seal` écrit à la suite de son premier argument, ce qui donne
	// `nonce ‖ chiffré ‖ tag` en une allocation. Il n'est pas secret — il doit seulement ne jamais se
	// répéter sous la même clé, ce que douze octets tirés d'un CSPRNG assurent.
	return sealedPrefix + base64.RawURLEncoding.EncodeToString(
		aead.Seal(nonce, nonce, []byte(secret), []byte(operatorID))), nil
}

// open relit ce que seal a écrit.
//
// Chaque échec est une `UnreadableSecretError` et non un refus : une colonne abîmée, un chiffré
// déplacé d'une ligne à l'autre ou une clé qui a changé ne sont pas des codes mal tapés, et les
// confondre enverrait l'opérateur retenter indéfiniment.
func (a *Authenticator) open(sealed, operatorID string) (string, error) {
	encoded, found := strings.CutPrefix(sealed, sealedPrefix)
	if !found {
		return "", UnreadableSecretError{Reason: "le format stocké n'est pas celui que ce binaire écrit"}
	}

	// `Strict()` refuse les bits de remplissage non nuls du dernier caractère : sans lui, plusieurs
	// encodages distincts se relisent vers les mêmes octets, ce qui n'ouvre rien mais rend un test qui
	// altère un caractère de fin vert contre un serveur correct. Le dépôt a déjà payé ce piège en
	// step-022.
	raw, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return "", UnreadableSecretError{Reason: "la valeur stockée n'est pas du base64"}
	}

	aead, err := a.aead()
	if err != nil {
		return "", err
	}

	if len(raw) < aead.NonceSize() {
		return "", UnreadableSecretError{Reason: "la valeur stockée est trop courte pour porter un nonce"}
	}

	secret, err := aead.Open(nil, raw[:aead.NonceSize()], raw[aead.NonceSize():], []byte(operatorID))
	if err != nil {
		return "", UnreadableSecretError{Reason: "le déchiffrement échoue"}
	}

	return string(secret), nil
}

// aead construit le chiffre à chaque appel plutôt qu'une fois à la construction. Ce que ça achète
// n'est pas la sûreté — `cipher.AEAD` est réentrant — mais de n'avoir aucun chemin où l'erreur de
// `aes.NewCipher` serait avalée au démarrage puis découverte à la première authentification.
func (a *Authenticator) aead() (cipher.AEAD, error) {
	block, err := aes.NewCipher(a.key)
	if err != nil {
		return nil, fmt.Errorf("construire le chiffre du second facteur : %w", err)
	}

	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("construire le mode GCM : %w", err)
	}

	return aead, nil
}

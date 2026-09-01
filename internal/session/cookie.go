package session

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
)

// CookieName porte le préfixe `__Host-`, qui fait **appliquer par le navigateur** ce que la fiche
// exige par écrit : `Secure`, `Path=/`, et aucun `Domain`. Un navigateur refuse un cookie ainsi
// nommé qui n'aurait pas les trois. Ce que ça achète : un sous-domaine compromis ne peut plus
// écraser le cookie de session, ce que `Domain` seul n'empêche pas.
//
// Le risque était le développement, où le serveur répond en clair : un cookie `Secure` y serait-il
// refusé ? **Mesuré le 10/08/2026** dans Chromium plutôt que supposé — un serveur d'essai posant ce
// cookie sur `http://localhost` le voit accepté, avec ses cinq attributs, aux côtés d'un témoin sans
// préfixe qui écarte l'hypothèse d'une sonde cassée. Les navigateurs traitent `localhost` comme une
// origine sûre. Rien dans ce dépôt ne garde cette propriété : le harnais godog porte ses cookies à la
// main et accepterait n'importe quel nom.
const CookieName = "__Host-dashboard_session"

// tokenBytes : 256 bits tirés d'un CSPRNG. C'est ce qui dispense d'argon2 côté base — il n'y a aucun
// déficit d'entropie à compenser, contrairement à un mot de passe.
const tokenBytes = 32

// separator ne peut pas apparaître dans l'alphabet base64url, donc le découpage est sans ambiguïté.
const separator = "."

// newSealedToken tire un jeton et rend, dans l'ordre, la valeur à mettre dans le cookie et
// l'empreinte à stocker. Le jeton nu ne sort jamais de cette fonction.
func newSealedToken(secret []byte) (value string, tokenHash []byte, err error) {
	token := make([]byte, tokenBytes)
	if _, err = rand.Read(token); err != nil {
		return "", nil, fmt.Errorf("tirer un jeton de session : %w", err)
	}

	text := base64.RawURLEncoding.EncodeToString(token)
	sum := sha256.Sum256(token)

	return text + separator + base64.RawURLEncoding.EncodeToString(sign(secret, text)), sum[:], nil
}

// Unseal vérifie le sceau et rend l'empreinte à chercher en base.
//
// **L'ordre est la garde**, et il est structurel plutôt que promis : chaque échec est un retour
// anticipé, donc rien de ce qui suit la vérification du sceau ne s'exécute sur un cookie forgé. Ce
// que ça achète n'est pas la confidentialité — le jeton fait déjà 256 bits, il est indevinable — mais
// de ne pas offrir un aller-retour PostgreSQL par requête à qui envoie n'importe quoi.
//
// La signature ne dit rien de plus que « ce cookie vient de ce serveur ». Elle ne dit pas que la
// session vit encore : c'est la lecture en base qui le dit, et elle vient après.
func Unseal(secret []byte, value string) (tokenHash []byte, ok bool) {
	text, signature, found := strings.Cut(value, separator)
	if !found {
		return nil, false
	}

	// `Strict()` refuse les bits de remplissage non nuls du dernier caractère. Sans lui, quatre
	// caractères de fin différents décodent vers les mêmes octets, donc quatre cookies distincts sont
	// acceptés pour un même sceau. Aucune conséquence de sécurité — le jeton est intégralement couvert
	// par le HMAC — mais c'est le piège que cette step a déjà payé une fois : un pas de scénario
	// altérait ce caractère et restait vert contre un serveur correct.
	provided, err := base64.RawURLEncoding.Strict().DecodeString(signature)
	if err != nil {
		return nil, false
	}

	// `hmac.Equal` plutôt qu'une comparaison ordinaire. Ce qui le garde depuis step-031 est
	// `TestLeSceauNeSeCompareQuEnTempsConstant`, qui exige cet appel **et** refuse toute comparaison
	// d'octets dans ce corps — la seconde moitié parce qu'un raccourci naïf posé devant l'appel rendrait
	// le refus en temps variable sans le faire disparaître. Jusqu'à step-031 rien ne le tenait : le
	// remplacer par `string(a) != string(b)` laissait la suite entière verte, mesuré le 10/08/2026.
	if !hmac.Equal(sign(secret, text), provided) {
		return nil, false
	}

	token, err := base64.RawURLEncoding.Strict().DecodeString(text)
	if err != nil {
		return nil, false
	}

	sum := sha256.Sum256(token)

	return sum[:], true
}

func sign(secret []byte, text string) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(text))

	return mac.Sum(nil)
}

// Issued rend le cookie qui ouvre la session.
//
// **Aucune échéance côté navigateur**, et c'est délibéré : la ligne en base est la seule horloge. Un
// `Max-Age` serait une seconde horloge que rien ne synchronise, et son désaccord se lirait comme une
// déconnexion inexpliquée — ou comme un cookie que le navigateur garde alors que la session est
// morte, ce qui est pire.
func Issued(value string) *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		// `Lax` et non `Strict` : le tableau de bord est atteint par des liens depuis les alertes et
		// les tickets, et `Strict` ferait arriver l'opérateur déconnecté sur l'écran qu'on lui a
		// envoyé. `Lax` refuse déjà les requêtes intersites qui écrivent, qui sont ce qu'il faut
		// refuser.
		SameSite: http.SameSiteLaxMode,
	}
}

// Cleared recouvre le cookie précédent. Les attributs doivent coïncider avec ceux d'`Issued`, sinon
// le navigateur pose un second cookie au lieu de remplacer le premier.
//
// Il ne ferme rien à lui seul : il fait cesser l'envoi d'une valeur qui ne vaut plus rien, et nettoie
// un cookie périmé que le serveur ne connaît même plus.
func Cleared() *http.Cookie {
	// G124 ne suit pas l'appel et croit le cookie construit sans attributs. Les redire ici pour
	// satisfaire l'analyseur rétablirait précisément le défaut que ce cookie doit éviter : deux jeux
	// d'attributs qui divergent, donc un navigateur qui ajoute un cookie au lieu de recouvrir.
	cookie := Issued("") //nolint:gosec
	cookie.MaxAge = -1

	return cookie
}

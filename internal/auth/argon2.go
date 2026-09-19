// Package auth porte les mécanismes d'authentification du BFF : le hachage des secrets qu'un
// opérateur présente, et la porte qui limite le nombre de tentatives.
//
// Il ne connaît ni HTTP ni PostgreSQL. Ce qu'il rend est une chaîne et un verdict ; qui la stocke et
// qui la sert sont d'autres paquets.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	// Seize octets : la longueur que recommande la RFC 9106 §3.1 pour un sel de hachage de mot de
	// passe, et celle de l'implémentation de référence.
	saltLength = 16
	// Trente-deux octets en sortie. Plus long ne rend pas la préimage plus dure — le coût est déjà
	// porté par la mémoire et les passes — et plus court réduirait la marge sans rien gagner.
	keyLength = 32
	// La RFC 9106 §3.1 pose huit octets comme minimum. **`x/crypto` ne le vérifie pas** — relu dans
	// `argon2.go` v0.57.0, `initHash` écrit `uint32(len(salt))` puis le sel dans BLAKE2b sans jamais
	// inspecter la longueur, et un sel de quatre octets dérive une clé en silence. Le refus est donc
	// ici, ou nulle part.
	minimumSaltLength = 8
	// La borne haute du hachage relu. Elle n'a aucune vertu cryptographique : elle existe pour que la
	// longueur lue en base tienne dans le `uint32` qu'attend `argon2.IDKey` **par construction**, sans
	// dépendre d'une conversion qu'on affirmerait sûre. Quatre kibioctets sont cent vingt-huit fois ce
	// que ce paquet produit ; au-delà, la ligne est abîmée, pas ancienne.
	maximumKeyLength = 4096
	// Bornes **hautes** des coûts relus. Un gibioctet est seize fois ce que ce paquet produit, et
	// seize passes cinq fois : au-delà, la ligne est abîmée, pas ancienne. Voir `validate` pour ce que
	// leur absence coûterait — une allocation de plusieurs tébioctets, donc un arrêt non récupérable.
	maximumMemory = 1024 * 1024
	maximumTime   = 16
)

// Params porte les trois paramètres d'un hachage argon2id. Ils voyagent **avec** le hachage, dans son
// encodage PHC : c'est ce qui permettra de les relever sans invalider ce qui a été produit avant.
type Params struct {
	// Memory est en **kibioctets**, l'unité qu'attend argon2.IDKey — 64*1024 vaut 64 MiB.
	Memory uint32
	// Time est le nombre de passes sur la mémoire.
	Time uint32
	// Parallelism est le nombre de voies, donc de cœurs qu'un hachage occupe.
	Parallelism uint8
}

// currentParams est le profil « seconde option » de la RFC 9106 §4 à la lettre — m=64 MiB, t=3, p=4.
// Ce qui l'a retenu contre les neuf autres profils mesurés vit avec le benchmark qui les produit,
// au-dessus de `BenchmarkVerification` dans `mesure_test.go`.
//
// Le prix assumé, écrit plutôt que tu : une base volée s'attaque à 26 ms le candidat. C'est
// exactement ce que le relèvement existe pour corriger, et il ne coûte que ces trois nombres — les
// hachages déjà produits portent les leurs et restent vérifiables, ce que garde
// `TestUnHachageProduitAvecDAnciensParametresResteVerifiableApresRelevement`.
var currentParams = Params{
	Memory:      64 * 1024,
	Time:        3,
	Parallelism: 4,
}

// CurrentParams rend les paramètres avec lesquels Hash produit aujourd'hui. Exporté **pour les
// tests** : c'est ce qui leur permet d'affirmer qu'un jeu de paramètres affaibli diffère bien du jeu
// courant, plutôt que de le supposer et de ne rien prouver le jour où les deux coïncideraient.
func CurrentParams() Params { return currentParams }

// MalformedHashError dit qu'une valeur ne se lit pas comme un hachage argon2id encodé en PHC.
//
// **Ce n'est pas un refus d'authentification**, et les confondre coûterait cher : un `password_hash`
// tronqué se lirait alors comme une faute de frappe de l'opérateur, qui retenterait indéfiniment
// pendant que personne ne regarde la base.
//
// La valeur fautive n'est jamais citée. Ce n'est pas un secret — c'est un hachage — mais un message
// d'erreur remonte dans un journal, et rien n'oblige à y verser le contenu d'une colonne
// d'authentification.
type MalformedHashError struct {
	// Reason nomme ce qui n'allait pas, en termes fixes : aucune valeur lue n'y entre.
	Reason string
}

func (e MalformedHashError) Error() string {
	return "hachage illisible en base : " + e.Reason
}

// Hash produit le hachage d'un secret avec les paramètres courants, sous forme PHC.
//
// Il prend une chaîne quelconque et non un type dédié : `internal/mfa` hache les codes de
// récupération « comme un mot de passe », et un type `Password` l'obligerait à mentir sur ce qu'il
// manipule.
func Hash(secret string) (string, error) {
	return HashWith(currentParams, secret)
}

// HashWith hache avec des paramètres explicites. Sa raison d'être est le test du relèvement : il n'y
// a rien à produire en production avec d'autres paramètres que les courants.
func HashWith(params Params, secret string) (string, error) {
	if err := params.validate(); err != nil {
		return "", err
	}

	salt := make([]byte, saltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("tirer le sel du hachage : %w", err)
	}

	key := argon2.IDKey([]byte(secret), salt, params.Time, params.Memory, params.Parallelism, keyLength)

	return encode(params, salt, key), nil
}

// HashSlots borne le nombre de hachages en vol. argon2id alloue 64 MiB **par vérification** : dix
// places réservent 640 MiB, ce que le conteneur encaisse, là où deux cents connexions simultanées
// sans identifiants faisaient tuer l'instance.
const HashSlots = 10

// ErrOverloaded dit qu'aucune place n'était libre dans l'échéance de la requête. Ce n'est pas un
// refus d'identifiants : l'appelant le sert en 503, jamais en 401 ni en 429.
var ErrOverloaded = errors.New("toutes les places de vérification sont occupées")

var hashSlots = make(chan struct{}, HashSlots)

// Hold prend une place et la rend. Les codes de récupération l'appellent **une fois** pour leurs dix
// hachages : une place par hachage ferait d'un seul essai dix places, et la borne protégerait moins
// que le chemin qu'elle protège.
func Hold(ctx context.Context, do func() error) error {
	select {
	case hashSlots <- struct{}{}:
		defer func() { <-hashSlots }()

		return do()
	case <-ctx.Done():
		return ErrOverloaded
	}
}

// Verify dit si le secret présenté est celui qui a produit ce hachage, sous une des dix places de
// `Hold` : c'est elle qui borne combien de vérifications tournent à la fois.
func Verify(ctx context.Context, encoded, secret string) (bool, error) {
	var matched bool

	err := Hold(ctx, func() error {
		var verifyErr error
		matched, verifyErr = VerifyHeld(encoded, secret)

		return verifyErr
	})

	return matched, err
}

// VerifyHeld porte le calcul de Verify, **sans prendre de place** — c'est ce qui permet à
// `MatchRecoveryCode` d'en tenir dix sous une seule place de `Hold`, plutôt qu'une par code.
//
// Les paramètres viennent de **l'encodage**, jamais de `currentParams` : les lire ailleurs ferait
// qu'un relèvement fermerait la porte à tous les opérateurs déjà inscrits, sans qu'aucune migration
// ne puisse rattraper le coup — un hachage ne se recalcule pas sans le mot de passe.
//
// La comparaison passe par `crypto/subtle` : comparer deux hachages avec `==` rend un verdict en un
// temps qui dépend du nombre d'octets de tête qui coïncident, ce qui se remonte octet par octet.
//
// Ce qui la garde est `TestUnHachageNeSeCompareQuEnTempsConstant`, qui exige cet appel **et** refuse
// toute comparaison d'octets dans ce corps — la seconde moitié parce que jeter le résultat de
// l'appel, ou poser un raccourci naïf devant lui, le laisse en place sans qu'il décide. Le reste de
// la suite ne le tient pas : `string(key) == string(expected)` la laisse verte.
func VerifyHeld(encoded, secret string) (bool, error) {
	params, salt, expected, err := decode(encoded)
	if err != nil {
		return false, err
	}

	// La longueur vient de l'encodage et non de `keyLength` : un hachage plus ancien produit sur une
	// autre longueur doit rester vérifiable, exactement comme ses paramètres. La conversion est sûre
	// parce que `decode` a déjà refusé tout ce qui dépasse `maximumKeyLength`.
	key := argon2.IDKey([]byte(secret), salt, params.Time, params.Memory, params.Parallelism,
		uint32(len(expected))) //nolint:gosec // G115 : borné par maximumKeyLength dans decode.

	return subtle.ConstantTimeCompare(key, expected) == 1, nil
}

// dummySalt est le sel du hachage factice. Il est fixe et n'a rien à protéger : ce hachage n'est
// jamais stocké ni comparé — il n'existe que pour **passer le temps** qu'un vrai aurait passé.
var dummySalt = []byte("adresse-inconnue")

// VerifyDummy paie le coût d'une vérification sans en faire une, sous une place de `Hold` comme les
// autres. **Sans cette place, la borne rouvrirait l'oracle qu'elle ferme** : dix vraies vérifications
// en vol feraient attendre une onzième derrière `hashSlots`, alors qu'une adresse inconnue passerait
// devant la file — la durée redeviendrait le signal que ce paquet existe pour taire.
//
// **C'est une garde, pas une politesse.** Sans elle, « adresse inconnue » répond en zéro milliseconde
// là où « mot de passe faux » en coûte des dizaines : le corps et le code ont beau être identiques,
// l'écart de durée dit à l'attaquant lesquelles de ses adresses existent. C'est l'oracle
// d'énumération que le reste de la route existe pour fermer.
//
// Le résultat n'est écrit nulle part — un `var` de paquet en ferait une course sous `-race` dès que
// deux requêtes arrivent ensemble. `runtime.KeepAlive` suffit à interdire au compilateur d'élider
// l'appel, qui est tout ce qu'on lui demande.
//
// **Mesuré à la main le 09/08/2026**, contre le binaire, cinq requêtes de chaque côté, compteurs
// remis à zéro entre chacune (la fiche écarte un test de temps, instable en CI) :
//
//	mot de passe faux   31,4 · 31,4 · 28,8 · 31,5 · 31,2 ms
//	adresse inconnue    30,9 · 30,8 · 31,6 · 34,0 · 31,0 ms
//
// Les deux distributions se recouvrent : l'écart entre les deux chemins est noyé dans le bruit de la
// requête. Sans cet appel, la seconde ligne tomberait sous la milliseconde et l'écart deviendrait le
// signal. Ce que ce constat garde est la **durée**, qu'aucun test n'affirme ; le site d'appel, lui,
// est tenu par `oracle_test.go`, et les coûts par le plancher de `argon2_test.go`.
func VerifyDummy(ctx context.Context, secret string) error {
	return Hold(ctx, func() error {
		runtime.KeepAlive(argon2.IDKey([]byte(secret), dummySalt, currentParams.Time,
			currentParams.Memory, currentParams.Parallelism, keyLength))

		return nil
	})
}

// validate refuse trois coûts nuls et deux coûts démesurés — mais pas tous pour la même raison.
//
// `t == 0` et `p == 0` font **paniquer** `deriveKey` (x/crypto v0.57.0 : « number of rounds too
// small », « parallelism degree too low »), et un panic dans un handler que personne n'a besoin
// d'authentifier pour appeler est le mode d'échec à fermer.
//
// `m == 0`, lui, **ne panique pas** : `deriveKey` l'écrête silencieusement à `2·syncPoints·p`. Le
// refuser est un autre argument, et il tient tout autant — un hachage relu avec `m=0` serait vérifié
// avec des paramètres qui ne sont pas les siens.
//
// Les bornes **hautes** ferment le versant symétrique : `deriveKey` alloue `memory` blocs d'un
// kibioctet (`initBlocks`), donc un `password_hash` portant `m=4294967295` demanderait quatre
// tébioctets en une allocation — un `fatal error: out of memory` **non récupérable**, là où le
// `recover` de `net/http` aurait absorbé un panic. Le remède serait pire que le mal.
func (p Params) validate() error {
	switch {
	case p.Time == 0:
		return MalformedHashError{Reason: "aucune passe déclarée"}
	case p.Parallelism == 0:
		return MalformedHashError{Reason: "aucune voie déclarée"}
	case p.Memory == 0:
		return MalformedHashError{Reason: "aucune mémoire déclarée"}
	case p.Memory > maximumMemory:
		return MalformedHashError{Reason: "mémoire hors de proportion"}
	case p.Time > maximumTime:
		return MalformedHashError{Reason: "nombre de passes hors de proportion"}
	default:
		return nil
	}
}

// format rend les paramètres tels qu'ils s'écrivent dans le champ PHC. Il sert aux deux sens — écrire
// l'encodage et **contrôler** celui qu'on vient de lire — ce qui est la façon la plus courte de
// refuser un champ que `Sscanf` aurait lu à moitié en laissant traîner une queue.
func (p Params) format() string {
	return fmt.Sprintf("m=%d,t=%d,p=%d", p.Memory, p.Time, p.Parallelism)
}

// phcVersion est le champ de version tel qu'il s'écrit, dérivé de la constante de la bibliothèque
// plutôt que du nombre 19 recopié : le jour où x/crypto changerait de version d'algorithme, c'est ici
// que ça se verrait.
var phcVersion = "v=" + strconv.Itoa(argon2.Version)

func encode(params Params, salt, key []byte) string {
	// base64 **sans padding**, comme l'implémentation de référence en C : les `=` de fin ne portent
	// rien et une moitié de l'écosystème les refuse à la relecture.
	return "$argon2id$" + phcVersion + "$" + params.format() +
		"$" + base64.RawStdEncoding.EncodeToString(salt) +
		"$" + base64.RawStdEncoding.EncodeToString(key)
}

func decode(encoded string) (Params, []byte, []byte, error) {
	// Six champs et non cinq : la chaîne commence par `$`, donc le premier champ est vide.
	fields := strings.Split(encoded, "$")
	if len(fields) != 6 || fields[0] != "" {
		return Params{}, nil, nil, MalformedHashError{Reason: "ce n'est pas une chaîne PHC"}
	}

	if fields[1] != "argon2id" {
		return Params{}, nil, nil, MalformedHashError{Reason: "l'algorithme n'est pas argon2id"}
	}

	if fields[2] != phcVersion {
		return Params{}, nil, nil, MalformedHashError{Reason: "la version d'argon2 n'est pas celle que ce binaire calcule"}
	}

	var params Params
	if _, err := fmt.Sscanf(fields[3], "m=%d,t=%d,p=%d", &params.Memory, &params.Time, &params.Parallelism); err != nil {
		return Params{}, nil, nil, MalformedHashError{Reason: "les paramètres ne se lisent pas"}
	}

	// Le tour complet : `Sscanf` s'arrête à la première correspondance et laisserait passer une queue.
	if params.format() != fields[3] {
		return Params{}, nil, nil, MalformedHashError{Reason: "les paramètres portent autre chose que trois nombres"}
	}

	if err := params.validate(); err != nil {
		return Params{}, nil, nil, err
	}

	salt, err := base64.RawStdEncoding.DecodeString(fields[4])
	if err != nil {
		return Params{}, nil, nil, MalformedHashError{Reason: "le sel n'est pas du base64"}
	}

	if len(salt) < minimumSaltLength {
		return Params{}, nil, nil, MalformedHashError{Reason: "le sel est trop court pour argon2"}
	}

	key, err := base64.RawStdEncoding.DecodeString(fields[5])
	if err != nil {
		return Params{}, nil, nil, MalformedHashError{Reason: "le hachage n'est pas du base64"}
	}

	if len(key) == 0 || len(key) > maximumKeyLength {
		return Params{}, nil, nil, MalformedHashError{Reason: "le hachage n'a pas une longueur plausible"}
	}

	return params, salt, key, nil
}

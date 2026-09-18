package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// La politique du premier facteur, en trois nombres et leurs raisons.
const (
	// MaxFailures — cinq, et non trois : un opérateur qui hésite entre deux mots de passe et se trompe
	// de casse en consomme trois sans être un attaquant. Et non dix : chaque tentative coûte 64 MiB de
	// mémoire au serveur, et chaque adresse essayée pose une ligne dans la table des compteurs.
	MaxFailures = 5

	// LockWindow est **à la fois** la durée du verrou et la fenêtre d'oubli, délibérément la même
	// valeur. Plus courte, l'oubli laisserait le compteur au-dessus du seuil au moment où le verrou
	// tombe, et le premier essai suivant reverrouillerait aussitôt : « verrou expiré → un nouvel essai
	// est possible » serait faux. Plus longue, le verrou se rouvrirait pendant que le compteur court.
	LockWindow = 15 * time.Minute

	// ChallengeTTL — le temps de sortir son téléphone, pas celui d'aller déjeuner.
	ChallengeTTL = 5 * time.Minute

	// challengeTokenBytes — 256 bits tirés d'un CSPRNG. C'est ce qui dispense de hacher le jeton avec
	// argon2 : il n'y a aucun déficit d'entropie à compenser, contrairement à un mot de passe.
	challengeTokenBytes = 32
)

// Outcome dit ce qu'une tentative de connexion a produit. Trois valeurs et pas davantage : c'est la
// **totalité** de ce que le serveur consent à distinguer vers l'extérieur.
type Outcome int

const (
	// OutcomeRefused couvre « adresse inconnue », « mot de passe faux » et « compte désactivé ». Les
	// séparer serait l'oracle d'énumération, et c'est pourquoi ils partagent une seule valeur ici
	// plutôt que d'être distingués puis reconvergés plus haut — un point de convergence en aval finit
	// toujours par se dédoubler pour « améliorer le message ».
	OutcomeRefused Outcome = iota
	// OutcomeLocked dit qu'il faut attendre, et combien.
	OutcomeLocked
	// OutcomeChallenged dit que le premier facteur est franchi.
	OutcomeChallenged
)

// Verdict est ce que le handler traduit en réponse HTTP.
type Verdict struct {
	Outcome Outcome
	// OperatorID n'est renseigné que sur OutcomeChallenged, et n'a de sens que là : c'est le seul cas
	// où quelqu'un a été identifié. Il sert à ouvrir la session de premier facteur — que ce paquet
	// n'ouvre pas lui-même, pour ne pas faire dépendre le premier facteur de la session. step-023 n'a
	// pas inversé cette dépendance non plus : `internal/mfa` emprunte à ce paquet-ci, et c'est
	// `internal/bff` qui compose les trois.
	OperatorID string
	// Challenge est le jeton opaque, rendu **une seule fois** : la base n'en garde que l'empreinte.
	Challenge string
	ExpiresAt time.Time
	// RetryAfter n'est renseigné que sur OutcomeLocked.
	RetryAfter time.Duration
}

// Authenticator porte le chemin du premier facteur : l'ordre des gestes, et lui seul. Le schéma est
// dans `internal/store`, le hachage dans ce paquet, la traduction HTTP dans `internal/bff`.
type Authenticator struct {
	logins *store.Logins
	salt   []byte
}

func NewAuthenticator(logins *store.Logins, bruteForceSalt []byte) *Authenticator {
	return &Authenticator{logins: logins, salt: bruteForceSalt}
}

// Login vérifie l'adresse et le mot de passe présentés.
//
// **L'ordre des quatre gestes est la garde elle-même**, et chacun a sa raison d'être là :
//
//  1. réserver l'essai sur l'adresse **avant** de hacher — l'incrément et la décision sont le même
//     geste, sinon une rafale entrée ensemble lirait toutes « pas de verrou » avant qu'aucune n'ait
//     compté, et vérifierait toutes leur mot de passe ;
//  2. chercher l'opérateur, et faire payer le hachage **même s'il n'existe pas** ;
//  3. sur échec, compter la source et refuser — l'adresse est déjà comptée par la réservation du
//     pas 1, et la recompter ici diviserait son plafond par deux ;
//  4. sur succès, effacer le compteur d'adresse et émettre le challenge.
//
// Les compteurs sont clés sur l'adresse **soumise**, existante ou non. Les clé sur l'opérateur trouvé
// ferait qu'une adresse inconnue ne se verrouille jamais — et « celle-ci ne verrouille pas » est
// exactement le signal que le hachage factice vient de fermer par ailleurs.
//
// **La réservation ne porte que sur l'adresse, jamais sur la source.** La source ne fait que compter
// ses échecs, au pas 3 : la réserver aussi verrouillerait tout un bureau derrière une IP partagée dès
// qu'un seul poste y multiplie les essais, alors que réserver l'adresse ne pèse que sur qui tape ce
// compte précis.
func (a *Authenticator) Login(ctx context.Context, email, password, clientAddress string) (Verdict, error) {
	emailKey := normalizeEmail(email)
	sourceKey := SourceKey(a.salt, clientAddress)

	// Le verrou de la source se lit d'abord, et en lecture seule : une source déjà verrouillée ne doit
	// pas consommer le quota de l'adresse qu'elle vise.
	source, err := a.logins.SourceLock(ctx, sourceKey, LockWindow, MaxFailures)
	if err != nil {
		return Verdict{}, err
	}

	if source.Locked() {
		return Verdict{Outcome: OutcomeLocked, RetryAfter: source.Remaining}, nil
	}

	lock, err := a.logins.Reserve(ctx, emailKey, LockWindow, MaxFailures)
	if err != nil {
		return Verdict{}, err
	}

	if lock.Locked() {
		return Verdict{Outcome: OutcomeLocked, RetryAfter: lock.Remaining}, nil
	}

	operator, err := a.logins.OperatorByEmail(ctx, emailKey)
	if err != nil {
		return Verdict{}, err
	}

	if !a.passwordMatches(operator, password) {
		return a.refuse(ctx, sourceKey, lock)
	}

	return a.challenge(ctx, emailKey, operator.ID)
}

// passwordMatches est le **seul** endroit où un mot de passe est confronté à quoi que ce soit.
//
// **L'appel à `VerifyDummy` ci-dessous est gardé par `oracle_test.go`**, qui exige l'appel dans cette
// branche-ci. Sans lui rien ne le tenait : `TestLeHachageFacticeSExecuteSurNImporteQuelSecret` appelle
// la fonction directement, donc garde la fonction et jamais son site d'appel, et sa suppression laisse
// un `if` idiomatique que la revue ne voit pas. La **durée**, elle, reste hors de portée d'un test —
// la mesure est écrite au-dessus de `VerifyDummy`.
//
// Un `password_hash` illisible est traité comme un refus et non comme une panne : la ligne est
// abîmée, mais le dire au navigateur distinguerait ce compte des autres. L'erreur est écartée ici et
// c'est un manque assumé — aucun journal n'atteint encore ce paquet (voir `internal/bff/router.go`),
// donc une ligne corrompue est silencieuse. Le premier journal du BFF devra la remonter.
func (a *Authenticator) passwordMatches(operator *store.Operator, password string) bool {
	if operator == nil {
		VerifyDummy(password)

		return false
	}

	ok, err := Verify(operator.PasswordHash, password)

	return err == nil && ok && operator.Status == store.StatusActive
}

// refuse compte l'échec sur la source, et refuse. `reserved` est le verrou rendu par la réservation
// du pas 1 : c'est elle seule qui annonce le verrou, à hauteur du seuil, pour la fenêtre entière
// puisque la réservation vient de poser `last_failure_at` à `now()`. La charte l'exige : un contrôle
// qui refuse dit ce qu'il refuse et jusqu'à quand.
//
// **Le verrou de la source n'est pas relu ici**, il l'a été à l'entrée. Sous une rafale sur une seule adresse, son compteur
// avance au même rythme que la réservation, mais à un instant différent — après le hachage, pas
// avant — donc dans un ordre qui peut diverger de celui des réservations. Le relire annoncerait
// parfois le verrou depuis une requête différente de la cinquième réservation. Le pré-contrôle d'entrée
// arrête la rafale suivante, pas celle en cours : une source qui vise plusieurs adresses paie donc
// son hachage jusqu'à épuiser son compteur, puis se voit refusée sans hacher.
func (a *Authenticator) refuse(ctx context.Context, sourceKey string, reserved store.Lock) (Verdict,
	error,
) {
	if _, err := a.logins.RecordSourceFailure(ctx, sourceKey, LockWindow, MaxFailures); err != nil {
		return Verdict{}, err
	}

	if reserved.Failures >= MaxFailures {
		return Verdict{Outcome: OutcomeLocked, RetryAfter: LockWindow}, nil
	}

	return Verdict{Outcome: OutcomeRefused}, nil
}

func (a *Authenticator) challenge(ctx context.Context, emailKey, operatorID string) (Verdict, error) {
	if err := a.logins.ClearFailures(ctx, emailKey); err != nil {
		return Verdict{}, err
	}

	token := make([]byte, challengeTokenBytes)
	if _, err := rand.Read(token); err != nil {
		return Verdict{}, fmt.Errorf("tirer le jeton du challenge : %w", err)
	}

	// base64 URL, sans remplissage : ce jeton voyage dans un corps JSON, et les `+`, `/` et `=` s'y
	// encodent mal.
	challenge := base64.RawURLEncoding.EncodeToString(token)

	// L'empreinte est dérivée de la **valeur émise** et non du jeton brut, alors que les deux sont sous
	// la main. Ce détour n'est pas décoratif : il fait passer l'émission par la fonction que la
	// vérification emprunte, donc les deux ne peuvent pas diverger sur l'encodage. Écrit autrement, un
	// changement de `RawURLEncoding` ici aurait laissé la recherche chercher une autre empreinte.
	digest, ok := ChallengeDigest(challenge)
	if !ok {
		return Verdict{}, errChallengeEncoding
	}

	expiresAt, err := a.logins.IssueChallenge(ctx, operatorID, digest, ChallengeTTL)
	if err != nil {
		return Verdict{}, err
	}

	return Verdict{
		Outcome:    OutcomeChallenged,
		OperatorID: operatorID,
		Challenge:  challenge,
		ExpiresAt:  expiresAt,
	}, nil
}

// errChallengeEncoding est inatteignable : la valeur vient d'être produite par le même encodeur que
// `ChallengeDigest` relit. Elle existe parce que le langage n'en sait rien, et elle refuse plutôt
// qu'elle n'émet un challenge dont l'empreinte serait fausse.
var errChallengeEncoding = errors.New("le challenge émis ne se relit pas")

// ChallengeDigest rend l'empreinte que la base porte pour ce challenge, ou `false` si la valeur
// présentée n'a pas la forme d'un challenge émis ici.
//
// **C'est le seul endroit qui connaît l'encodage du challenge**, et les deux moitiés du format y
// passent : `challenge` ci-dessus pour l'émettre, `internal/mfa` pour le vérifier. Les séparer ferait
// qu'un changement d'encodage d'un côté serait relu de l'autre sans que rien ne le dise.
//
// `Strict()` refuse les bits de remplissage non nuls du dernier caractère : sans lui, quatre valeurs
// distinctes décodent vers les mêmes octets, donc quatre challenges différents seraient acceptés pour
// une seule ligne.
func ChallengeDigest(presented string) ([]byte, bool) {
	token, err := base64.RawURLEncoding.Strict().DecodeString(presented)
	if err != nil || len(token) != challengeTokenBytes {
		return nil, false
	}

	digest := sha256.Sum256(token)

	return digest[:], true
}

// normalizeEmail produit la clé unique d'une adresse : espaces de bord retirés, minuscules.
//
// La **même** valeur sert à chercher l'opérateur et à compter les échecs. Deux normalisations
// distinctes feraient qu'une adresse serait comptée sous une clé et cherchée sous une autre, donc que
// le verrou porterait à côté.
//
// Résidu connu et assumé : `strings.ToLower` suit les règles Unicode, `lower()` de PostgreSQL suit la
// locale de la base. Sur des adresses ASCII — toutes celles d'un outil interne — les deux coïncident.
// Sur du non-ASCII exotique elles pourraient diverger, et le symptôme serait un opérateur introuvable,
// jamais un opérateur trouvé à tort.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

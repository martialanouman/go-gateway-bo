package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
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
	// n'ouvre pas lui-même, pour ne pas faire dépendre le premier facteur de la session une step trop
	// tôt (step-023 fera l'inverse, et c'est le bon sens de dépendance).
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
//  1. lire les verrous **avant** de hacher — sinon une attaque verrouillée coûterait quand même ses
//     64 MiB et ses dizaines de millisecondes par tentative, et le verrou ne protégerait que le
//     compte, pas le serveur ;
//  2. chercher l'opérateur, et faire payer le hachage **même s'il n'existe pas** ;
//  3. sur échec, compter les deux dimensions et refuser ;
//  4. sur succès, effacer le compteur d'adresse et émettre le challenge.
//
// Les compteurs sont clés sur l'adresse **soumise**, existante ou non. Les clé sur l'opérateur trouvé
// ferait qu'une adresse inconnue ne se verrouille jamais — et « celle-ci ne verrouille pas » est
// exactement le signal que le hachage factice vient de fermer par ailleurs.
func (a *Authenticator) Login(ctx context.Context, email, password, clientAddress string) (Verdict, error) {
	emailKey := normalizeEmail(email)
	sourceKey := SourceKey(a.salt, clientAddress)

	lock, err := a.logins.LockFor(ctx, emailKey, sourceKey, LockWindow, MaxFailures)
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
		return a.refuse(ctx, emailKey, sourceKey)
	}

	return a.challenge(ctx, emailKey, operator.ID)
}

// passwordMatches est le **seul** endroit où un mot de passe est confronté à quoi que ce soit.
//
// **Rien ne garde l'appel à `VerifyDummy` ci-dessous, et il faut le dire sans l'enjoliver.** Une
// rédaction précédente affirmait que le retirer demanderait d'*ajouter* un retour anticipé, donc que
// la mutation se verrait en revue : c'est faux. `VerifyDummy(password)` est une instruction isolée
// dans une branche qui existe déjà, et sa suppression laisse un `if` parfaitement idiomatique. Le
// test qui la nomme, `TestLeHachageFacticeSExecuteSurNImporteQuelSecret`, l'appelle **directement** :
// il garde la fonction, jamais son site d'appel.
//
// Ce qui reste est la mesure manuelle écrite au-dessus de `VerifyDummy` et la revue. Une porte
// structurelle est possible — `internal/bff/dto_test.go` descend déjà dans les corps de fonction avec
// le type-checker — et elle appartient à la step qui reprendra ce chemin.
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

func (a *Authenticator) refuse(ctx context.Context, emailKey, sourceKey string) (Verdict, error) {
	lock, err := a.logins.RecordFailure(ctx, emailKey, sourceKey, LockWindow, MaxFailures)
	if err != nil {
		return Verdict{}, err
	}

	// L'échec qui **franchit** le seuil annonce le verrou tout de suite, plutôt que de rendre un refus
	// nu et de surprendre à la tentative suivante. La charte l'exige : un contrôle qui refuse dit ce
	// qu'il refuse et jusqu'à quand.
	if lock.Locked() {
		return Verdict{Outcome: OutcomeLocked, RetryAfter: lock.Remaining}, nil
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

	digest := sha256.Sum256(token)

	expiresAt, err := a.logins.IssueChallenge(ctx, operatorID, digest[:], ChallengeTTL)
	if err != nil {
		return Verdict{}, err
	}

	return Verdict{
		Outcome:    OutcomeChallenged,
		OperatorID: operatorID,
		// base64 URL, sans remplissage : ce jeton voyagera dans un corps JSON aujourd'hui et
		// possiblement dans une URL demain (step-023), et les `+`, `/` et `=` s'y encodent mal.
		Challenge: base64.RawURLEncoding.EncodeToString(token),
		ExpiresAt: expiresAt,
	}, nil
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

// Les tests du sceau vivent **dans** le paquet : ce qu'ils éprouvent est `newSealedToken`, qui ne
// sort pas d'ici — le jeton nu ne doit être fabriqué nulle part ailleurs.
package session

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// testSecret n'a rien d'un secret d'installation : ces tests vérifient qu'un sceau colle ou ne colle
// pas, pas qu'une clé est solide.
var testSecret = []byte("une-cle-de-test-assez-longue-pour-la-borne")

func TestUnJetonScelleSeRelitEtRendLEmpreinteQuiSeraStockee(t *testing.T) {
	t.Parallel()

	value, stored, err := newSealedToken(testSecret)
	require.NoError(t, err)

	read, ok := Unseal(testSecret, value)
	require.True(t, ok)
	assert.Equal(t, stored, read,
		"l'empreinte relue diffère de celle qu'on a stockée : aucune session ne se retrouverait")

	token, err := base64.RawURLEncoding.DecodeString(strings.Split(value, separator)[0])
	require.NoError(t, err)
	assert.Len(t, token, tokenBytes)

	expected := sha256.Sum256(token)
	assert.Equal(t, expected[:], stored, "la base doit voir l'empreinte du jeton, jamais le jeton")
	assert.NotContains(t, value, base64.RawURLEncoding.EncodeToString(stored),
		"le cookie porte l'empreinte : qui vole la base rejoue les sessions")
}

// Sans cette vérification, n'importe qui compose un cookie sur l'empreinte de son choix.
func TestUneSignatureAltereeEstRefusee(t *testing.T) {
	t.Parallel()

	value, _, err := newSealedToken(testSecret)
	require.NoError(t, err)

	_, ok := Unseal(testSecret, alter(value))
	assert.False(t, ok)
}

func TestUnCookieSansSeparateurEstRefuse(t *testing.T) {
	t.Parallel()

	value, _, err := newSealedToken(testSecret)
	require.NoError(t, err)

	_, ok := Unseal(testSecret, strings.ReplaceAll(value, separator, ""))
	assert.False(t, ok)
}

// La clé fait toute la différence entre « ce cookie vient de ce serveur » et « ce cookie vient de
// quelque part ». C'est aussi ce qui arrive quand deux instances ne portent pas la même.
func TestUnCookieScelleAvecUneAutreCleEstRefuse(t *testing.T) {
	t.Parallel()

	value, _, err := newSealedToken([]byte("une-autre-cle-tout-aussi-longue-que-la-borne"))
	require.NoError(t, err)

	_, ok := Unseal(testSecret, value)
	assert.False(t, ok)
}

// Le dernier caractère d'un base64 de 32 octets ne porte que deux bits significatifs sur six. Sans
// décodage strict, quatre valeurs de cookie distinctes sont acceptées pour un même sceau — et c'est
// exactement ce qui a fait passer un pas de scénario contre un serveur correct pendant cette step.
func TestUnSceauNonCanoniqueEstRefuse(t *testing.T) {
	t.Parallel()

	value, _, err := newSealedToken(testSecret)
	require.NoError(t, err)

	text, seal, _ := strings.Cut(value, separator)

	variants := 0

	for _, replacement := range []byte("ABCDEFGHIJKLMNOP") {
		candidate := text + separator + seal[:len(seal)-1] + string(replacement)
		if candidate == value {
			continue
		}

		if _, ok := Unseal(testSecret, candidate); ok {
			variants++
		}
	}

	assert.Zero(t, variants,
		"%d encodage(s) non canonique(s) du même sceau sont acceptés : le cookie n'a pas une seule "+
			"forme valide", variants)
}

func TestDeuxSessionsNePartagentPasLeurJeton(t *testing.T) {
	t.Parallel()

	first, firstHash, err := newSealedToken(testSecret)
	require.NoError(t, err)

	second, secondHash, err := newSealedToken(testSecret)
	require.NoError(t, err)

	assert.NotEqual(t, first, second)
	assert.NotEqual(t, firstHash, secondHash)
}

// **Ce que ce test garde est un ordre**, que rien d'autre n'observe : un cookie forgé doit être
// refusé avant que la base soit interrogée, sans quoi n'importe qui s'offre un aller-retour
// PostgreSQL par requête.
//
// Le pool est fermé, donc toute requête échoue bruyamment : « refusé au sceau » rend `false, nil`,
// « arrivé jusqu'à la base » rend une erreur. Le second cas est le **témoin** — sans lui, un
// `Resolve` qui ne ferait jamais rien passerait ce test.
func TestUnCookieMalScelleNAtteintPasLaBase(t *testing.T) {
	t.Parallel()

	authentic, _, err := newSealedToken(testSecret)
	require.NoError(t, err)

	manager := NewManager(store.NewSessions(closedPool(t)), testSecret)

	_, alive, err := manager.Resolve(context.Background(), alter(authentic))
	require.NoError(t, err, "un sceau qui ne colle pas a quand même interrogé la base")
	assert.False(t, alive)

	_, _, err = manager.Resolve(context.Background(), authentic)
	require.Error(t, err, "témoin : un cookie authentique doit, lui, atteindre la base")
}

// Même ordre pour l'élévation, qui part elle aussi d'un cookie. La fermeture, elle, ne prend plus de
// cookie du tout — elle ferme la session **déjà résolue**, par sa clé primaire.
func TestLElevationNAtteintPasLaBaseSurUnCookieForge(t *testing.T) {
	t.Parallel()

	authentic, _, err := newSealedToken(testSecret)
	require.NoError(t, err)

	manager := NewManager(store.NewSessions(closedPool(t)), testSecret)
	forged := alter(authentic)

	_, elevated, err := manager.Elevate(context.Background(), forged)
	require.NoError(t, err)
	assert.False(t, elevated)

	_, _, err = manager.Elevate(context.Background(), authentic)
	require.Error(t, err, "témoin : un cookie authentique doit, lui, atteindre la base")
}

// Les cinq attributs sont ce qui remplace, ici, ce que le contrat ne peut pas déclarer : `HttpOnly`
// tient le cookie hors de portée d'un script, `Secure` hors d'un transport en clair, `SameSite` hors
// d'une requête intersite qui écrit, `Path` et l'absence de `Domain` sont ce que le préfixe
// `__Host-` exige du navigateur.
func TestLeCookieDeSessionPorteSesCinqAttributs(t *testing.T) {
	t.Parallel()

	cookie := Issued("une-valeur")

	assert.Equal(t, CookieName, cookie.Name)
	assert.True(t, strings.HasPrefix(cookie.Name, "__Host-"))
	assert.True(t, cookie.HttpOnly)
	assert.True(t, cookie.Secure)
	assert.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
	assert.Equal(t, "/", cookie.Path)
	assert.Empty(t, cookie.Domain, "un `Domain` ouvrirait le cookie aux sous-domaines")
	assert.Zero(t, cookie.MaxAge, "une échéance côté navigateur serait une seconde horloge")
}

// Les attributs doivent coïncider avec ceux d'`Issued`, sinon le navigateur pose un second cookie au
// lieu de remplacer le premier — et continue d'envoyer l'ancien.
func TestLeCookieDeDeconnexionRecouvreCeluiDeLaSession(t *testing.T) {
	t.Parallel()

	issued, cleared := Issued("une-valeur"), Cleared()

	assert.Equal(t, issued.Name, cleared.Name)
	assert.Equal(t, issued.Path, cleared.Path)
	assert.Equal(t, issued.Domain, cleared.Domain)
	assert.Equal(t, issued.SameSite, cleared.SameSite)
	assert.Equal(t, issued.Secure, cleared.Secure)
	assert.Equal(t, issued.HttpOnly, cleared.HttpOnly)
	assert.Empty(t, cleared.Value)
	assert.Negative(t, cleared.MaxAge, "un `MaxAge` positif ou nul ne supprime pas le cookie")
}

// alter retourne un bit de la **signature** en laissant le jeton intact. Un cookie entièrement bidon
// serait refusé même sans vérification du sceau, faute d'empreinte connue en base : il ne prouverait
// rien.
func alter(value string) string {
	text, signature, _ := strings.Cut(value, separator)
	provided, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		panic(err)
	}

	provided[0] ^= 0x01

	return text + separator + base64.RawURLEncoding.EncodeToString(provided)
}

// closedPool rend un pool qu'aucune requête ne peut servir. Aucun conteneur, aucun réseau : le pool
// est paresseux, et il est fermé avant tout usage.
func closedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	pool, err := store.NewPool(context.Background(), "postgres://operateur:secret@127.0.0.1:1/tableau")
	require.NoError(t, err)

	pool.Close()

	return pool
}

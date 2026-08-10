package bff

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ces tests montent le routeur entier sur une base morte, et c'est elle qui les rend lisibles : ce
// qui franchit les bornes tombe dessus, donc **400** veut dire « refusée à la porte » et **500**
// « arrivée jusqu'à la base ». Une borne retirée bascule de l'un à l'autre.
//
// Aucun conteneur, aucun réseau : le pool est paresseux (DN-5) et fermé avant tout usage.
func loginRouter(t *testing.T) http.Handler {
	t.Helper()

	pool, err := store.NewPool(context.Background(), "postgres://operateur:secret@127.0.0.1:1/tableau")
	require.NoError(t, err, "construire le pool du test")

	pool.Close()

	return NewRouter(Dependencies{
		Assets:        fstest.MapFS{},
		Authenticator: auth.NewAuthenticator(store.NewLogins(pool), []byte("un sel de test assez long")),
	})
}

// postLogin rend le statut et le corps servis. Le corps est passé en clair pour que sa taille en
// octets soit celle que la borne du corps mesure.
func postLogin(t *testing.T, body string) (int, string) {
	t.Helper()

	rec := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")

	loginRouter(t).ServeHTTP(rec, request)

	response := rec.Result()

	defer func() { _ = response.Body.Close() }()

	served, err := io.ReadAll(response.Body)
	require.NoError(t, err, "lire la réponse servie")

	return response.StatusCode, string(served)
}

func credentials(t *testing.T, email, password string) string {
	t.Helper()

	body, err := json.Marshal(map[string]string{"email": email, "password": password})
	require.NoError(t, err, "composer le corps de la requête")

	return string(body)
}

// La borne du mot de passe ne protège pas le temps d'argon2 — il tient à la mémoire et aux passes —
// mais ce que le serveur copie et garde en vol pour une requête que personne n'a authentifiée.
func TestUnMotDePasseDemesureNAtteintPasLeHachage(t *testing.T) {
	t.Parallel()

	status, _ := postLogin(t,
		credentials(t, "camille@exemple.test", strings.Repeat("a", maximumPasswordLength+1)))

	assert.Equal(t, http.StatusBadRequest, status,
		"le mot de passe démesuré a traversé jusqu'à la base : la borne ne mord plus")
}

// L'adresse soumise devient la clé `subject` de `login_attempt_counters`, la seule table qu'une
// requête non authentifiée fait écrire.
func TestUneAdresseDemesureeNeDevientPasUneCleDeCompteur(t *testing.T) {
	t.Parallel()

	status, _ := postLogin(t,
		credentials(t, strings.Repeat("a", maximumEmailLength+1)+"@exemple.test", "un mot de passe"))

	assert.Equal(t, http.StatusBadRequest, status,
		"l'adresse démesurée a traversé jusqu'à la base : elle y serait devenue une clé de compteur")
}

// Le compte est en **runes**, comme la `maxLength` du contrat : en octets, une adresse d'accents que
// le contrat autorise serait refusée.
func TestUneAdresseDAccentsSousLaBorneNEstPasRefusee(t *testing.T) {
	t.Parallel()

	// Deux octets par rune : le double de la borne en octets, la borne exacte en runes.
	accented := strings.Repeat("é", maximumEmailLength)
	require.Len(t, []rune(accented), maximumEmailLength)
	require.Greater(t, len(accented), maximumEmailLength, "ces runes tiennent sur un octet")

	status, _ := postLogin(t, credentials(t, accented, "un mot de passe"))

	assert.Equal(t, http.StatusInternalServerError, status,
		"une adresse que le contrat autorise a été refusée : la borne compte des octets là où le "+
			"contrat compte des caractères")
}

// La borne du **corps**, celle qui s'applique avant le décodage : les bornes de champ ne valent
// qu'une fois le corps entier en mémoire.
func TestUnCorpsPlusGrandQueLaBorneNEstPasDecode(t *testing.T) {
	t.Parallel()

	// **Chaque champ reste sous sa propre borne**, sans quoi le 400 viendrait d'elle : des runes de deux
	// octets font tenir 4 096 caractères — la borne exacte du mot de passe — dans 8 192 octets, que
	// l'adresse et la syntaxe JSON portent au-delà de la borne du corps.
	oversized := credentials(t, "camille@exemple.test", strings.Repeat("é", maximumPasswordLength))
	require.Greater(t, len(oversized), maximumLoginBodyBytes,
		"ce corps tient sous la borne : la mutation qui retire RequestSize resterait verte")

	status, _ := postLogin(t, oversized)

	assert.Equal(t, http.StatusBadRequest, status,
		"un corps de %d octets a été décodé : la borne du corps ne s'applique plus, et les bornes de "+
			"champ arrivent trop tard pour l'empêcher", len(oversized))
}

// La plus grave des lignes que ces tests gardent : une base injoignable lue comme un refus
// d'identifiants ferait retaper son mot de passe à un opérateur dont le mot de passe est bon.
//
// Le corps est vérifié autant que le statut — `internal/bff` n'a pas de journal, donc ce que le
// navigateur reçoit est tout ce qui existe.
func TestUneBaseInjoignableNeSeLitPasCommeUnRefusDIdentifiants(t *testing.T) {
	t.Parallel()

	status, served := postLogin(t, credentials(t, "camille@exemple.test", "un mot de passe"))

	require.Equal(t, http.StatusInternalServerError, status,
		"une base injoignable a été servie comme un refus : l'opérateur retape un mot de passe qui est bon")

	var served500 Error

	require.NoError(t, json.Unmarshal([]byte(served), &served500), "la réponse n'est pas le DTO d'erreur")
	assert.Equal(t, "internal_error", served500.Code)
	assert.NotContains(t, served, "closed pool", "le message de la bibliothèque part au navigateur")
	assert.NotContains(t, served, "127.0.0.1", "le corps porte l'adresse de la base")
}

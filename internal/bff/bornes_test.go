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

// Ces tests montent le routeur **entier** sur une base morte, et c'est cette base morte qui les rend
// lisibles : une requête qui franchit les bornes tombe forcément dessus, donc
//
//	400 — refusée à la porte, la borne a mordu ;
//	500 — acceptée, arrivée jusqu'à la base.
//
// Retirer une borne fait basculer son test de 400 à 500, ce qui **reproduit le défaut réel** : la
// valeur démesurée est bien allée jusqu'au hachage ou jusqu'à la clé de compteur. Un test qui
// affirmerait seulement « 400 » resterait vert sur une garde déplacée ou sur une panne fortuite.
//
// Aucun conteneur, aucun réseau : le pool est paresseux — `NewPool` ne compose rien (DN-5) — et une
// fois fermé, chaque requête échoue sur place. Le DSN désigne un port où personne n'écoute, ce qui
// n'est jamais mis à l'épreuve.
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

// postLogin sert la requête et rend le statut et le corps servis. Le corps est passé **en clair**
// plutôt que composé : c'est ce qui permet d'en envoyer un que `json.Marshal` refuserait, et de
// mesurer sa taille en octets là où la borne du corps se compte en octets.
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

// Ce que la borne du mot de passe protège n'est pas le temps d'argon2 — il tient à la mémoire et aux
// passes, pas à la longueur du secret — mais ce que le serveur accepte de copier et de garder en vol
// pour une requête que personne n'a authentifiée.
func TestUnMotDePasseDemesureNAtteintPasLeHachage(t *testing.T) {
	t.Parallel()

	status, _ := postLogin(t,
		credentials(t, "camille@exemple.test", strings.Repeat("a", maximumPasswordLength+1)))

	assert.Equal(t, http.StatusBadRequest, status,
		"le mot de passe démesuré a traversé jusqu'à la base : la borne ne mord plus")
}

// L'adresse soumise devient la clé `subject` de `login_attempt_counters` — la **seule** table du
// schéma qu'une requête non authentifiée fait écrire. Sans borne, chaque tentative y pose ce que
// l'appelant a bien voulu envoyer.
func TestUneAdresseDemesureeNeDevientPasUneCleDeCompteur(t *testing.T) {
	t.Parallel()

	status, _ := postLogin(t,
		credentials(t, strings.Repeat("a", maximumEmailLength+1)+"@exemple.test", "un mot de passe"))

	assert.Equal(t, http.StatusBadRequest, status,
		"l'adresse démesurée a traversé jusqu'à la base : elle y serait devenue une clé de compteur")
}

// Le compte est en **runes** et non en octets, comme la `maxLength` du contrat. En octets, une
// adresse d'accents que le contrat autorise serait refusée — et l'opérateur lirait « cette requête a
// été refusée » sans jamais savoir pourquoi la même adresse marche chez son voisin.
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

// La borne du **corps**, celle qui s'applique avant le décodage. Les bornes de champ ne valent qu'une
// fois la valeur lue, donc une fois le corps entier en mémoire : sans celle-ci, il n'y a pas de
// plafond à ce qu'une requête non authentifiée fait allouer.
func TestUnCorpsPlusGrandQueLaBorneNEstPasDecode(t *testing.T) {
	t.Parallel()

	// **Chaque champ reste sous sa propre borne**, et c'est toute la difficulté de ce test : des runes
	// de deux octets font tenir 4 096 caractères — la borne exacte du mot de passe — dans 8 192 octets,
	// que l'adresse et la syntaxe JSON portent au-delà de la borne du corps. Ce qui doit refuser cette
	// requête est donc la taille du corps, et rien d'autre.
	//
	// Une première rédaction répétait `maximumLoginBodyBytes` runes : le mot de passe franchissait sa
	// propre borne, le test était vert et le restait `RequestSize` retiré. C'est la mutation qui l'a
	// dit.
	oversized := credentials(t, "camille@exemple.test", strings.Repeat("é", maximumPasswordLength))
	require.Greater(t, len(oversized), maximumLoginBodyBytes,
		"ce corps tient sous la borne : la mutation qui retire RequestSize resterait verte")

	status, _ := postLogin(t, oversized)

	assert.Equal(t, http.StatusBadRequest, status,
		"un corps de %d octets a été décodé : la borne du corps ne s'applique plus, et les bornes de "+
			"champ arrivent trop tard pour l'empêcher", len(oversized))
}

// La plus grave des lignes que ces tests gardent. Une base injoignable doit se voir comme une panne
// **du serveur** : la lire comme un refus d'identifiants ferait retaper son mot de passe à un
// opérateur dont le mot de passe est bon, pendant que la vraie cause reste invisible.
//
// Le corps est vérifié autant que le statut. `internal/bff` n'a toujours pas de journal — un 500 servi
// ici ne laisse aucune trace côté serveur — donc ce que le navigateur reçoit est tout ce qui existe,
// et il ne doit porter ni le message Go ni le DSN qu'il transporte.
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

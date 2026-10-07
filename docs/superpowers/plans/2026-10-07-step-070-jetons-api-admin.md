# step-070 — Le BFF émet les jetons de l'API Admin : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** le BFF signe en ES256, au nom de l'opérateur connecté, les jetons qui authentifient ses
appels à l'API Admin, publie son JWKS, et ne fait plus aucun `client_credentials`.

**Architecture :** un paquet `internal/token` (clés, JWKS, émetteur avec cache) ; une traduction pure
permissions → scopes dans `internal/permissions` ; un `RoundTripper` de `internal/gateway` qui lit
l'appelant dans le contexte (posé par la garde du BFF ou par le hub) et refuse tout appel sans
appelant. Les refus 401/403 de la passerelle sont traduits en un seul point, le gestionnaire
d'erreurs du routeur.

**Tech Stack :** Go 1.26.6, `github.com/go-jose/go-jose/v4 v4.1.5` (signature, empreinte),
`github.com/coreos/go-oidc/v3 v3.18.0` (vérification dans les faux amonts, comme la passerelle),
godog, testify.

**Spec :** `tasks/steps/step-070.md` (fiche validée le 07/10/2026). ADR : `../go-gateway/docs/adr/0019-le-bff-emet-les-jetons-de-l-api-admin.md`.

## Global Constraints

- Versions relevées le 07/10/2026 sur `proxy.golang.org`, sans avis OSV : `go-jose/v4 v4.1.5`,
  `go-oidc/v3 v3.18.0` (celle de `go-gateway`). Aucune autre dépendance.
- Contrat : **7.3.0**, pas de bump (7.6.0 publiée, aucun écart sur l'authentification).
- Claims : `iss` = `DASHBOARD_TOKEN_ISSUER` **tel quel** ; `aud` = `"gateway-admin"` (chaîne) ;
  `sub` = UUID, jamais vide ; `scope` = **une chaîne** séparée par des espaces ; `exp - iat` = 300 s ;
  `kid` en en-tête ; algorithme ES256 (P-256).
- Cache : réutilisé tant que `exp - now > 60 s`.
- Aucune clé privée, aucun PEM, aucun jeton dans un log, une erreur ou une réponse.
- Le code est en anglais, la copie produit en français, troisième personne, conséquence d'abord.
- Noms de tests `TestXxx` en anglais, Gherkin en français, noms de fichiers en anglais.
- Commentaires : seulement le pourquoi, trois lignes au plus.
- Toute mesure de mutation : après commit, `go test -count=1`, dans un worktree jetable, nommer le
  test qui tombe.
- `make check` vert avant la PR ; `DOCKER_HOST` posé pour testcontainers (OrbStack).

## Écarts à la fiche, découverts en préparant le plan (Task 1 les reporte dans la fiche)

1. **Identité système sans ligne en base.** `internal/store/first_operator.go:94` n'amorce le premier
   administrateur que `WHERE NOT EXISTS (SELECT 1 FROM operators)` : une ligne réservée casserait
   l'amorçage, et toucherait login, liens d'accès et liste des opérateurs. La passerelle n'exige
   qu'un `sub` UUID : l'identité système est une **constante** `gateway.SystemSubject`.
2. **Pas de compteur Prometheus** : le BFF n'a aucun registre de métriques. Le 401 est un log
   ERROR à l'événement stable `gateway_token_rejected`, sur lequel l'alerting par log s'accroche.
3. **Le mode `mock` envoie aussi le jeton signé** (clé éphémère) : Prism accepte tout `Bearer`.
   `mockAccessToken` disparaît, et les scénarios exercent le vrai jeton.
4. **« Un appel sans appelant n'atteint jamais la passerelle »** se prouve au niveau du transport
   (test unitaire) : aucune route HTTP ne permet de le provoquer, toutes passent par la garde.

## Carte des fichiers

| Fichier | Responsabilité |
|---|---|
| `internal/token/keys.go` (neuf) | Charger les PEM P-256, calculer le `kid`, désigner la clé active ; clé éphémère pour le mock |
| `internal/token/jwks.go` (neuf) | DTO JWKS public et son handler HTTP |
| `internal/token/issuer.go` (neuf) | Signer un jeton, cache par `(sub, scopes)` |
| `internal/permissions/scopes.go` (neuf) | Classe de chaque clé, `GatewayScopes` |
| `internal/gateway/caller.go` (neuf) | `WithOperator`, `WithSystem`, `SystemSubject` |
| `internal/gateway/client.go` | Transport par appelant ; `client_credentials` et jeton factice retirés |
| `internal/gateway/token.go`, `token_test.go` | **Supprimés** |
| `internal/config/config.go` | Trois variables `DASHBOARD_TOKEN_*` ; trois `DASHBOARD_GATEWAY_*` retirées |
| `internal/bff/guard.go` | Pose `gateway.WithOperator` avant le handler |
| `internal/bff/router.go` | Monte le JWKS ; traduit 401/403 amont dans `reportFailedResponse` |
| `internal/bff/relay.go` | `ErrNoCaller` → 500 ; commentaire mis à jour |
| `internal/fakegateway/fakegateway.go` | Option de vérification réelle des jetons |
| `cmd/dashboard/main.go` | Construit l'émetteur ; `WithSystem` dans `dialStream` ; log de démarrage |
| `cmd/dashboard/gateway-token.feature` + `gateway_token_test.go` (neufs) | Scénarios |
| `docs/runbook.md` (neuf) | Rotation ; valeurs `gateway-oidc` |
| `.env.example`, `cmd/dashboard/configuration.feature` | Variables à jour |
| `debts/017-…md` | Supprimé |

---

### Task 1 : reporter les écarts dans la fiche

**Files :**
- Modify : `tasks/steps/step-070.md`

- [ ] **Step 1 : corriger la fiche**

Dans « Décisions », remplacer la puce « Identité système » par :

```markdown
- **Identité système** pour les trois flux du hub : une **constante** `gateway.SystemSubject`
  (UUID fixe), sans ligne en base — `first_operator.go:94` n'amorce le premier administrateur que
  sur une table `operators` vide, et une ligne réservée l'aurait bloqué. `scope: "admin:read"` seul.
  L'ADR-0019 (« pas de compte de service ») visait les scripts ; l'amender d'une ligne côté
  passerelle fait partie de la PR.
```

Dans la puce « Réponses de la passerelle », remplacer « compteur `gateway_token_rejected_total` »
par « événement de log stable `gateway_token_rejected` (le BFF n'a aucun registre de métriques) »,
et dans la puce « Transport », remplacer « Le mode `mock` garde son jeton factice ; » par « Le mode
`mock` envoie aussi le jeton signé, Prism acceptant tout `Bearer` ; `mockAccessToken` disparaît ; ».
Dans « Fichiers », retirer `internal/store/migrations/ : l'identité système.` Dans « Tests »,
remplacer « scénario « un appel sans appelant n'atteint jamais la passerelle » » par « test du
transport `TestACallWithoutACallerNeverLeaves` ».

- [ ] **Step 2 : commit**

```bash
git add tasks/steps/step-070.md
git commit -m "docs(m3): step-070, identité système sans ligne, log au lieu d'un compteur"
```

---

### Task 2 : clés de signature et JWKS

**Files :**
- Create : `internal/token/keys.go`, `internal/token/jwks.go`
- Test : `internal/token/keys_test.go`, `internal/token/jwks_test.go`
- Modify : `go.mod`, `go.sum`

**Interfaces :**
- Produces :
  - `type KeySet struct` (champs non exportés)
  - `func LoadKeySet(dir, activeID string) (KeySet, error)`
  - `func EphemeralKeySet() (KeySet, error)`
  - `func (s KeySet) ActiveID() string`, `func (s KeySet) IDs() []string` (triés)
  - `type JWK struct { Kty, Crv, X, Y, Kid, Alg, Use string }` (tags `kty`,`crv`,`x`,`y`,`kid`,`alg`,`use`)
  - `type JWKS struct { Keys []JWK \`json:"keys"\` }`
  - `func (s KeySet) JWKS() JWKS`, `func (s KeySet) JWKSHandler() http.Handler`

- [ ] **Step 1 : ajouter la dépendance**

```bash
go get github.com/go-jose/go-jose/v4@v4.1.5
```

- [ ] **Step 2 : écrire les tests rouges**

`internal/token/keys_test.go` :

```go
package token

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeKey(t *testing.T, dir, name string, curve elliptic.Curve) {
	t.Helper()
	key, err := ecdsa.GenerateKey(curve, rand.Reader)
	require.NoError(t, err)
	der, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, name),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600))
}

func TestEveryKeyOfTheDirectoryIsPublishedAndTheActiveOneIsChosen(t *testing.T) {
	dir := t.TempDir()
	writeKey(t, dir, "a.pem", elliptic.P256())
	writeKey(t, dir, "b.pem", elliptic.P256())

	probe, err := LoadKeySet(dir, "")
	require.Error(t, err, "sans kid actif, le chargement refuse")
	assert.Empty(t, probe.IDs())

	ids := idsOf(t, dir)
	set, err := LoadKeySet(dir, ids[1])
	require.NoError(t, err)
	assert.Equal(t, ids, set.IDs())
	assert.Equal(t, ids[1], set.ActiveID())
}

func TestTheKeyIDIsTheRFC7638ThumbprintAndStable(t *testing.T) {
	dir := t.TempDir()
	writeKey(t, dir, "a.pem", elliptic.P256())
	first := idsOf(t, dir)
	second := idsOf(t, dir)
	assert.Equal(t, first, second)
	assert.Len(t, first[0], 43, "SHA-256 en base64url sans remplissage")
}

func TestAKeyOutsideP256IsRefusedAndTheRefusalNamesTheFileOnly(t *testing.T) {
	dir := t.TempDir()
	writeKey(t, dir, "p384.pem", elliptic.P384())
	_, err := LoadKeySet(dir, "x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "p384.pem")
	assert.NotContains(t, err.Error(), "PRIVATE KEY")
}

func TestAnUnreadableFileIsRefusedWithoutQuotingIt(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "broken.pem"), []byte("secret-material"), 0o600))
	_, err := LoadKeySet(dir, "x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "broken.pem")
	assert.NotContains(t, err.Error(), "secret-material")
}

func TestAnEmptyDirectoryAndAnUnknownActiveIDAreRefused(t *testing.T) {
	_, err := LoadKeySet(t.TempDir(), "x")
	require.Error(t, err)

	dir := t.TempDir()
	writeKey(t, dir, "a.pem", elliptic.P256())
	_, err = LoadKeySet(dir, "unknown")
	require.Error(t, err)
	assert.Contains(t, err.Error(), idsOf(t, dir)[0], "le refus liste les kid disponibles, publics")
}

func idsOf(t *testing.T, dir string) []string {
	t.Helper()
	keys, err := readKeys(dir)
	require.NoError(t, err)
	ids := make([]string, 0, len(keys))
	for _, k := range keys {
		ids = append(ids, k.id)
	}
	return ids
}
```

`internal/token/jwks_test.go` :

```go
package token

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTheJWKSPublishesOnlyPublicFields(t *testing.T) {
	set, err := EphemeralKeySet()
	require.NoError(t, err)

	recorder := httptest.NewRecorder()
	set.JWKSHandler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil))

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))

	var raw struct{ Keys []map[string]any `json:"keys"` }
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &raw))
	require.Len(t, raw.Keys, 1)
	key := raw.Keys[0]
	assert.ElementsMatch(t, []string{"kty", "crv", "x", "y", "kid", "alg", "use"}, keysOf(key))
	assert.Equal(t, "EC", key["kty"])
	assert.Equal(t, "P-256", key["crv"])
	assert.Equal(t, "ES256", key["alg"])
	assert.Equal(t, "sig", key["use"])
	assert.Equal(t, set.ActiveID(), key["kid"])
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
```

- [ ] **Step 3 : vérifier qu'ils échouent**

Run : `go test -count=1 ./internal/token/`
Expected : FAIL — `undefined: LoadKeySet`, `readKeys`, `EphemeralKeySet`.

- [ ] **Step 4 : implémenter `keys.go`**

```go
// Package token signe les jetons de l'API Admin (ADR-0019 de go-gateway) et publie leurs clés.
package token

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/go-jose/go-jose/v4"
)

type signingKey struct {
	id      string
	private *ecdsa.PrivateKey
}

type KeySet struct {
	active signingKey
	all    []signingKey
}

func (s KeySet) ActiveID() string { return s.active.id }

func (s KeySet) IDs() []string {
	ids := make([]string, 0, len(s.all))
	for _, k := range s.all {
		ids = append(ids, k.id)
	}
	return ids
}

func LoadKeySet(dir, activeID string) (KeySet, error) {
	keys, err := readKeys(dir)
	if err != nil {
		return KeySet{}, err
	}
	for _, k := range keys {
		if k.id == activeID {
			return KeySet{active: k, all: keys}, nil
		}
	}
	ids := make([]string, 0, len(keys))
	for _, k := range keys {
		ids = append(ids, k.id)
	}
	return KeySet{}, fmt.Errorf("kid actif %q absent du dossier, disponibles : %s", activeID, strings.Join(ids, ", "))
}

// EphemeralKeySet sert le mode mock : une clé en mémoire, perdue au redémarrage, qu'aucune passerelle
// réelle ne connaît.
func EphemeralKeySet() (KeySet, error) {
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return KeySet{}, err
	}
	id, err := keyID(&private.PublicKey)
	if err != nil {
		return KeySet{}, err
	}
	k := signingKey{id: id, private: private}
	return KeySet{active: k, all: []signingKey{k}}, nil
}

func readKeys(dir string) ([]signingKey, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("dossier des clés de signature illisible : %w", err)
	}
	var keys []signingKey
	seen := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		key, err := readKey(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		if other, dup := seen[key.id]; dup {
			return nil, fmt.Errorf("%s et %s portent la même clé (kid %s)", other, entry.Name(), key.id)
		}
		seen[key.id] = entry.Name()
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return nil, errors.New("aucune clé de signature dans le dossier")
	}
	slices.SortFunc(keys, func(a, b signingKey) int { return strings.Compare(a.id, b.id) })
	return keys, nil
}

// readKey ne rend jamais le contenu du fichier dans son erreur : un PEM tronqué est encore un secret.
func readKey(path string) (signingKey, error) {
	name := filepath.Base(path)
	raw, err := os.ReadFile(path)
	if err != nil {
		return signingKey{}, fmt.Errorf("%s : clé illisible", name)
	}
	block, _ := pem.Decode(raw)
	if block == nil || block.Type != "PRIVATE KEY" {
		return signingKey{}, fmt.Errorf("%s : PEM PKCS#8 attendu", name)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return signingKey{}, fmt.Errorf("%s : PEM PKCS#8 attendu", name)
	}
	private, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || private.Curve != elliptic.P256() {
		return signingKey{}, fmt.Errorf("%s : clé EC P-256 attendue", name)
	}
	id, err := keyID(&private.PublicKey)
	if err != nil {
		return signingKey{}, fmt.Errorf("%s : empreinte incalculable", name)
	}
	return signingKey{id: id, private: private}, nil
}

func keyID(public *ecdsa.PublicKey) (string, error) {
	thumbprint, err := (&jose.JSONWebKey{Key: public}).Thumbprint(crypto.SHA256)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(thumbprint), nil
}
```

- [ ] **Step 5 : implémenter `jwks.go`**

```go
package token

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
)

// JWK est un DTO déclaré : la partie privée (`d`) n'y a aucun champ, donc ne peut pas sortir.
type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

type JWKS struct {
	Keys []JWK `json:"keys"`
}

func (s KeySet) JWKS() JWKS {
	set := JWKS{Keys: make([]JWK, 0, len(s.all))}
	for _, k := range s.all {
		public, err := k.private.PublicKey.ECDH()
		if err != nil {
			continue
		}
		point := public.Bytes() // 0x04 || X (32) || Y (32)
		set.Keys = append(set.Keys, JWK{
			Kty: "EC", Crv: "P-256",
			X:   base64.RawURLEncoding.EncodeToString(point[1:33]),
			Y:   base64.RawURLEncoding.EncodeToString(point[33:65]),
			Kid: k.id, Alg: "ES256", Use: "sig",
		})
	}
	return set
}

func (s KeySet) JWKSHandler() http.Handler {
	body, _ := json.Marshal(s.JWKS())
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
}
```

- [ ] **Step 6 : vérifier**

Run : `go test -count=1 ./internal/token/`
Expected : PASS.

- [ ] **Step 7 : commit**

```bash
git add go.mod go.sum internal/token/
git commit -m "feat(m3): clés de signature P-256 et JWKS public (step-070)"
```

---

### Task 3 : l'émetteur et son cache

**Files :**
- Create : `internal/token/issuer.go`
- Test : `internal/token/issuer_test.go`

**Interfaces :**
- Consumes : `KeySet`, `KeySet.JWKS()` (Task 2)
- Produces :
  - `const Audience = "gateway-admin"`
  - `var ErrNoSubject`, `var ErrNoScope` (`errors.New`)
  - `func NewIssuer(keys KeySet, issuer string, now func() time.Time) (*Issuer, error)`
  - `func (i *Issuer) Token(subject string, scopes []string) (string, error)`
  - `func (i *Issuer) Issuer() string`, `func (i *Issuer) ActiveKeyID() string`

- [ ] **Step 1 : écrire les tests rouges**

```go
package token

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const operator = "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59"

type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }

func newTestIssuer(t *testing.T, iss string) (*Issuer, KeySet, *clock) {
	t.Helper()
	keys, err := EphemeralKeySet()
	require.NoError(t, err)
	c := &clock{at: time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)}
	issuer, err := NewIssuer(keys, iss, c.now)
	require.NoError(t, err)
	return issuer, keys, c
}

// verifyWithServedKeys passe par le JSON du JWKS, comme la passerelle : la clé en mémoire ne prouve rien.
func verifyWithServedKeys(t *testing.T, keys KeySet, raw string) (header jose.Header, payload map[string]any) {
	t.Helper()
	served, err := json.Marshal(keys.JWKS())
	require.NoError(t, err)
	var set jose.JSONWebKeySet
	require.NoError(t, json.Unmarshal(served, &set))

	token, err := jwt.ParseSigned(raw, []jose.SignatureAlgorithm{jose.ES256})
	require.NoError(t, err)
	require.Len(t, token.Headers, 1)
	header = token.Headers[0]
	matching := set.Key(header.KeyID)
	require.Len(t, matching, 1, "le kid de l'en-tête est publié")
	require.NoError(t, token.Claims(matching[0].Key, &payload))
	return header, payload
}

func TestTheTokenCarriesExactlyTheClaimsTheGatewayChecks(t *testing.T) {
	issuer, keys, _ := newTestIssuer(t, "https://dashboard.internal/")

	raw, err := issuer.Token(operator, []string{"admin:write", "admin:read"})
	require.NoError(t, err)

	header, payload := verifyWithServedKeys(t, keys, raw)
	assert.Equal(t, keys.ActiveID(), header.KeyID)
	assert.Equal(t, "https://dashboard.internal/", payload["iss"], "le slash final est conservé")
	assert.Equal(t, "gateway-admin", payload["aud"], "aud est une chaîne")
	assert.Equal(t, operator, payload["sub"])
	scope, isString := payload["scope"].(string)
	require.True(t, isString, "scope est une chaîne et non un tableau : un tableau est refusé en 401")
	assert.Equal(t, "admin:read admin:write", scope)
	assert.EqualValues(t, 300, payload["exp"].(float64)-payload["iat"].(float64))
}

func TestTheIssuerIsSignedByteForByte(t *testing.T) {
	for _, iss := range []string{"https://dashboard.internal", "https://dashboard.internal/"} {
		issuer, keys, _ := newTestIssuer(t, iss)
		raw, err := issuer.Token(operator, []string{"admin:read"})
		require.NoError(t, err)
		_, payload := verifyWithServedKeys(t, keys, raw)
		assert.Equal(t, iss, payload["iss"])
	}
}

func TestATokenIsReusedUntilSixtySecondsBeforeItsExpiry(t *testing.T) {
	issuer, _, c := newTestIssuer(t, "https://dashboard.internal")
	first, err := issuer.Token(operator, []string{"admin:read"})
	require.NoError(t, err)

	c.at = c.at.Add(239 * time.Second)
	again, err := issuer.Token(operator, []string{"admin:read"})
	require.NoError(t, err)
	assert.Equal(t, first, again)

	c.at = c.at.Add(2 * time.Second)
	renewed, err := issuer.Token(operator, []string{"admin:read"})
	require.NoError(t, err)
	assert.NotEqual(t, first, renewed)
}

func TestOtherScopesGetAnotherToken(t *testing.T) {
	issuer, _, _ := newTestIssuer(t, "https://dashboard.internal")
	reader, err := issuer.Token(operator, []string{"admin:read"})
	require.NoError(t, err)
	writer, err := issuer.Token(operator, []string{"admin:read", "admin:write"})
	require.NoError(t, err)
	assert.NotEqual(t, reader, writer)
}

func TestNoTokenWithoutASubjectOrAScope(t *testing.T) {
	issuer, _, _ := newTestIssuer(t, "https://dashboard.internal")
	_, err := issuer.Token("", []string{"admin:read"})
	assert.ErrorIs(t, err, ErrNoSubject)
	_, err = issuer.Token(operator, nil)
	assert.ErrorIs(t, err, ErrNoScope)
}

func TestATokenSignedByARetiredKeyNoLongerVerifies(t *testing.T) {
	old, oldKeys, _ := newTestIssuer(t, "https://dashboard.internal")
	raw, err := old.Token(operator, []string{"admin:read"})
	require.NoError(t, err)

	_, newKeys, _ := newTestIssuer(t, "https://dashboard.internal")
	both := KeySet{active: newKeys.active, all: append(slicesOf(oldKeys), newKeys.all...)}
	_, payload := verifyWithServedKeys(t, both, raw)
	assert.Equal(t, operator, payload["sub"], "pendant la fenêtre, l'ancienne clé est publiée et vérifie")

	served, _ := json.Marshal(newKeys.JWKS())
	var set jose.JSONWebKeySet
	require.NoError(t, json.Unmarshal(served, &set))
	token, err := jwt.ParseSigned(raw, []jose.SignatureAlgorithm{jose.ES256})
	require.NoError(t, err)
	assert.Empty(t, set.Key(token.Headers[0].KeyID), "retirée, plus rien ne la vérifie")
	assert.False(t, strings.Contains(string(served), oldKeys.ActiveID()))
}

func slicesOf(s KeySet) []signingKey { return append([]signingKey(nil), s.all...) }
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run : `go test -count=1 ./internal/token/`
Expected : FAIL — `undefined: NewIssuer`.

- [ ] **Step 3 : implémenter `issuer.go`**

```go
package token

import (
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const (
	Audience    = "gateway-admin"
	lifetime    = 5 * time.Minute
	reuseMargin = 60 * time.Second
)

var (
	ErrNoSubject = errors.New("jeton sans sujet refusé")
	ErrNoScope   = errors.New("jeton sans scope refusé")
)

type cached struct {
	raw    string
	expiry time.Time
}

type Issuer struct {
	issuer string
	keyID  string
	signer jose.Signer
	now    func() time.Time

	mu    sync.Mutex
	cache map[string]cached
}

func NewIssuer(keys KeySet, issuer string, now func() time.Time) (*Issuer, error) {
	signer, err := jose.NewSigner(jose.SigningKey{
		Algorithm: jose.ES256,
		Key:       jose.JSONWebKey{Key: keys.active.private, KeyID: keys.active.id},
	}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		return nil, err
	}
	return &Issuer{issuer: issuer, keyID: keys.active.id, signer: signer, now: now, cache: map[string]cached{}}, nil
}

func (i *Issuer) Issuer() string      { return i.issuer }
func (i *Issuer) ActiveKeyID() string { return i.keyID }

func (i *Issuer) Token(subject string, scopes []string) (string, error) {
	if subject == "" {
		return "", ErrNoSubject
	}
	if len(scopes) == 0 {
		return "", ErrNoScope
	}
	sorted := slices.Sorted(slices.Values(scopes))
	scope := strings.Join(slices.Compact(sorted), " ")
	key := subject + "\x00" + scope
	now := i.now()

	i.mu.Lock()
	defer i.mu.Unlock()
	if hit, ok := i.cache[key]; ok && hit.expiry.Sub(now) > reuseMargin {
		return hit.raw, nil
	}

	expiry := now.Add(lifetime)
	raw, err := jwt.Signed(i.signer).
		Claims(jwt.Claims{
			Issuer:   i.issuer,
			Subject:  subject,
			Audience: jwt.Audience{Audience},
			IssuedAt: jwt.NewNumericDate(now),
			Expiry:   jwt.NewNumericDate(expiry),
		}).
		Claims(struct {
			Scope string `json:"scope"`
		}{scope}).
		Serialize()
	if err != nil {
		return "", err
	}
	for k, v := range i.cache {
		if !v.expiry.After(now) {
			delete(i.cache, k)
		}
	}
	i.cache[key] = cached{raw: raw, expiry: expiry}
	return raw, nil
}
```

- [ ] **Step 4 : vérifier**

Run : `go test -count=1 ./internal/token/`
Expected : PASS. Si `jose.JSONWebKey` passé **par valeur** n'est pas accepté par `NewSigner`,
passer `&jose.JSONWebKey{…}` ; `TestTheTokenCarriesExactlyTheClaimsTheGatewayChecks` vérifie que le
`kid` arrive en en-tête dans les deux cas.

- [ ] **Step 5 : commit**

```bash
git add internal/token/
git commit -m "feat(m3): émetteur ES256 des jetons de l'API Admin, cache par sujet et scopes (step-070)"
```

---

### Task 4 : traduction permissions → scopes

**Files :**
- Create : `internal/permissions/scopes.go`
- Test : `internal/permissions/scopes_test.go`

**Interfaces :**
- Consumes : `All()`, `DefaultRoles()`, constantes `Key`
- Produces :
  - constantes `ScopeAdminRead = "admin:read"`, `ScopeAdminWrite`, `ScopeContentRead`,
    `ScopeContentErase`, `ScopeGDPRErase`, `ScopeCDRExportBulk`, `ScopeAuditRead`,
    `ScopeMSISDNReveal = "msisdn:reveal"`
  - `func GatewayScopes(held []string) []string` (triés, sans doublon, `nil` si rien)

- [ ] **Step 1 : écrire les tests rouges**

```go
package permissions

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Écrite à la main d'après le §6.10 et l'ADR-0019, jamais dérivée du code qu'elle juge.
var expectedScopesByRole = map[string][]string{
	"Propriétaire": {"admin:read", "admin:write", "audit:read", "cdr:export_bulk", "content:erase", "content:read", "gdpr:erase", "msisdn:reveal"},
	"Exploitation": {"admin:read", "admin:write", "audit:read", "cdr:export_bulk", "msisdn:reveal"},
	"Scripts":      {"admin:read", "admin:write"},
	"Support":      {"admin:read", "msisdn:reveal"},
	"Finance":      {"admin:read", "admin:write"},
	"Reporting":    {"admin:read"},
	"Clientèle":    {"admin:read", "admin:write"},
	"Conformité":   {"admin:read", "admin:write", "cdr:export_bulk", "content:erase", "gdpr:erase", "msisdn:reveal"},
	"Audit":        {"audit:read"},
}

func TestEveryDefaultRoleOpensExactlyItsGatewayScopes(t *testing.T) {
	roles := DefaultRoles()
	require.Len(t, expectedScopesByRole, len(roles))
	for _, role := range roles {
		held := make([]string, 0, len(role.Keys))
		for _, k := range role.Keys {
			held = append(held, string(k))
		}
		assert.Equal(t, expectedScopesByRole[role.Name], GatewayScopes(held), role.Name)
	}
}

func TestEveryCatalogKeyHasAGatewayClass(t *testing.T) {
	for _, entry := range All() {
		_, classified := gatewayAccess[entry.Key]
		assert.True(t, classified, "%s n'a pas de classe : elle n'ouvrirait rien à la passerelle sans que personne ne l'ait décidé", entry.Key)
	}
}

func TestNoClassNamesAKeyOutsideTheCatalog(t *testing.T) {
	catalogued := map[Key]bool{}
	for _, entry := range All() {
		catalogued[entry.Key] = true
	}
	for key := range gatewayAccess {
		assert.True(t, catalogued[key], "%s est classée mais absente du catalogue", key)
	}
	assert.Len(t, gatewayAccess, len(All()))
}

func TestLocalKeysOpenNothingAtTheGateway(t *testing.T) {
	assert.Nil(t, GatewayScopes([]string{string(OperatorsManage), string(RolesManage), string(AlertsWrite)}))
}

func TestReadingUnmaskedNumbersMapsToMSISDNReveal(t *testing.T) {
	assert.Equal(t, []string{"msisdn:reveal"}, GatewayScopes([]string{string(CDRReadPII)}))
}

func TestAnUnknownKeyOpensNothing(t *testing.T) {
	assert.Nil(t, GatewayScopes([]string{"inexistante:clé"}))
}
```

Avant d'écrire : vérifier les noms Go exacts des constantes (`OperatorsManage`, `RolesManage`,
`AlertsWrite`, `CDRReadPII`, …) par `sed -n 12,65p internal/permissions/catalog.go`.

- [ ] **Step 2 : vérifier qu'ils échouent**

Run : `go test -count=1 ./internal/permissions/`
Expected : FAIL — `undefined: GatewayScopes`, `gatewayAccess`.

- [ ] **Step 3 : implémenter `scopes.go`**

```go
package permissions

import "slices"

const (
	ScopeAdminRead     = "admin:read"
	ScopeAdminWrite    = "admin:write"
	ScopeContentRead   = "content:read"
	ScopeContentErase  = "content:erase"
	ScopeGDPRErase     = "gdpr:erase"
	ScopeCDRExportBulk = "cdr:export_bulk"
	ScopeAuditRead     = "audit:read"
	ScopeMSISDNReveal  = "msisdn:reveal"
)

// gatewayAccess dit ce que chaque clé ouvre à la passerelle (ADR-0019). Une clé propre au BFF
// n'ouvre rien : la traduire en admin:write donnerait l'écriture amont à qui gère les opérateurs.
var gatewayAccess = map[Key]string{
	RoutesRead: ScopeAdminRead, RoutesWrite: ScopeAdminWrite, RoutesImport: ScopeAdminWrite,
	ScriptsRead: ScopeAdminRead, ScriptsWrite: ScopeAdminWrite, ScriptsPublish: ScopeAdminWrite,
	SenderRewriteRead: ScopeAdminRead, SenderRewriteWrite: ScopeAdminWrite,
	ConnectorsRead: ScopeAdminRead, ConnectorsWrite: ScopeAdminWrite, ConnectorsRebind: ScopeAdminWrite,
	SessionsRead: ScopeAdminRead, SessionsDisconnect: ScopeAdminWrite,
	AntispamRead: ScopeAdminRead, AntispamWrite: ScopeAdminWrite,
	CustomersRead: ScopeAdminRead, CustomersWrite: ScopeAdminWrite,
	AccountsRead: ScopeAdminRead, AccountsWrite: ScopeAdminWrite,
	CredentialsRead: ScopeAdminRead, CredentialsWrite: ScopeAdminWrite, CredentialsRotate: ScopeAdminWrite,
	GroupsRead: ScopeAdminRead, GroupsWrite: ScopeAdminWrite,
	BillingRead: ScopeAdminRead, BillingWrite: ScopeAdminWrite, BillingTopup: ScopeAdminWrite,
	BillingProviderWrite: ScopeAdminWrite, BillingScopeChange: ScopeAdminWrite,
	ContentRead: ScopeContentRead, ContentErase: ScopeContentErase,
	CDRReadPII: ScopeMSISDNReveal, CDRExportBulk: ScopeCDRExportBulk,
	SuppressionsRead: ScopeAdminRead, SuppressionsWrite: ScopeAdminWrite, SuppressionsDelete: ScopeAdminWrite,
	InboundRead: ScopeAdminRead, InboundWrite: ScopeAdminWrite,
	GDPRErase: ScopeGDPRErase,
	AuditRead: ScopeAuditRead,
	AlertsRead: "", AlertsWrite: "",
	OperatorsManage: "", RolesManage: "",
}

func GatewayScopes(held []string) []string {
	var scopes []string
	for _, key := range held {
		if scope := gatewayAccess[Key(key)]; scope != "" {
			scopes = append(scopes, scope)
		}
	}
	if len(scopes) == 0 {
		return nil
	}
	slices.Sort(scopes)
	return slices.Compact(scopes)
}
```

Les alertes sont locales : les règles et notifications vivent dans le BFF, et le flux amont
`billing-alerts` est ouvert par l'identité système.

- [ ] **Step 4 : vérifier**

Run : `go test -count=1 ./internal/permissions/`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git add internal/permissions/scopes.go internal/permissions/scopes_test.go
git commit -m "feat(m3): traduction des permissions en scopes de passerelle, cdr:read_pii → msisdn:reveal (step-070)"
```

---

### Task 5 : l'appelant dans le contexte, et le transport qui signe

**Files :**
- Create : `internal/gateway/caller.go`, `internal/gateway/caller_test.go`
- Modify : `internal/gateway/client.go` (retirer `mockAccessToken`, `mockToken`, `machineCredentials`,
  la branche `TokenURL` d'`encryptedEndpoints`, `newTokenTransport`)
- Delete : `internal/gateway/token.go`, `internal/gateway/token_test.go`
- Modify : `internal/gateway/client_test.go`, `transport_test.go` (suivre les nouvelles signatures)
- Modify : `go.mod` (`go get github.com/coreos/go-oidc/v3@v3.18.0` ; `go mod tidy` retire `oauth2`
  s'il ne sert plus)

**Interfaces :**
- Consumes : `token.Issuer` (Task 3), `permissions.GatewayScopes`, `permissions.ScopeAdminRead` (Task 4)
- Produces :
  - `const SystemSubject = "7b0e3f5a-2c4d-4e6f-9a1b-3c5d7e9f0a2b"`
  - `func WithOperator(ctx context.Context, operatorID string, permissions []string) context.Context`
  - `func WithSystem(ctx context.Context) context.Context`
  - `var ErrNoCaller = errors.New(...)`
  - `func NewAdminClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*ClientWithResponses, error)`
  - `func NewStreamClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*http.Client, error)`

- [ ] **Step 1 : écrire les tests rouges** (`caller_test.go`)

```go
package gateway

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/token"
)

const issuerURL = "https://dashboard.test"

type seen struct {
	mu            sync.Mutex
	authorization string
	cookie        string
	calls         int
}

func upstream(t *testing.T, status int, s *seen) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.calls++
		s.authorization = r.Header.Get("Authorization")
		s.cookie = r.Header.Get("Cookie")
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"code":"x","message":"y"}`))
	}))
}

func mockClient(t *testing.T, baseURL string, logs *bytes.Buffer) (*http.Client, token.KeySet) {
	t.Helper()
	keys, err := token.EphemeralKeySet()
	require.NoError(t, err)
	issuer, err := token.NewIssuer(keys, issuerURL, time.Now)
	require.NoError(t, err)
	client, err := NewStreamClient(config.GatewayConfig{Mode: config.GatewayModeMock, BaseURL: baseURL, Timeout: 2 * time.Second},
		issuer, slog.New(slog.NewJSONHandler(logs, nil)))
	require.NoError(t, err)
	return client, keys
}

func TestACallWithoutACallerNeverLeaves(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, _ := mockClient(t, srv.URL, &bytes.Buffer{})

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, srv.URL+"/admin/customers", nil)
	_, err := client.Do(req)
	require.ErrorIs(t, err, ErrNoCaller)
	assert.Zero(t, s.calls, "aucune requête n'a atteint la passerelle")
}

func TestAnOperatorWithOnlyLocalKeysNeverLeavesEither(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, _ := mockClient(t, srv.URL, &bytes.Buffer{})

	ctx := WithOperator(context.Background(), "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", []string{"operators:manage"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/admin/customers", nil)
	_, err := client.Do(req)
	require.ErrorIs(t, err, ErrNoCaller)
	assert.Zero(t, s.calls)
}

func TestTheOperatorTokenVerifiesAsTheGatewayVerifiesIt(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, keys := mockClient(t, srv.URL, &bytes.Buffer{})

	jwks := httptest.NewServer(keys.JWKSHandler())
	defer jwks.Close()
	verifier := oidc.NewVerifier(issuerURL, oidc.NewRemoteKeySet(context.Background(), jwks.URL),
		&oidc.Config{ClientID: token.Audience, SupportedSigningAlgs: []string{oidc.ES256}})

	ctx := WithOperator(context.Background(), "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", []string{"customers:read", "cdr:read_pii"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/admin/customers", nil)
	req.Header.Set("Cookie", "dashboard_session=never-forwarded")
	resp, err := client.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()

	raw := s.authorization[len("Bearer "):]
	idToken, err := verifier.Verify(context.Background(), raw)
	require.NoError(t, err)
	var claims struct{ Scope string `json:"scope"` }
	require.NoError(t, idToken.Claims(&claims))
	assert.Equal(t, "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", idToken.Subject)
	assert.Equal(t, "admin:read msisdn:reveal", claims.Scope)
	assert.Empty(t, s.cookie, "le cookie de session ne part jamais vers la passerelle")
}

func TestTheSystemIdentityReadsOnly(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusOK, s)
	defer srv.Close()
	client, keys := mockClient(t, srv.URL, &bytes.Buffer{})
	jwks := httptest.NewServer(keys.JWKSHandler())
	defer jwks.Close()
	verifier := oidc.NewVerifier(issuerURL, oidc.NewRemoteKeySet(context.Background(), jwks.URL),
		&oidc.Config{ClientID: token.Audience, SupportedSigningAlgs: []string{oidc.ES256}})

	req, _ := http.NewRequestWithContext(WithSystem(context.Background()), http.MethodGet, srv.URL+"/admin/stream/metrics", nil)
	resp, err := client.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()

	idToken, err := verifier.Verify(context.Background(), s.authorization[len("Bearer "):])
	require.NoError(t, err)
	var claims struct{ Scope string `json:"scope"` }
	require.NoError(t, idToken.Claims(&claims))
	assert.Equal(t, SystemSubject, idToken.Subject)
	assert.Equal(t, "admin:read", claims.Scope)
}

func TestARejectedTokenIsLoggedWithoutTheToken(t *testing.T) {
	s := &seen{}
	srv := upstream(t, http.StatusUnauthorized, s)
	defer srv.Close()
	logs := &bytes.Buffer{}
	client, keys := mockClient(t, srv.URL, logs)

	ctx := WithOperator(context.Background(), "4f3c2b1a-9e8d-4c7b-a6f5-0e1d2c3b4a59", []string{"customers:read"})
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/admin/customers", nil)
	resp, err := client.Do(req)
	require.NoError(t, err)
	_ = resp.Body.Close()

	assert.Contains(t, logs.String(), "gateway_token_rejected")
	assert.Contains(t, logs.String(), keys.ActiveID())
	assert.NotContains(t, logs.String(), s.authorization[len("Bearer "):])
}
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run : `go get github.com/coreos/go-oidc/v3@v3.18.0 && go test -count=1 ./internal/gateway/ -run 'Caller|Leaves|Verifies|System|Rejected'`
Expected : FAIL de compilation — `undefined: WithOperator`, signatures de `NewStreamClient`.

- [ ] **Step 3 : implémenter `caller.go`**

```go
package gateway

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
	"github.com/martialanouman/go-gateway-bo/internal/token"
)

// SystemSubject est l'identité des flux temps réel du hub, qu'aucun opérateur ne porte. Une
// constante et non une ligne en base : l'amorçage n'accepte qu'une table operators vide.
const SystemSubject = "7b0e3f5a-2c4d-4e6f-9a1b-3c5d7e9f0a2b"

var ErrNoCaller = errors.New("appel à l'API Admin sans appelant ni scope : refusé avant le réseau")

type caller struct {
	subject string
	scopes  []string
}

type callerKey struct{}

func WithOperator(ctx context.Context, operatorID string, held []string) context.Context {
	return context.WithValue(ctx, callerKey{}, caller{subject: operatorID, scopes: permissions.GatewayScopes(held)})
}

func WithSystem(ctx context.Context) context.Context {
	return context.WithValue(ctx, callerKey{}, caller{subject: SystemSubject, scopes: []string{permissions.ScopeAdminRead}})
}

type signedTransport struct {
	base   http.RoundTripper
	issuer *token.Issuer
	logger *slog.Logger
}

func (t signedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	who, ok := req.Context().Value(callerKey{}).(caller)
	if !ok || who.subject == "" || len(who.scopes) == 0 {
		return nil, ErrNoCaller
	}
	raw, err := t.issuer.Token(who.subject, who.scopes)
	if err != nil {
		return nil, err
	}
	outgoing := req.Clone(req.Context())
	outgoing.Header.Del("Cookie")
	outgoing.Header.Set("Authorization", "Bearer "+raw)

	response, err := t.base.RoundTrip(outgoing)
	if err != nil {
		return nil, err
	}
	switch response.StatusCode {
	case http.StatusUnauthorized:
		t.logger.ErrorContext(req.Context(), "gateway_token_rejected",
			"kid", t.issuer.ActiveKeyID(), "iss", t.issuer.Issuer(), "sub", who.subject, "at", time.Now().UTC())
	case http.StatusServiceUnavailable:
		t.logger.WarnContext(req.Context(), "gateway_unavailable : si le code est service_unavailable, la passerelle n'a pas pu lire le JWKS du tableau de bord",
			"kid", t.issuer.ActiveKeyID())
	}
	return response, nil
}
```

- [ ] **Step 4 : réécrire `authenticatedClient` dans `client.go`**

Remplacer le corps (et les signatures publiques) par :

```go
func NewAdminClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*ClientWithResponses, error) {
	httpClient, err := authenticatedClient(cfg, issuer, logger)
	if err != nil {
		return nil, err
	}
	client, err := NewClientWithResponses(cfg.BaseURL, WithHTTPClient(httpClient))
	if err != nil {
		return nil, fmt.Errorf("client de l'API Admin : %w", err)
	}
	return client, nil
}

func NewStreamClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*http.Client, error) {
	return authenticatedClient(cfg, issuer, logger)
}

func authenticatedClient(cfg config.GatewayConfig, issuer *token.Issuer, logger *slog.Logger) (*http.Client, error) {
	if err := knownMode(cfg.Mode); err != nil {
		return nil, err
	}
	if err := encryptedEndpoints(cfg); err != nil {
		return nil, err
	}
	transport, err := outboundTransport(cfg)
	if err != nil {
		return nil, err
	}
	return &http.Client{Transport: signedTransport{base: transport, issuer: issuer, logger: logger}, Timeout: cfg.Timeout}, nil
}
```

Dans `encryptedEndpoints`, la boucle ne garde que `{name: "URL de base", rawURL: cfg.BaseURL}`.
Supprimer `mockAccessToken`, `mockToken`, `machineCredentials`, `token.go`, `token_test.go`. Mettre à
jour le commentaire de `NewAdminClient` : « mTLS, jeton signé par appelant, timeout et rejeu timide ».
Le commentaire de `encryptedEndpoints` perd la phrase sur le tokenUrl et les cinq scopes.

- [ ] **Step 5 : réparer les tests existants du paquet**

Run : `go vet ./internal/gateway/ 2>&1 | head -30`
Pour chaque appel `NewAdminClient(cfg)` / `NewStreamClient(cfg)` dans `client_test.go`,
`transport_test.go`, `stream_test.go`, `gateway_test.go` : passer un émetteur éphémère et un logger
(`slog.New(slog.DiscardHandler)`), et poser `WithSystem(ctx)` ou `WithOperator(...)` sur les
requêtes. Supprimer les tests du jeton machine (`tokenUrl`, `client_credentials`). Les tests
d'`encryptedEndpoints` qui exerçaient le tokenUrl sont retirés : la branche n'existe plus.

- [ ] **Step 6 : vérifier**

Run : `go build ./... ; go test -count=1 ./internal/gateway/`
Expected : `go build` échoue encore dans `cmd/dashboard` (signatures) — c'est la Task 7 ; le paquet
`internal/gateway` passe.

- [ ] **Step 7 : commit**

```bash
git add internal/gateway/ go.mod go.sum
git commit -m "feat(m3): le transport signe au nom de l'appelant et refuse un appel sans appelant (step-070)"
```

---

### Task 6 : configuration

**Files :**
- Modify : `internal/config/config.go`, `internal/config/config_test.go`, `.env.example`,
  `cmd/dashboard/configuration.feature`

**Interfaces :**
- Produces : constantes `EnvTokenIssuer = "DASHBOARD_TOKEN_ISSUER"`, `EnvTokenKeysDir =
  "DASHBOARD_TOKEN_KEYS_DIR"`, `EnvTokenActiveKID = "DASHBOARD_TOKEN_ACTIVE_KID"` ; dans
  `GatewayConfig` : `TokenIssuer`, `TokenKeysDir`, `TokenActiveKID string` ; `const MockTokenIssuer =
  "https://dashboard.mock.invalid"`. Retirés : `EnvGatewayTokenURL`, `EnvGatewayClientID`,
  `EnvGatewayClientSecret`, `GatewayConfig.TokenURL/ClientID/ClientSecret`.

- [ ] **Step 1 : tests rouges** — dans `config_test.go`, `realGatewayEnv()` perd les trois variables
  OAuth2 et gagne :

```go
config.EnvTokenIssuer:    "https://dashboard.internal",
config.EnvTokenKeysDir:   "/etc/dashboard/token-keys",
config.EnvTokenActiveKID: "kid-actif",
```

Ajouter, sur le modèle de `TestLoadGateway` :

```go
func TestLoadTokenIssuer(t *testing.T) {
	t.Run("kept byte for byte", func(t *testing.T) {
		cfg, err := config.Load(lookupFrom(envWith(realGatewayEnv(), map[string]string{config.EnvTokenIssuer: "https://dashboard.internal/"})))
		require.NoError(t, err)
		assert.Equal(t, "https://dashboard.internal/", cfg.Gateway.TokenIssuer)
	})
	for name, value := range map[string]string{
		"surrounding space": " https://dashboard.internal",
		"cleartext":         "http://dashboard.internal",
		"query":             "https://dashboard.internal?x=1",
		"fragment":          "https://dashboard.internal#x",
	} {
		t.Run("refuses "+name, func(t *testing.T) {
			_, err := config.Load(lookupFrom(envWith(realGatewayEnv(), map[string]string{config.EnvTokenIssuer: value})))
			require.Error(t, err)
			assert.Contains(t, err.Error(), config.EnvTokenIssuer)
		})
	}
	t.Run("required in real mode", func(t *testing.T) {
		env := realGatewayEnv()
		delete(env, config.EnvTokenKeysDir)
		delete(env, config.EnvTokenActiveKID)
		_, err := config.Load(lookupFrom(env))
		require.Error(t, err)
		assert.Contains(t, err.Error(), config.EnvTokenKeysDir)
		assert.Contains(t, err.Error(), config.EnvTokenActiveKID)
	})
	t.Run("optional in mock mode, with a mock issuer", func(t *testing.T) {
		cfg, err := config.Load(lookupFrom(minimalEnv()))
		require.NoError(t, err)
		assert.Equal(t, config.MockTokenIssuer, cfg.Gateway.TokenIssuer)
	})
}
```

`TestVariablesListsEveryNameLoadReads` rougit tant que `Variables` n'est pas à jour : c'est voulu.

- [ ] **Step 2 : vérifier qu'ils échouent**

Run : `go test -count=1 ./internal/config/`
Expected : FAIL — `undefined: config.EnvTokenIssuer`.

- [ ] **Step 3 : implémenter**

Dans `config.go` : retirer les trois constantes OAuth2, en ajouter trois ; retirer les champs et les
lectures `TokenURL/ClientID/ClientSecret` (l. 246-248) ; ajouter dans le littéral `GatewayConfig` :

```go
TokenIssuer:    r.tokenIssuer(EnvTokenIssuer, mode),
TokenKeysDir:   r.optional(EnvTokenKeysDir),
TokenActiveKID: r.optional(EnvTokenActiveKID),
```

(`mode` = la valeur déjà lue par `gatewayMode` ; si elle est lue plus bas, l'extraire dans une
variable avant le littéral). Dans `requireRealGatewayMaterial`, remplacer les trois OAuth2 par
`EnvTokenIssuer, EnvTokenKeysDir, EnvTokenActiveKID`. Mettre à jour `Variables` (l. 359-363).
Ajouter :

```go
const MockTokenIssuer = "https://dashboard.mock.invalid"

// tokenIssuer lit la valeur brute, sans TrimSpace : la passerelle la compare octet pour octet à
// OIDC_ISSUER, et une valeur nettoyée ici divergerait de celle qu'on aura recopiée là-bas.
func (r *reader) tokenIssuer(name string, mode GatewayMode) string {
	value, found := r.lookup(name)
	if !found || value == "" {
		if mode == GatewayModeMock {
			return MockTokenIssuer
		}
		return ""
	}
	parsed, err := url.Parse(value)
	if value != strings.TrimSpace(value) || err != nil || parsed.Scheme != "https" || parsed.Host == "" ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		r.reject(name, "URL https canonique attendue, sans espace, requête ni fragment, reçu %q", value)
		return ""
	}
	return value
}
```

`.env.example` : remplacer les trois lignes OAuth2 par les trois nouvelles, commentées (« URL
canonique du BFF, recopiée telle quelle dans OIDC_ISSUER de la passerelle », « dossier de PEM
PKCS#8 P-256 monté depuis un Secret », « kid de la clé qui signe, lu au démarrage dans les logs »).
`cmd/dashboard/configuration.feature` : remplacer chaque mention des trois variables OAuth2 par
leur équivalent (`grep -n 'TOKEN_URL\|CLIENT_ID\|CLIENT_SECRET' cmd/dashboard/configuration.feature`).

- [ ] **Step 4 : vérifier**

Run : `go test -count=1 ./internal/config/`
Expected : PASS.

- [ ] **Step 5 : commit**

```bash
git add internal/config/ .env.example cmd/dashboard/configuration.feature
git commit -m "feat(m3): DASHBOARD_TOKEN_*, l'émetteur pris tel quel ; fin du client_credentials (step-070)"
```

---

### Task 7 : câblage — garde, hub, JWKS, scénarios

**Files :**
- Create : `cmd/dashboard/gateway-token.feature`, `cmd/dashboard/gateway_token_test.go`
- Modify : `cmd/dashboard/main.go`, `cmd/dashboard/main_test.go` (enregistrer le monde),
  `internal/bff/guard.go`, `internal/bff/router.go` (`Dependencies.JWKS`, route),
  `internal/fakegateway/fakegateway.go`

**Interfaces :**
- Consumes : tout ce qui précède.
- Produces : `bff.Dependencies.JWKS http.Handler` ; `fakegateway.Verifying(issuer, jwksURL string)
  *Verifier` avec `ServeHTTP` qui vérifie puis délègue, et `Seen() []Principal` (`Principal{Path,
  Subject, Scope, Cookie, Token string}`).

- [ ] **Step 1 : écrire le `.feature` rouge**

```gherkin
# language: fr
Fonctionnalité: Le BFF s'authentifie auprès de la passerelle au nom de l'opérateur
  La passerelle ne détient aucun secret : elle vérifie contre le JWKS du tableau de bord un jeton
  signé au nom de l'opérateur connecté, et n'ouvre que les scopes que ses permissions traduisent.

  Contexte:
    Étant donné une installation avec un opérateur

  Scénario: la passerelle reçoit l'identité et les droits de l'opérateur, jamais son cookie
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 200
    Et la passerelle a reçu un jeton au nom de l'opérateur avec le scope "admin:read msisdn:reveal"
    Et la passerelle n'a reçu aucun cookie
    Et aucune sortie ne porte le jeton reçu par la passerelle

  Scénario: un changement de rôle change les droits du jeton suivant, sans déconnexion
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Et l'opérateur détient le rôle "Reporting"
    Et l'opérateur ouvre une session élevée
    Et l'opérateur détient le rôle "Clientèle"
    Quand le navigateur demande "/api/customer-groups"
    Alors la passerelle a reçu un jeton au nom de l'opérateur avec le scope "admin:read admin:write"

  Scénario: les flux temps réel s'ouvrent au nom de l'identité système, en lecture seule
    Étant donné une passerelle qui vérifie les jetons du tableau de bord
    Et un serveur démarré
    Alors la passerelle a ouvert le flux "/admin/stream/metrics" au nom de l'identité système avec le scope "admin:read"

  Scénario: un jeton refusé par la passerelle laisse la session ouverte
    Étant donné une passerelle qui refuse tout jeton
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 502
    Et la réponse porte '"code":"bff_gateway_rejected_token"'
    Quand le navigateur demande "/api/auth/me"
    Alors le serveur répond 200

  Scénario: une passerelle qui ne peut pas lire le JWKS laisse la session ouverte
    Étant donné une passerelle qui répond 503 "service_unavailable"
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 503
    Quand le navigateur demande "/api/auth/me"
    Alors le serveur répond 200

  Scénario: un scope refusé par la passerelle est un refus expliqué
    Étant donné une passerelle qui répond 403 "forbidden_scope"
    Et un serveur démarré
    Et l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/customer-groups"
    Alors le serveur répond 403
    Et la réponse porte '"code":"forbidden_scope"'

  Scénario: le JWKS se lit sans session et ne publie aucune partie privée
    Étant donné un serveur démarré
    Quand le navigateur demande "/.well-known/jwks.json"
    Alors le serveur répond 200
    Et la réponse publie une clé ES256 sans partie privée
```

Avant d'écrire les steps : vérifier que `l'opérateur détient le rôle "X"` (`operators_test.go:34`,
`holdOnly`) **remplace** les rôles (d'où « Clientèle » seul au second scénario, scope attendu sans
`msisdn:reveal`). Si `holdOnly` accumule, adapter le scope attendu, jamais le step.

- [ ] **Step 2 : écrire les steps (`gateway_token_test.go`)**

```go
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/cucumber/godog"

	"github.com/martialanouman/go-gateway-bo/internal/fakegateway"
	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

type gatewayTokenWorld struct {
	process  *process
	login    *loginWorld
	verifier *fakegateway.Verifier
	upstream *httptest.Server
}

func (w *gatewayTokenWorld) registerSteps(ctx *godog.ScenarioContext) {
	ctx.Given(`^une passerelle qui vérifie les jetons du tableau de bord$`, w.verifyingGateway)
	ctx.Given(`^une passerelle qui refuse tout jeton$`, func() error {
		return w.answering(http.StatusUnauthorized, "unauthenticated")
	})
	ctx.Given(`^une passerelle qui répond (\d+) "([^"]*)"$`, w.answering)
	ctx.Then(`^la passerelle a reçu un jeton au nom de l'opérateur avec le scope "([^"]*)"$`, w.receivedOperatorToken)
	ctx.Then(`^la passerelle n'a reçu aucun cookie$`, w.receivedNoCookie)
	ctx.Then(`^aucune sortie ne porte le jeton reçu par la passerelle$`, w.outputHidesTheToken)
	ctx.Then(`^la passerelle a ouvert le flux "([^"]*)" au nom de l'identité système avec le scope "([^"]*)"$`, w.openedFeedAsSystem)
	ctx.Then(`^la réponse publie une clé ES256 sans partie privée$`, w.publishesPublicKeyOnly)
}

// verifyingGateway fixe l'adresse du serveur avant son démarrage : la passerelle doit connaître l'URL
// du JWKS, et le serveur ouvre ses flux dès qu'il écoute.
func (w *gatewayTokenWorld) verifyingGateway() error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	addr := listener.Addr().String()
	_ = listener.Close()

	w.process.env["DASHBOARD_ADDR"] = addr
	w.verifier = fakegateway.Verifying(config.MockTokenIssuer, "http://"+addr+"/.well-known/jwks.json")
	w.upstream = httptest.NewServer(w.verifier)
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = w.upstream.URL
	return nil
}

func (w *gatewayTokenWorld) answering(status int, code string) error {
	w.upstream = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		rw.WriteHeader(status)
		_, _ = fmt.Fprintf(rw, `{"code":%q,"message":"refus de scénario"}`, code)
	}))
	w.process.env["DASHBOARD_GATEWAY_BASE_URL"] = w.upstream.URL
	return nil
}

func (w *gatewayTokenWorld) lastOn(prefix string) (fakegateway.Principal, error) {
	seen := w.verifier.Seen()
	for i := len(seen) - 1; i >= 0; i-- {
		if strings.HasPrefix(seen[i].Path, prefix) {
			return seen[i], nil
		}
	}
	return fakegateway.Principal{}, fmt.Errorf("aucun appel vérifié sur %s, reçus : %v", prefix, seen)
}

func (w *gatewayTokenWorld) receivedOperatorToken(scope string) error {
	got, err := w.lastOn("/admin/customer-groups")
	if err != nil {
		return err
	}
	if got.Subject != w.login.operatorID || got.Scope != scope {
		return fmt.Errorf("jeton reçu au nom de %q avec %q, attendu %q avec %q", got.Subject, got.Scope, w.login.operatorID, scope)
	}
	return nil
}

func (w *gatewayTokenWorld) receivedNoCookie() error {
	for _, p := range w.verifier.Seen() {
		if p.Cookie != "" {
			return fmt.Errorf("la passerelle a reçu un cookie sur %s", p.Path)
		}
	}
	return nil
}

func (w *gatewayTokenWorld) outputHidesTheToken() error {
	got, err := w.lastOn("/admin/customer-groups")
	if err != nil {
		return err
	}
	return w.process.outputHides(got.Token)
}

func (w *gatewayTokenWorld) openedFeedAsSystem(path, scope string) error {
	return eventually(func() error {
		got, err := w.lastOn(path)
		if err != nil {
			return err
		}
		if got.Subject != gateway.SystemSubject || got.Scope != scope {
			return fmt.Errorf("flux ouvert au nom de %q avec %q", got.Subject, got.Scope)
		}
		return nil
	})
}

func (w *gatewayTokenWorld) publishesPublicKeyOnly() error {
	var set struct{ Keys []map[string]any `json:"keys"` }
	if err := json.Unmarshal(w.process.received.body, &set); err != nil {
		return err
	}
	if len(set.Keys) == 0 || set.Keys[0]["alg"] != "ES256" {
		return fmt.Errorf("aucune clé ES256 publiée : %v", set.Keys)
	}
	if _, private := set.Keys[0]["d"]; private {
		return fmt.Errorf("le JWKS publie la partie privée d'une clé")
	}
	return nil
}
```

Ajustements à faire en écrivant, en lisant le harnais : le nom réel du champ qui porte l'identifiant
de l'opérateur dans `loginWorld` (`grep -n 'operatorID\|operatorId' cmd/dashboard/login_test.go`) ;
le nom réel du corps dans `response` (`grep -n 'type response struct' -A8 cmd/dashboard/main_test.go`) ;
l'aide d'attente bornée existante (`grep -n 'func eventually\|func waitFor' cmd/dashboard/*_test.go`) —
utiliser celle qui existe à la place d'`eventually`. Enregistrer le monde
dans `initializeScenario` à côté de `customerGroupsWorld` (`main_test.go:277`) :
`(&gatewayTokenWorld{process: p, login: login}).registerSteps(ctx)`.

Dans `completeConfiguration()` (`main_test.go:318`), rien à ajouter : en mock, l'émetteur vaut
`config.MockTokenIssuer`, que `verifyingGateway` passe au faux amont (importer
`internal/config`).

- [ ] **Step 3 : le faux amont qui vérifie** (`internal/fakegateway/fakegateway.go`)

```go
// Verifier juge chaque requête comme la passerelle (go-oidc, iss, aud, ES256) avant de servir les flux
// de Gateway ou une liste vide de groupes, et retient qui a appelé.
type Verifier struct {
	streams  *Gateway
	verifier *oidc.IDTokenVerifier
	mu       sync.Mutex
	seen     []Principal
}

type Principal struct{ Path, Subject, Scope, Cookie, Token string }

func Verifying(issuer, jwksURL string) *Verifier {
	keys := oidc.NewRemoteKeySet(context.Background(), jwksURL)
	return &Verifier{streams: New(), verifier: oidc.NewVerifier(issuer, keys,
		&oidc.Config{ClientID: "gateway-admin", SupportedSigningAlgs: []string{oidc.ES256}})}
}

func (v *Verifier) Seen() []Principal {
	v.mu.Lock()
	defer v.mu.Unlock()
	return slices.Clone(v.seen)
}

func (v *Verifier) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	idToken, err := v.verifier.Verify(r.Context(), raw)
	var claims struct{ Scope string `json:"scope"` }
	if err != nil || idToken.Claims(&claims) != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"code":"unauthenticated","message":"jeton refusé"}`))
		return
	}
	v.mu.Lock()
	v.seen = append(v.seen, Principal{Path: r.URL.Path, Subject: idToken.Subject, Scope: claims.Scope,
		Cookie: r.Header.Get("Cookie"), Token: raw})
	v.mu.Unlock()

	if strings.HasPrefix(r.URL.Path, "/admin/stream/") {
		v.streams.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`[]`))
}
```

- [ ] **Step 4 : vérifier que les scénarios sont rouges**

Run : `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock go test -count=1 ./cmd/dashboard/ -run TestScenarios -godog.paths=gateway-token.feature`
(vérifier la forme exacte du filtre par fichier dans `main_test.go:132-161` ; à défaut, lancer
`TestScenarios` entier). Expected : build FAIL (`NewAdminClient` attend trois arguments) — c'est le
rouge de compilation ; la Step 5 le fait passer au rouge de comportement puis au vert.

- [ ] **Step 5 : câbler**

`cmd/dashboard/main.go`, avant `gateway.NewAdminClient` :

```go
keys, err := signingKeys(cfg.Gateway)
if err != nil {
	return err
}
issuer, err := token.NewIssuer(keys, cfg.Gateway.TokenIssuer, time.Now)
if err != nil {
	return err
}
logger.InfoContext(ctx, "émetteur des jetons de l'API Admin",
	"iss", cfg.Gateway.TokenIssuer, "kid_actif", keys.ActiveID(), "kid_publiés", keys.IDs())

admin, err := gateway.NewAdminClient(cfg.Gateway, issuer, logger)
…
streams, err := gateway.NewStreamClient(cfg.Gateway, issuer, logger)
```

et :

```go
// signingKeys ne tombe sur une clé éphémère qu'en mock et sans dossier : en réel, config.Load a déjà
// exigé le dossier et le kid actif.
func signingKeys(cfg config.GatewayConfig) (token.KeySet, error) {
	if cfg.Mode == config.GatewayModeMock && cfg.TokenKeysDir == "" {
		return token.EphemeralKeySet()
	}
	return token.LoadKeySet(cfg.TokenKeysDir, cfg.TokenActiveKID)
}
```

Dans `dialStream`, passer `gateway.WithSystem(ctx)` à `websocket.Dial`. Passer `JWKS:
keys.JWKSHandler()` dans les `bff.Dependencies` (repérer leur construction par
`grep -n 'bff.Dependencies{' cmd/dashboard/*.go`).

`internal/bff/router.go` : ajouter à `Dependencies` le champ commenté
`// JWKS publie les clés publiques qui vérifient les jetons de l'API Admin. Hors de /api : la passerelle le lit sans session.`
`JWKS http.Handler`, et dans `NewRouter`, avant `asset := serveAsset(assets)` :

```go
r.Get("/.well-known/jwks.json", deps.JWKS.ServeHTTP)
```

`internal/bff/guard.go`, dans `requirePermission`, remplacer le `return next(ctx, w, r, request)`
final par :

```go
return next(gateway.WithOperator(ctx, resolved.OperatorID, held), w, r, request)
```

Les tests de `internal/bff` qui construisent `Dependencies` sans `JWKS` : y passer
`http.NotFoundHandler()`.

- [ ] **Step 6 : vérifier**

Run : `go build ./... && DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock go test -count=1 ./cmd/dashboard/ ./internal/... 2>&1 | tail -30`
Expected : les quatre scénarios « reçoit l'identité », « changement de rôle », « flux système »,
« JWKS » passent ; les trois scénarios 401/503/403 restent **rouges** (Task 8). Tout le reste vert :
les scénarios clients existants passent par Prism, qui accepte le jeton signé.

- [ ] **Step 7 : commit**

```bash
git add cmd/dashboard/ internal/bff/ internal/fakegateway/
git commit -m "feat(m3): la garde pose l'opérateur, le hub l'identité système, le JWKS est servi (step-070)"
```

---

### Task 8 : traduire les refus 401 et 403 de la passerelle

**Files :**
- Modify : `internal/bff/router.go` (`reportFailedResponse`), `internal/bff/relay.go`
- Test : `internal/bff/relay_test.go` (ou le fichier de test existant de `relay.go`)

**Interfaces :**
- Consumes : `gateway.APIError`, `gateway.ErrNoCaller`
- Produces : `const codeGatewayRejectedToken = "bff_gateway_rejected_token"`

- [ ] **Step 1 : test unitaire rouge**

```go
func TestAGatewayRefusalOfTheTokenIsNotASessionMatter(t *testing.T) {
	for _, tc := range []struct {
		upstream int
		code     string
		want     int
		wantCode string
	}{
		{http.StatusUnauthorized, "unauthenticated", http.StatusBadGateway, "bff_gateway_rejected_token"},
		{http.StatusForbidden, "forbidden_scope", http.StatusForbidden, "forbidden_scope"},
	} {
		recorder := httptest.NewRecorder()
		reportFailedResponse(slog.New(slog.DiscardHandler))(recorder, httptest.NewRequest(http.MethodGet, "/api/customer-groups", nil),
			fmt.Errorf("relais : %w", gateway.APIError{Status: tc.upstream, Code: tc.code}))
		assert.Equal(t, tc.want, recorder.Code)
		assert.Contains(t, recorder.Body.String(), `"code":"`+tc.wantCode+`"`)
		assert.Empty(t, recorder.Header().Values("Set-Cookie"), "aucune réponse de la passerelle ne touche la session")
	}
}

func TestACallWithoutACallerIsAServerFault(t *testing.T) {
	status, _, relayed := relayError(gateway.ErrNoCaller)
	assert.False(t, relayed)
	assert.Zero(t, status)
}
```

- [ ] **Step 2 : vérifier qu'il échoue**

Run : `go test -count=1 ./internal/bff/ -run 'TokenIsNotASession|WithoutACaller'`
Expected : FAIL — 500 au lieu de 502/403 ; `relayError(ErrNoCaller)` rend 503.

- [ ] **Step 3 : implémenter**

`relay.go`, en tête de `relayError` :

```go
if errors.Is(err, gateway.ErrNoCaller) {
	return 0, Error{}, false
}
```

et remplacer la fin du commentaire de `relayError` par : « `relayed` faux laisse l'appelant rendre
l'erreur : un 401 ou un 403 amont, que `reportFailedResponse` traduit en un seul point, et un appel
parti sans appelant, qui est un défaut du BFF (500). »

`router.go`, en tête de la fonction rendue par `reportFailedResponse` :

```go
var upstream gateway.APIError
if errors.As(err, &upstream) {
	switch upstream.Status {
	case http.StatusUnauthorized:
		writeJSON(w, http.StatusBadGateway, Error{
			Code: "bff_gateway_rejected_token",
			Message: "La passerelle a refusé l'identité du tableau de bord : l'action n'a pas eu lieu. " +
				"L'exploitation est prévenue ; votre session reste ouverte.",
		})
		return
	case http.StatusForbidden:
		logger.WarnContext(r.Context(), "la passerelle refuse un scope que la garde du BFF a laissé passer",
			"route", routeOf(r), "code", upstream.Code)
		writeJSON(w, http.StatusForbidden, Error{
			Code: "forbidden_scope",
			Message: "La passerelle refuse cette action à votre compte : un droit lui manque de son côté. " +
				"Un administrateur peut vérifier les rôles du compte dans « Rôles ».",
		})
		return
	}
}
```

(Le log ERROR du 401 est déjà écrit par le transport, avec le `kid` : pas de second log ici.)

- [ ] **Step 4 : vérifier**

Run : `go test -count=1 ./internal/bff/ && DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock go test -count=1 ./cmd/dashboard/`
Expected : PASS, les sept scénarios de `gateway-token.feature` compris.

- [ ] **Step 5 : commit**

```bash
git add internal/bff/
git commit -m "feat(m3): un refus de jeton par la passerelle est un 502, jamais une session morte (step-070)"
```

---

### Task 9 : aucune clé dans la sortie

**Files :**
- Modify : `cmd/dashboard/gateway-token.feature`, `cmd/dashboard/gateway_token_test.go`

- [ ] **Step 1 : scénario rouge d'abord** — ajouter :

```gherkin
  Scénario: la clé de signature fournie n'apparaît dans aucune sortie
    Étant donné une clé de signature fournie au serveur
    Et un serveur démarré
    Alors la sortie du serveur nomme le kid actif
    Et aucune sortie ne porte la clé de signature
```

Steps :

```go
ctx.Given(`^une clé de signature fournie au serveur$`, w.providedSigningKey)
ctx.Then(`^la sortie du serveur nomme le kid actif$`, w.outputNamesTheActiveKID)
ctx.Then(`^aucune sortie ne porte la clé de signature$`, w.outputHidesTheKey)
```

Ajouter d'abord dans `internal/token/keys.go` l'accès exporté au calcul du `kid` :

```go
// KeyIDOf rend le kid d'une clé publique, tel que le JWKS le publiera.
func KeyIDOf(public *ecdsa.PublicKey) (string, error) { return keyID(public) }
```

Puis le step :

```go
func (w *gatewayTokenWorld) providedSigningKey() error {
	dir, err := os.MkdirTemp("", "token-keys")
	if err != nil {
		return err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return err
	}
	w.pemBody = base64.StdEncoding.EncodeToString(der)
	w.privateScalar = base64.RawURLEncoding.EncodeToString(key.D.Bytes())
	if err := os.WriteFile(filepath.Join(dir, "active.pem"),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0o600); err != nil {
		return err
	}
	kid, err := token.KeyIDOf(&key.PublicKey)
	if err != nil {
		return err
	}
	w.activeKID = kid
	w.process.env["DASHBOARD_TOKEN_KEYS_DIR"] = dir
	w.process.env["DASHBOARD_TOKEN_ACTIVE_KID"] = kid
	return nil
}

func (w *gatewayTokenWorld) outputNamesTheActiveKID() error {
	if !strings.Contains(w.process.output.String(), w.activeKID) {
		return fmt.Errorf("la sortie ne nomme pas le kid actif %s", w.activeKID)
	}
	return nil
}

func (w *gatewayTokenWorld) outputHidesTheKey() error {
	if err := w.process.outputHides(w.pemBody[:48]); err != nil {
		return err
	}
	return w.process.outputHides(w.privateScalar)
}
```

Champs à ajouter au monde : `pemBody, privateScalar, activeKID string`. Le dossier temporaire est
retiré dans le hook `After` du monde (ou `t.Cleanup` si le harnais en expose un — suivre ce que font
les autres mondes qui créent des fichiers).

- [ ] **Step 2 : vérifier rouge puis vert**

Avant d'écrire le log de démarrage (Task 7 Step 5 l'a déjà écrit) : commenter temporairement la ligne
`logger.InfoContext(… "émetteur des jetons …")`, lancer le scénario → rouge sur « nomme le kid
actif » ; la rétablir → vert.

Run : `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock go test -count=1 ./cmd/dashboard/`

- [ ] **Step 3 : commit**

```bash
git add cmd/dashboard/ internal/token/keys.go
git commit -m "test(m3): la clé de signature n'apparaît dans aucune sortie, le kid actif oui (step-070)"
```

---

### Task 10 : runbook, dette 017, tranche réelle

**Files :**
- Create : `docs/runbook.md`
- Delete : `debts/017-les-scopes-cdr-export-bulk-et-msisdn-reveal-sont.md`
- Modify : `tasks/todo.md` (l. 255 si la tranche réelle n'est pas jouée), `tasks/steps/step-070.md`

- [ ] **Step 1 : écrire `docs/runbook.md`**

```markdown
# Runbook — Tableau de bord Admin

Ce document naîtra entier en M9. Il porte pour l'instant ce que step-070 rend nécessaire en
production : la clé qui signe les jetons de l'API Admin.

## Rotation de la clé de signature des jetons

La passerelle vérifie les jetons du tableau de bord contre son JWKS
(`<DASHBOARD_TOKEN_ISSUER>/.well-known/jwks.json`). Elle le relit dès qu'elle voit un `kid`
inconnu. Chaque étape est un déploiement roulant **terminé sur toutes les instances** avant la
suivante : une instance qui signe avec une clé qu'une autre ne publie pas encore fait répondre 401
à la passerelle dès que sa lecture du JWKS tombe sur l'autre.

1. **Publier.** Engendrer la clé :
   `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out nouvelle.pem`
   (PKCS#8, que le binaire exige). L'ajouter au Secret monté sur `DASHBOARD_TOKEN_KEYS_DIR`, sans
   toucher `DASHBOARD_TOKEN_ACTIVE_KID`. Déployer. Le log de démarrage `émetteur des jetons de
   l'API Admin` liste les deux `kid` dans `kid_publiés` ; `curl` du JWKS les montre aussi.
2. **Signer.** Poser `DASHBOARD_TOKEN_ACTIVE_KID` sur le nouveau `kid` (lu dans `kid_publiés`).
   Déployer. Les jetons émis portent désormais ce `kid`.
3. **Retirer**, au moins **5 minutes** après la fin de l'étape 2 (durée de vie d'un jeton) :
   supprimer l'ancien fichier du Secret. Déployer. **Les jetons personnels signés par l'ancienne
   clé cessent de fonctionner à cet instant** ; leurs détenteurs en redemandent un.

**Clé compromise** : enchaîner les trois étapes sans attendre. Les jetons de l'ancienne clé encore
en vol sont refusés en 401 pendant au plus 5 minutes ; le tableau de bord le montre
(`bff_gateway_rejected_token`) sans déconnecter personne.

**Ce qui casse si l'ordre est rompu** : étape 2 avant que l'étape 1 soit partout → 401 intermittents
(`gateway_token_rejected` dans les logs du BFF) ; étape 3 avant 5 minutes → 401 jusqu'à expiration
des jetons de l'ancienne clé.

## Valeurs à remettre à l'exploitant de la passerelle (ConfigMap `gateway-oidc`)

| Clé | Valeur |
|---|---|
| `OIDC_ISSUER` | la valeur **exacte** de `DASHBOARD_TOKEN_ISSUER`, recopiée octet pour octet (slash final compris ou non, à l'identique) |
| `OIDC_AUDIENCE` | `gateway-admin` |
| `OIDC_JWKS_URL` | `<DASHBOARD_TOKEN_ISSUER>/.well-known/jwks.json`, en https, servi par l'ingress interne et jamais par Internet |
| `OIDC_JWKS_CA_FILE` | le certificat de l'autorité interne qui signe le certificat TLS de cet ingress |

Une réponse 503 `service_unavailable` de la passerelle veut dire qu'elle n'a pas pu lire ce JWKS :
vérifier qu'il répond depuis le réseau de la passerelle, avant toute autre piste.
```

- [ ] **Step 2 : supprimer la dette 017**

```bash
git rm debts/017-les-scopes-cdr-export-bulk-et-msisdn-reveal-sont.md
go test -count=1 ./internal/bddtest/
```

Expected : PASS (la porte refuse un dossier vide, il reste 28 dettes). Chercher les renvois à la
dette 017 : `grep -rn 'debts/017\|dette 017' --exclude-dir=node_modules .` et les retirer ou les
réécrire (la step-104 n'a plus à émettre ces scopes).

- [ ] **Step 3 : tenter la tranche verticale réelle, une fois**

Sur le poste, la passerelle démarrée depuis `../go-gateway` (voir son README ; Kafka et ClickHouse
exigés par `admin-api-svc`) avec `OIDC_ISSUER`, `OIDC_AUDIENCE=gateway-admin`, `OIDC_JWKS_URL` pointant
le BFF ; le BFF en mode `real` avec une clé engendrée par la commande du runbook. Ouvrir « Clients »,
créer un client. Consigner dans la fiche, section « Tranche réelle », la date, les commandes, et le
résultat **mesuré** (code HTTP, présence du client côté passerelle, `created_by` = UUID de
l'opérateur).

Si l'infrastructure bloque : écrire la dette `debts/NNN-la-tranche-verticale-n-a-jamais-ete-jouee-contre-la-passerelle.md`
(prochain numéro libre, `ls debts | tail -1`), porteur **la step qui fournira un Compose commun**
ou « sans porteur — <raison mesurée> », et remplacer dans `tasks/todo.md` l. 255
« ← **la tranche verticale est acquise ici** » par « ← tranche verticale contre le mock ; en réel :
voir debts/NNN ».

- [ ] **Step 4 : commit**

```bash
git add docs/runbook.md tasks/ debts/
git commit -m "docs(m3): runbook de rotation et valeurs gateway-oidc ; dette 017 payée (step-070)"
```

---

### Task 11 : mutations, DoD, clôture

**Files :**
- Modify : `tasks/steps/step-070.md` (tableau des mutations, statut), `tasks/todo.md` (case cochée)

- [ ] **Step 1 : jouer les mutations** dans un worktree jetable, après commit, `-count=1`, chaque
  motif vérifié présent une fois avant d'être remplacé :

| Mutation | Où | Test qui doit tomber |
|---|---|---|
| retirer le refus « sans appelant » (`if !ok … return nil, ErrNoCaller`) | `caller.go` | `TestACallWithoutACallerNeverLeaves` |
| `scope` en tableau (`Scope []string`) | `issuer.go` | `TestTheTokenCarriesExactlyTheClaimsTheGatewayChecks` |
| `strings.TrimSuffix(i.issuer, "/")` à la signature | `issuer.go` | `TestTheIssuerIsSignedByteForByte` |
| `reuseMargin = 0` | `issuer.go` | `TestATokenIsReusedUntilSixtySecondsBeforeItsExpiry` |
| `JWK` gagne `D string \`json:"d"\`` rempli par `k.private.D` | `jwks.go` | `TestTheJWKSPublishesOnlyPublicFields`, scénario JWKS |
| `OperatorsManage: ScopeAdminWrite` | `scopes.go` | `TestLocalKeysOpenNothingAtTheGateway`, `TestEveryDefaultRoleOpensExactlyItsGatewayScopes` (Propriétaire inchangé : vérifier lequel tombe et l'écrire) |
| retirer `CDRReadPII` de `gatewayAccess` | `scopes.go` | `TestEveryCatalogKeyHasAGatewayClass` |
| `case http.StatusUnauthorized` du `reportFailedResponse` supprimé | `router.go` | `TestAGatewayRefusalOfTheTokenIsNotASessionMatter`, scénario 401 |
| `outgoing.Header.Del("Cookie")` supprimé | `caller.go` | `TestTheOperatorTokenVerifiesAsTheGatewayVerifiesIt` |
| `WithSystem` retiré de `dialStream` | `main.go` | scénario « flux système » (le flux ne s'ouvre plus : `ErrNoCaller`) |
| `WithOperator` retiré de la garde | `guard.go` | scénario « reçoit l'identité » (500) |

Une mutation verte : mesurer d'abord que le chemin est exercé, puis corriger le test, jamais la
mutation. Consigner le tableau mesuré dans la fiche.

- [ ] **Step 2 : DoD**

```bash
DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock make check; echo "rc=$?"
```

Expected : `rc=0` (ne pas piper vers `tail`, qui masquerait le code). Relire chaque commentaire neuf
contre le code qu'il surplombe (critère 2), et la copie des deux refus contre `reportFailedResponse`.

- [ ] **Step 3 : clôture**

Statut de la fiche → `FAIT` ; `git mv tasks/steps/step-070.md tasks/steps/done/` ; cocher la ligne
step-070 dans `tasks/todo.md`.

```bash
git add -A tasks/
git commit -m "docs(m3): step-070 faite — mutations, DoD, fiche archivée"
```

Puis PR : titre `feat(m3): le BFF émet les jetons de l'API Admin (step-070)` ; la description
consigne l'écart de contrat (7.3.0 installé, 7.6.0 publié, aucun écart d'authentification), les
quatre écarts à la fiche, le résultat de la tranche réelle, et propose l'amendement d'une ligne de
l'ADR-0019 côté `go-gateway` (identité système des flux).

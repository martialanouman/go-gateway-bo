package token

import (
	"encoding/json"
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
	assert.EqualValues(t, 300, int64(payload["exp"].(float64)-payload["iat"].(float64)))
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
	require.ErrorIs(t, err, ErrNoSubject)
	_, err = issuer.Token(operator, nil)
	require.ErrorIs(t, err, ErrNoScope)
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
	assert.NotContains(t, string(served), oldKeys.ActiveID())
}

func TestTwoOperatorsWithTheSameScopesGetTheirOwnToken(t *testing.T) {
	issuer, keys, _ := newTestIssuer(t, "https://dashboard.internal")
	operator1 := "11111111-2222-3333-4444-555555555555"
	operator2 := "99999999-8888-7777-6666-555555555555"

	token1, err := issuer.Token(operator1, []string{"admin:read"})
	require.NoError(t, err)
	token2, err := issuer.Token(operator2, []string{"admin:read"})
	require.NoError(t, err)

	assert.NotEqual(t, token1, token2, "tokens must differ when subject differs")

	_, payload1 := verifyWithServedKeys(t, keys, token1)
	assert.Equal(t, operator1, payload1["sub"])

	_, payload2 := verifyWithServedKeys(t, keys, token2)
	assert.Equal(t, operator2, payload2["sub"])
}

func TestScopeOrderAndDuplicatesShareOneToken(t *testing.T) {
	issuer, keys, _ := newTestIssuer(t, "https://dashboard.internal")

	token1, err := issuer.Token(operator, []string{"admin:write", "admin:read"})
	require.NoError(t, err)

	token2, err := issuer.Token(operator, []string{"admin:read", "admin:write", "admin:read"})
	require.NoError(t, err)

	assert.Equal(t, token1, token2, "same normalized scopes must reuse cache")

	_, payload := verifyWithServedKeys(t, keys, token1)
	scope, isString := payload["scope"].(string)
	require.True(t, isString)
	assert.Equal(t, "admin:read admin:write", scope)
}

func slicesOf(s KeySet) []signingKey { return append([]signingKey(nil), s.all...) }

package token

import (
	"errors"
	"log/slog"
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
	// Round(0) supprime la lecture monotone : l'exp du JWT est le temps mural ; le temps monotone s'arrête en hibernation ou suspension VM.
	now := i.now().Round(0)

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

func (i *Issuer) String() string   { return "Issuer{" + i.issuer + " kid " + i.keyID + "}" }
func (i *Issuer) GoString() string { return i.String() }

func (i *Issuer) LogValue() slog.Value {
	return slog.GroupValue(slog.String("issuer", i.issuer), slog.String("kid", i.keyID))
}

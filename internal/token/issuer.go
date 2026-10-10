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
	Audience         = "gateway-admin"
	lifetime         = 5 * time.Minute
	PersonalLifetime = time.Hour
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
	scope, err := scopeClaim(subject, scopes)
	if err != nil {
		return "", err
	}
	key := subject + "\x00" + scope
	// Round(0) supprime la lecture monotone : l'exp du JWT est le temps mural ; le temps monotone s'arrête en hibernation ou suspension VM.
	now := i.now().Round(0)

	i.mu.Lock()
	defer i.mu.Unlock()
	if hit, ok := i.cache[key]; ok && hit.expiry.Sub(now) > reuseMargin {
		return hit.raw, nil
	}

	expiry := now.Add(lifetime)
	raw, err := i.sign(subject, scope, now, expiry)
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

// Personal signe le jeton qu'un opérateur emporte hors du tableau de bord : jamais mis en cache, il ne
// sert qu'une fois au BFF.
func (i *Issuer) Personal(subject string, scopes []string) (string, time.Time, error) {
	scope, err := scopeClaim(subject, scopes)
	if err != nil {
		return "", time.Time{}, err
	}
	now := i.now().Round(0)
	expiry := now.Add(PersonalLifetime)
	raw, err := i.sign(subject, scope, now, expiry)
	return raw, expiry, err
}

func scopeClaim(subject string, scopes []string) (string, error) {
	if subject == "" {
		return "", ErrNoSubject
	}
	if len(scopes) == 0 {
		return "", ErrNoScope
	}
	return strings.Join(slices.Compact(slices.Sorted(slices.Values(scopes))), " "), nil
}

func (i *Issuer) sign(subject, scope string, now, expiry time.Time) (string, error) {
	return jwt.Signed(i.signer).
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
}

package gateway

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"golang.org/x/oauth2"
)

// tokenTransport pose le jeton machine sur chaque appel, et l'obtient **sous le contexte de
// l'appelant**. `oauth2.Transport` ne le peut pas : `Source.Token()` ne reçoit aucun contexte, et
// `reuseTokenSource` garde son mutex pendant l'appel réseau, si bien qu'un appelant qui renonce
// attendait quand même la fin d'une obtention qui n'était pas la sienne.
//
// La place unique de `slot` sérialise les obtentions — une seule pour N appels qui trouvent le jeton
// expiré — et se prend par `select`, donc s'abandonne avec le contexte.
type tokenTransport struct {
	base  http.RoundTripper
	fetch func(context.Context) (*oauth2.Token, error)
	slot  chan struct{}

	mu    sync.Mutex
	token *oauth2.Token
}

func newTokenTransport(base http.RoundTripper, fetch func(context.Context) (*oauth2.Token, error),
) *tokenTransport {
	return &tokenTransport{base: base, fetch: fetch, slot: make(chan struct{}, 1)}
}

func (t *tokenTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	token, err := t.validToken(req.Context())
	if err != nil {
		if req.Body != nil {
			_ = req.Body.Close()
		}

		return nil, err
	}

	authorized := req.Clone(req.Context())
	token.SetAuthHeader(authorized)

	return t.base.RoundTrip(authorized)
}

func (t *tokenTransport) validToken(ctx context.Context) (*oauth2.Token, error) {
	if token := t.cached(); token.Valid() {
		return token, nil
	}

	select {
	case t.slot <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	defer func() { <-t.slot }()

	// Un autre appelant a pu renouveler le jeton pendant qu'on attendait la place.
	if token := t.cached(); token.Valid() {
		return token, nil
	}

	token, err := t.fetch(ctx)
	if err != nil {
		return nil, fmt.Errorf("obtention du jeton machine : %w", err)
	}

	t.mu.Lock()
	t.token = token
	t.mu.Unlock()

	return token, nil
}

func (t *tokenTransport) cached() *oauth2.Token {
	t.mu.Lock()
	defer t.mu.Unlock()

	return t.token
}

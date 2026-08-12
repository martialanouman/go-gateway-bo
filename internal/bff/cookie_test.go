package bff

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/session"
)

// Ces deux cas montent le **vrai** middleware strict autour d'un handler d'essai. Ce qui est simulé
// est la route, pas le mécanisme : c'est bien `writePendingCookie` qui décide d'écrire ou non.

// Une route qui dépose un cookie puis échoue ouvrirait une session que le client croit refusée : il
// verrait un 500 et repartirait, en portant désormais une session vivante que personne ne fermera.
func TestUnHandlerEnEchecNePoseAucunCookie(t *testing.T) {
	t.Parallel()

	recorder := serveThroughPendingCookie(t, func(ctx context.Context) (any, error) {
		postCookie(ctx, session.Issued("une-valeur"))

		return nil, errors.New("la route a échoué après avoir déposé son cookie")
	})

	assert.Empty(t, recorder.Result().Cookies(), //nolint:bodyclose // httptest.ResponseRecorder
		"un échec a quand même posé le cookie : la session est ouverte et le client la croit refusée")
}

// Le témoin : sans lui, un middleware qui n'écrirait jamais rien passerait le cas ci-dessus.
func TestUnHandlerQuiReussitPoseLeCookieQuIlADepose(t *testing.T) {
	t.Parallel()

	recorder := serveThroughPendingCookie(t, func(ctx context.Context) (any, error) {
		postCookie(ctx, session.Issued("une-valeur"))

		return nil, nil //nolint:nilnil // La route d'essai ne rend aucune réponse, seulement son verdict.
	})

	cookies := recorder.Result().Cookies() //nolint:bodyclose // httptest.ResponseRecorder
	require.Len(t, cookies, 1)
	assert.Equal(t, session.CookieName, cookies[0].Name)
}

func serveThroughPendingCookie(t *testing.T,
	route func(ctx context.Context) (any, error),
) *httptest.ResponseRecorder {
	t.Helper()

	handler := writePendingCookie()(
		func(ctx context.Context, _ http.ResponseWriter, _ *http.Request, _ any) (any, error) {
			return route(ctx)
		}, "route d'essai")

	recorder := httptest.NewRecorder()

	_, err := handler(t.Context(), recorder, httptest.NewRequest(http.MethodGet, "/api/essai", nil), nil)
	_ = err

	return recorder
}

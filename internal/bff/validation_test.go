package bff

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// failingAPI rend 500 sur toute opération atteinte : un 400 prouve donc que le refus est venu avant.
func servedByTheContract(t *testing.T, method, path, body string) (int, Error) {
	t.Helper()

	router := chi.NewRouter()
	router.Route("/api", func(api chi.Router) {
		mountContract(api, failingAPI{}, nil, nil, slog.New(slog.DiscardHandler))
	})

	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, request)

	var refusal Error
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal), rec.Body.String())

	return rec.Code, refusal
}

func refusedFields(refusal Error) []string {
	if refusal.Errors == nil {
		return nil
	}

	fields := make([]string, 0, len(*refusal.Errors))
	for _, placed := range *refusal.Errors {
		fields = append(fields, placed.Field)
	}

	return fields
}

func TestAnEmptyLoginIsRefusedFieldByFieldBeforeTheHandler(t *testing.T) {
	t.Parallel()

	status, refusal := servedByTheContract(t, http.MethodPost, "/api/auth/login", `{}`)

	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "bad_request", refusal.Code)
	assert.ElementsMatch(t, []string{"email", "password"}, refusedFields(refusal))
}

func TestAnUnknownBodyFieldIsRefused(t *testing.T) {
	t.Parallel()

	status, refusal := servedByTheContract(t, http.MethodPost, "/api/auth/login",
		`{"email":"a@exemple.test","password":"secret","admin":true}`)

	assert.Equal(t, http.StatusBadRequest, status)
	assert.Contains(t, refusedFields(refusal), "admin")
}

func TestAStatusOutsideTheContractIsRefusedBeforeTheHandler(t *testing.T) {
	t.Parallel()

	status, refusal := servedByTheContract(t, http.MethodGet, "/api/customer-groups?status=bogus", "")

	assert.Equal(t, http.StatusBadRequest, status)
	require.Equal(t, []string{"status"}, refusedFields(refusal))
	assert.Equal(t, "Cette valeur ne fait pas partie de celles que la route accepte.", (*refusal.Errors)[0].Message)
}

func TestATooLongEmailIsRefusedOnItsField(t *testing.T) {
	t.Parallel()

	status, refusal := servedByTheContract(t, http.MethodPost, "/api/auth/login",
		`{"email":"`+strings.Repeat("a", 321)+`","password":"secret"}`)

	assert.Equal(t, http.StatusBadRequest, status)
	require.Equal(t, []string{"email"}, refusedFields(refusal))
	assert.Equal(t, "Cette valeur dépasse la borne permise.", (*refusal.Errors)[0].Message)
}

func TestAShortChallengeIsRefusedOnItsField(t *testing.T) {
	t.Parallel()

	status, refusal := servedByTheContract(t, http.MethodPost, "/api/auth/mfa/verify",
		`{"challenge":"court","method":"totp","code":"123456"}`)

	assert.Equal(t, http.StatusBadRequest, status)
	require.Equal(t, []string{"challenge"}, refusedFields(refusal))
	assert.Equal(t, "Cette valeur est en deçà de la borne permise.", (*refusal.Errors)[0].Message)
}

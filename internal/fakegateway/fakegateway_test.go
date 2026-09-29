package fakegateway_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/fakegateway"
)

func TestAStreamWithoutBearerIsRefused(t *testing.T) {
	server := httptest.NewServer(fakegateway.New())
	defer server.Close()

	resp, err := http.Get(server.URL + fakegateway.MetricsFeed)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
}

func TestAnArchivedGroupIsListedUnderItsStatusOnly(t *testing.T) {
	mux := http.NewServeMux()
	groups := &fakegateway.Groups{}
	mux.Handle(fakegateway.GroupsPath, groups)
	mux.Handle(fakegateway.GroupsPath+"/{id}", groups)
	server := httptest.NewServer(mux)
	defer server.Close()

	var none []struct{ ID string }
	call(t, http.MethodGet, server.URL+fakegateway.GroupsPath, "", http.StatusOK, &none)
	assert.NotNil(t, none, "une liste vide doit s'encoder [], pas null")

	var created struct{ ID string }
	call(t, http.MethodPost, server.URL+fakegateway.GroupsPath, `{"name":"Revendeurs"}`, http.StatusCreated, &created)
	call(t, http.MethodPatch, server.URL+fakegateway.GroupsPath+"/"+created.ID, `{"status":"archived"}`,
		http.StatusOK, nil)

	var active, archived []struct{ ID string }
	call(t, http.MethodGet, server.URL+fakegateway.GroupsPath+"?status=active", "", http.StatusOK, &active)
	call(t, http.MethodGet, server.URL+fakegateway.GroupsPath+"?status=archived", "", http.StatusOK, &archived)
	assert.Empty(t, active)
	require.Len(t, archived, 1)
	assert.Equal(t, created.ID, archived[0].ID)

	call(t, http.MethodDelete, server.URL+fakegateway.GroupsPath+"/"+created.ID, "", http.StatusNoContent, nil)
	call(t, http.MethodGet, server.URL+fakegateway.GroupsPath+"/"+created.ID, "", http.StatusNotFound, nil)
}

func call(t *testing.T, method, url, body string, status int, into any) {
	t.Helper()

	request, err := http.NewRequestWithContext(t.Context(), method, url, strings.NewReader(body))
	require.NoError(t, err)

	resp, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, status, resp.StatusCode)

	if into != nil {
		require.NoError(t, json.NewDecoder(resp.Body).Decode(into))
	}
}

package fakegateway_test

import (
	"net/http"
	"net/http/httptest"
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

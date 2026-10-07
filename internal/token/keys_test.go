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

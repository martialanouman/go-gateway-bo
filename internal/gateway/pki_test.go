package gateway_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// testPKI monte une autorité de test et le matériel des deux bouts. Il existe pour que le mTLS soit
// **exercé** plutôt que décrit : un serveur qui exige et vérifie un certificat client rend
// falsifiable l'affirmation « le client présente le sien ». Une description, elle, reste vraie même
// quand le code a cessé de l'être.
type testPKI struct {
	caFile         string
	clientCertFile string
	clientKeyFile  string

	serverCertificate tls.Certificate
	authorities       *x509.CertPool
}

func newTestPKI(t *testing.T) testPKI {
	t.Helper()

	authority, authorityKey, authorityPEM := newAuthority(t)

	dir := t.TempDir()

	serverPEM, serverKeyPEM := newLeaf(t, authority, authorityKey, leaf{
		commonName: "passerelle de test",
		usage:      x509.ExtKeyUsageServerAuth,
	})
	clientPEM, clientKeyPEM := newLeaf(t, authority, authorityKey, leaf{
		commonName: "tableau de bord de test",
		usage:      x509.ExtKeyUsageClientAuth,
	})

	serverCertificate, err := tls.X509KeyPair(serverPEM, serverKeyPEM)
	require.NoError(t, err)

	authorities := x509.NewCertPool()
	require.True(t, authorities.AppendCertsFromPEM(authorityPEM))

	return testPKI{
		caFile:            write(t, dir, "ca.pem", authorityPEM),
		clientCertFile:    write(t, dir, "client.pem", clientPEM),
		clientKeyFile:     write(t, dir, "client.key", clientKeyPEM),
		serverCertificate: serverCertificate,
		authorities:       authorities,
	}
}

// serveTLS exige et vérifie le certificat client : sans lui, la poignée de main échoue et le test
// qui l'affirme tombe pour de bon.
func (p testPKI) serveTLS(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()

	server := httptest.NewUnstartedServer(handler)
	server.TLS = &tls.Config{
		Certificates: []tls.Certificate{p.serverCertificate},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    p.authorities,
		MinVersion:   tls.VersionTLS12,
	}
	server.StartTLS()
	t.Cleanup(server.Close)

	return server
}

type leaf struct {
	commonName string
	usage      x509.ExtKeyUsage
}

func newAuthority(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey, []byte) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "autorité de test"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}

	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)

	certificate, err := x509.ParseCertificate(der)
	require.NoError(t, err)

	return certificate, key, encode(t, "CERTIFICATE", der)
}

func newLeaf(
	t *testing.T,
	authority *x509.Certificate,
	authorityKey *ecdsa.PrivateKey,
	of leaf,
) (certificatePEM, keyPEM []byte) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: of.commonName},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{of.usage},
		// httptest écoute sur 127.0.0.1 : sans cette adresse dans le certificat, c'est la vérification
		// du serveur par le client qui échouerait, et le test accuserait le mTLS à sa place.
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
		DNSNames:    []string{"localhost"},
	}

	der, err := x509.CreateCertificate(rand.Reader, template, authority, &key.PublicKey, authorityKey)
	require.NoError(t, err)

	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)

	return encode(t, "CERTIFICATE", der), encode(t, "PRIVATE KEY", pkcs8)
}

func encode(t *testing.T, blockType string, der []byte) []byte {
	t.Helper()

	encoded := pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der})
	require.NotEmpty(t, encoded)

	return encoded
}

func write(t *testing.T, dir, name string, content []byte) string {
	t.Helper()

	path := filepath.Join(dir, name)
	require.NoError(t, os.WriteFile(path, content, 0o600))

	return path
}

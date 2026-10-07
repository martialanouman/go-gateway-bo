// Package token signe les jetons de l'API Admin (ADR-0019 de go-gateway) et publie leurs clés.
package token

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/go-jose/go-jose/v4"
)

type signingKey struct {
	id      string
	private *ecdsa.PrivateKey
}

type KeySet struct {
	active signingKey
	all    []signingKey
}

func (s KeySet) ActiveID() string { return s.active.id }

func (s KeySet) IDs() []string {
	ids := make([]string, 0, len(s.all))
	for _, k := range s.all {
		ids = append(ids, k.id)
	}
	return ids
}

func LoadKeySet(dir, activeID string) (KeySet, error) {
	keys, err := readKeys(dir)
	if err != nil {
		return KeySet{}, err
	}
	for _, k := range keys {
		if k.id == activeID {
			return KeySet{active: k, all: keys}, nil
		}
	}
	ids := make([]string, 0, len(keys))
	for _, k := range keys {
		ids = append(ids, k.id)
	}
	return KeySet{}, fmt.Errorf("kid actif %q absent du dossier, disponibles : %s", activeID, strings.Join(ids, ", "))
}

// EphemeralKeySet sert le mode mock : une clé en mémoire, perdue au redémarrage, qu'aucune passerelle
// réelle ne connaît.
func EphemeralKeySet() (KeySet, error) {
	private, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return KeySet{}, err
	}
	id, err := keyID(&private.PublicKey)
	if err != nil {
		return KeySet{}, err
	}
	k := signingKey{id: id, private: private}
	return KeySet{active: k, all: []signingKey{k}}, nil
}

func readKeys(dir string) ([]signingKey, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("dossier des clés de signature illisible : %w", err)
	}
	var keys []signingKey
	seen := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		key, err := readKey(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		if other, dup := seen[key.id]; dup {
			return nil, fmt.Errorf("%s et %s portent la même clé (kid %s)", other, entry.Name(), key.id)
		}
		seen[key.id] = entry.Name()
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return nil, errors.New("aucune clé de signature dans le dossier")
	}
	slices.SortFunc(keys, func(a, b signingKey) int { return strings.Compare(a.id, b.id) })
	return keys, nil
}

// readKey ne rend jamais le contenu du fichier dans son erreur : un PEM tronqué est encore un secret.
func readKey(path string) (signingKey, error) {
	name := filepath.Base(path)
	raw, err := os.ReadFile(path)
	if err != nil {
		return signingKey{}, fmt.Errorf("%s : clé illisible", name)
	}
	block, _ := pem.Decode(raw)
	if block == nil || block.Type != "PRIVATE KEY" {
		return signingKey{}, fmt.Errorf("%s : PEM PKCS#8 attendu", name)
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return signingKey{}, fmt.Errorf("%s : PEM PKCS#8 attendu", name)
	}
	private, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || private.Curve != elliptic.P256() {
		return signingKey{}, fmt.Errorf("%s : clé EC P-256 attendue", name)
	}
	id, err := keyID(&private.PublicKey)
	if err != nil {
		return signingKey{}, fmt.Errorf("%s : empreinte incalculable", name)
	}
	return signingKey{id: id, private: private}, nil
}

func keyID(public *ecdsa.PublicKey) (string, error) {
	thumbprint, err := (&jose.JSONWebKey{Key: public}).Thumbprint(crypto.SHA256)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(thumbprint), nil
}

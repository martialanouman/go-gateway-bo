package token

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
)

// JWK est un DTO déclaré : la partie privée (`d`) n'y a aucun champ, donc ne peut pas sortir.
type JWK struct {
	Kty string `json:"kty"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

type JWKS struct {
	Keys []JWK `json:"keys"`
}

func (s KeySet) JWKS() JWKS {
	set := JWKS{Keys: make([]JWK, 0, len(s.all))}
	for _, k := range s.all {
		public, err := k.private.PublicKey.ECDH()
		if err != nil {
			continue
		}
		point := public.Bytes() // 0x04 || X (32) || Y (32)
		set.Keys = append(set.Keys, JWK{
			Kty: "EC", Crv: "P-256",
			X:   base64.RawURLEncoding.EncodeToString(point[1:33]),
			Y:   base64.RawURLEncoding.EncodeToString(point[33:65]),
			Kid: k.id, Alg: "ES256", Use: "sig",
		})
	}
	return set
}

func (s KeySet) JWKSHandler() http.Handler {
	body, _ := json.Marshal(s.JWKS())
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	})
}

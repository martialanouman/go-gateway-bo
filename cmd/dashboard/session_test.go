package main

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/session"
)

// sessionCookie retrouve le cookie de session dans la dernière réponse reçue.
//
// Le harnais porte ses cookies à la main plutôt que par un `cookiejar` : un jar refuserait un cookie
// `Secure` servi en clair sur `127.0.0.1`, donc **tous** les scénarios de session échoueraient sur
// une cause qui n'a rien à voir avec le produit. Et le scénario du rejeu après déconnexion a besoin
// de renvoyer un cookie qu'un jar aurait justement supprimé.
func (p *process) sessionCookie() (*http.Cookie, error) {
	if p.received == nil {
		return nil, errors.New("aucune réponse reçue")
	}

	for _, cookie := range (&http.Response{Header: p.received.header}).Cookies() {
		if cookie.Name == session.CookieName {
			return cookie, nil
		}
	}

	return nil, fmt.Errorf("la réponse ne porte aucun cookie %q", session.CookieName)
}

// receivedASessionCookie vérifie les **cinq** attributs, et pas seulement la présence du cookie.
//
// C'est ce qui remplace, ici, ce que le contrat ne peut pas déclarer : un `Set-Cookie` dans le YAML
// deviendrait un en-tête que `openapi-typescript` annonce lisible au client, alors que `HttpOnly` le
// lui interdit. Ce pas exige davantage que ce que `kin-openapi` aurait exigé — la présence.
func (p *process) receivedASessionCookie() error {
	cookie, err := p.sessionCookie()
	if err != nil {
		return err
	}

	if cookie.Value == "" {
		return errors.New("le cookie de session est posé sans valeur : rien ne s'ouvre")
	}

	var missing []string

	if !cookie.HttpOnly {
		missing = append(missing, "HttpOnly (un script de la page lirait la session)")
	}

	if !cookie.Secure {
		missing = append(missing, "Secure (la session voyagerait en clair)")
	}

	if cookie.SameSite != http.SameSiteLaxMode {
		missing = append(missing, "SameSite=Lax (un site tiers ferait écrire l'opérateur)")
	}

	if cookie.Path != "/" {
		missing = append(missing, "Path=/ (le préfixe __Host- l'exige)")
	}

	if cookie.Domain != "" {
		missing = append(missing, "aucun Domain (le cookie s'ouvrirait aux sous-domaines)")
	}

	if len(missing) > 0 {
		return fmt.Errorf("le cookie de session n'a pas les attributs attendus : %v", missing)
	}

	return nil
}

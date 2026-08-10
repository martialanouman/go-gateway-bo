// Package session porte la session du tableau de bord : le sceau du cookie, les deux échéances, et
// les gestes qui les composent avec le stockage.
//
// Il est distinct d'`internal/auth`, qui porte le **premier facteur** — argon2id, les compteurs
// d'échecs, l'adresse source. La direction d'import va d'`auth` vers ici et jamais l'inverse :
// step-023 élèvera la session depuis le chemin d'authentification, et step-025 résoudra une session
// sans avoir aucune raison d'emporter le hachage des mots de passe avec elle.
package session

import (
	"context"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Les deux échéances, et **aucune ne garde ce que garde l'autre**.
//
// AbsoluteLifetime borne ce qu'un cookie volé vaut au maximum : sans elle, une session dont on se
// sert reste vivante indéfiniment, et celle d'un voleur actif avec. Douze heures couvrent un poste et
// son dépassement sans couper un opérateur au milieu d'un incident, et forcent une
// ré-authentification par jour.
//
// IdleWindow ferme le poste qu'on a quitté : sans elle, un cockpit laissé ouvert à midi reste
// exploitable le soir. Deux heures, c'est plus long qu'une réunion et plus court qu'une demi-journée.
//
// Elles sont des constantes et non des variables d'environnement : une durée de session n'est pas un
// réglage de déploiement, et en faire un obligerait à décrire dans `.env.example` un arbitrage qui se
// lit mieux ici, à côté de ce qu'il protège.
const (
	AbsoluteLifetime = 12 * time.Hour
	IdleWindow       = 2 * time.Hour
)

// Manager compose le sceau du cookie et le stockage. C'est le seul type que le reste du serveur
// manipule : rien hors de ce paquet ne voit un jeton ni une empreinte.
type Manager struct {
	sessions *store.Sessions
	secret   []byte
}

func NewManager(sessions *store.Sessions, secret []byte) *Manager {
	return &Manager{sessions: sessions, secret: secret}
}

// Issue ouvre une session de **premier facteur** et rend la valeur à mettre dans le cookie.
//
// Elle n'est pas élevée : c'est step-023 et step-024 qui vérifieront le second facteur. Ce que cette
// session ouvre est ce que step-025 décidera d'ouvrir à une session non élevée.
func (m *Manager) Issue(ctx context.Context, operatorID string) (string, error) {
	value, tokenHash, err := newSealedToken(m.secret)
	if err != nil {
		return "", err
	}

	if _, err = m.sessions.Create(ctx, operatorID, tokenHash, AbsoluteLifetime); err != nil {
		return "", err
	}

	return value, nil
}

// Resolve rend la session vivante que porte ce cookie.
//
// Un sceau qui ne colle pas rend `false` **sans que la base soit interrogée** : le retour anticipé
// d'`Unseal` est ce qui l'assure, et non une intention.
func (m *Manager) Resolve(ctx context.Context, value string) (store.Session, bool, error) {
	tokenHash, ok := Unseal(m.secret, value)
	if !ok {
		return store.Session{}, false, nil
	}

	return m.sessions.Resolve(ctx, tokenHash, IdleWindow)
}

// Elevate marque le second facteur vérifié et rend la **nouvelle** valeur de cookie : l'ancienne ne
// vaut plus rien dès cet instant, contre la fixation de session.
//
// **Aucun appelant en production avant step-023**, qui vérifiera ce second facteur. Ce qui se décide
// ici est la régénération, qui appartient au geste de session et non à celui de la vérification.
func (m *Manager) Elevate(ctx context.Context, value string) (string, bool, error) {
	tokenHash, ok := Unseal(m.secret, value)
	if !ok {
		return "", false, nil
	}

	renewed, renewedHash, err := newSealedToken(m.secret)
	if err != nil {
		return "", false, err
	}

	elevated, err := m.sessions.Elevate(ctx, tokenHash, renewedHash, IdleWindow)
	if err != nil || !elevated {
		return "", false, err
	}

	return renewed, true, nil
}

// Close ferme la session qu'on vient de résoudre. C'est **la** protection du logout : expirer le
// cookie ne suffirait pas, il se rejoue.
func (m *Manager) Close(ctx context.Context, id string) error {
	return m.sessions.Delete(ctx, id)
}

// Grants rend de quoi nommer l'opérateur et l'union des permissions de ses rôles.
func (m *Manager) Grants(ctx context.Context, operatorID string) (store.Grants, error) {
	return m.sessions.GrantsOf(ctx, operatorID)
}

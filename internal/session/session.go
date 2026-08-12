// Package session porte la session du tableau de bord : le sceau du cookie, les deux échéances, et
// les gestes qui les composent avec le stockage.
//
// Il est distinct d'`internal/auth`, qui porte le **premier facteur** — argon2id, les compteurs
// d'échecs, l'adresse source. Aujourd'hui les deux sont **frères** : ni l'un ni l'autre ne s'importe,
// c'est `internal/bff` qui les compose. Ce que la séparation achète dès maintenant est qu'un
// importeur de la session n'emporte pas le hachage des mots de passe — ce dont step-025 profitera —
// et step-023 posera la seule direction possible, d'`auth` vers ici, quand elle élèvera la session
// depuis le chemin d'authentification.
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
const (
	AbsoluteLifetime = 12 * time.Hour
	IdleWindow       = 2 * time.Hour
)

// Manager compose le sceau du cookie et le stockage. Rien hors de ce paquet ne voit un jeton ni une
// empreinte — `internal/bff` manipule bien `store.Session` et `store.Grants`, mais jamais de quoi
// fabriquer ou rejouer un cookie.
type Manager struct {
	sessions *store.Sessions
	secret   []byte
}

func NewManager(sessions *store.Sessions, secret []byte) *Manager {
	return &Manager{sessions: sessions, secret: secret}
}

// Issue ouvre une session de **premier facteur** — non élevée — et rend la valeur à mettre dans le
// cookie. Pourquoi elle naît là plutôt qu'après le second facteur : voir `API.Login`.
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
// Il prend l'identifiant de la session que l'appelant vient de résoudre, et non le cookie présenté.
// Ce que ça achète est écrit sur `store.Sessions.Elevate` — et, accessoirement, que le cookie
// présenté n'existe **nulle part** sur ce chemin : rendre l'ancien laisserait le client sur un jeton
// que la base ne connaît plus, donc déconnecté à la requête suivante, et rouvrirait à l'identique la
// fixation de session que la régénération doit fermer. Le compilateur le tient seul, sans test.
func (m *Manager) Elevate(ctx context.Context, sessionID string) (string, bool, error) {
	renewed, renewedHash, err := newSealedToken(m.secret)
	if err != nil {
		return "", false, err
	}

	elevated, err := m.sessions.Elevate(ctx, sessionID, renewedHash, IdleWindow)
	if err != nil || !elevated {
		return "", false, err
	}

	return renewed, true, nil
}

// Close ferme la session qu'on vient de résoudre.
func (m *Manager) Close(ctx context.Context, id string) error {
	return m.sessions.Delete(ctx, id)
}

// Grants rend de quoi nommer l'opérateur et l'union des permissions de ses rôles.
func (m *Manager) Grants(ctx context.Context, operatorID string) (store.Grants, error) {
	return m.sessions.GrantsOf(ctx, operatorID)
}

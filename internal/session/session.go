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
//
// Elles sont des constantes et non des variables d'environnement : une durée de session n'est pas un
// réglage de déploiement, et en faire un obligerait à décrire dans `.env.example` un arbitrage qui se
// lit mieux ici, à côté de ce qu'il protège.
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
func (m *Manager) Elevate(ctx context.Context, presented string) (string, bool, error) {
	tokenHash, ok := Unseal(m.secret, presented)
	if !ok {
		return "", false, nil
	}

	return m.rotate(ctx, tokenHash)
}

// rotate existe pour que le cookie **présenté** soit hors de portée au moment où l'on rend le
// nouveau. Rendre l'ancien laisserait le client sur un jeton que la base ne connaît plus — il serait
// déconnecté à la requête suivante, et la fixation de session que la régénération doit fermer se
// rouvrirait à l'identique.
//
// C'est une garde par construction plutôt qu'un test, et c'est délibéré : la prouver par un test
// demanderait un PostgreSQL dans ce paquet, pour une propriété que le compilateur tient seul —
// `presented` n'existe pas ici, donc `return presented` ne compile pas.
func (m *Manager) rotate(ctx context.Context, tokenHash []byte) (string, bool, error) {
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

package mfa

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// MaxChallengeFailures borne les essais qu'un même challenge encaisse.
//
// Cinq, comme le seuil du premier facteur, et le calcul est le même à l'échelle près : le verrou de
// connexion laisse cinq tentatives par quart d'heure, donc cinq challenges, donc vingt-cinq essais —
// sur un espace de 10⁶ codes dont trois sont valables à la fois. Sans cette borne, les cinq minutes
// de vie d'un challenge suffiraient à en essayer des dizaines de milliers.
//
// Elle borne aussi le **coût** du chemin de récupération, où chaque essai paie dix argon2id, soit
// environ 260 ms et 64 MiB au serveur.
const MaxChallengeFailures = 5

// Manager compose l'authentificateur et le stockage, comme `session.Manager` compose le sceau du
// cookie et sa table. Rien hors de ce paquet ne voit un secret déchiffré ni un code en clair — sauf
// l'enrôlement, dont c'est précisément l'objet, et une seule fois.
type Manager struct {
	authenticator *Authenticator
	factors       *store.MFA
}

func NewManager(factors *store.MFA, passphrase []byte) (*Manager, error) {
	authenticator, err := NewAuthenticator(passphrase)
	if err != nil {
		return nil, err
	}

	return &Manager{authenticator: authenticator, factors: factors}, nil
}

// State rend ce qu'un opérateur détient et le pas de temps courant.
func (m *Manager) State(ctx context.Context, operatorID string) (store.TOTPState, bool, error) {
	return m.factors.TOTPStateOf(ctx, operatorID, PeriodSeconds)
}

// Factors rend ce que `GET /auth/me` annonce : un booléen et un compte.
func (m *Manager) Factors(ctx context.Context, operatorID string) (store.SecondFactors, error) {
	return m.factors.FactorsOf(ctx, operatorID)
}

// Enroll tire un authentificateur, l'écrit, et rend ce qui n'est montré qu'une fois.
func (m *Manager) Enroll(ctx context.Context, operatorID, accountName string) (Enrollment, error) {
	enrollment, err := m.authenticator.Enroll(operatorID, accountName)
	if err != nil {
		return Enrollment{}, err
	}

	err = m.factors.Enroll(ctx, operatorID, enrollment.SealedSecret, enrollment.RecoveryCodeHashes)
	if err != nil {
		return Enrollment{}, err
	}

	return enrollment, nil
}

// VerifyTOTP confronte un code à la fenêtre de dérive **puis** consomme le pas qui l'a validé.
//
// Les deux gestes ne sont pas séparables et l'ordre compte : un code valide dont le pas a déjà servi
// est un rejeu, donc un refus. C'est `ConsumeStep` qui tranche, dans son `WHERE`, et non une lecture
// suivie d'une décision.
func (m *Manager) VerifyTOTP(ctx context.Context, operatorID, code string) (bool, error) {
	state, found, err := m.State(ctx, operatorID)
	if err != nil || !found || !state.Enrolled {
		return false, err
	}

	step, ok, err := m.authenticator.Verify(state.SealedSecret, operatorID, code, state.CurrentStep)
	if err != nil || !ok {
		return false, err
	}

	return m.factors.ConsumeStep(ctx, operatorID, step)
}

// VerifyRecoveryCode confronte le code aux dix hachages **puis** détruit celui qui a servi.
//
// La suppression est le point de sérialisation : deux requêtes concurrentes portant le même code n'en
// voient qu'une réussir.
func (m *Manager) VerifyRecoveryCode(ctx context.Context, operatorID, presented string) (bool, error) {
	codes, err := m.factors.RecoveryCodesOf(ctx, operatorID)
	if err != nil {
		return false, err
	}

	hashes := make([]string, len(codes))
	for index, code := range codes {
		hashes[index] = code.Hash
	}

	matched := MatchRecoveryCode(hashes, presented)
	if matched < 0 {
		return false, nil
	}

	return m.factors.ConsumeRecoveryCode(ctx, codes[matched].ID)
}

// Challenge rend le challenge que porte cette valeur, s'il vit encore.
//
// Une valeur qui n'a pas la forme d'un challenge émis ici rend `false` **sans que la base soit
// interrogée** : le retour anticipé d'`auth.ChallengeDigest` est ce qui l'assure, comme le sceau du
// cookie pour la session.
func (m *Manager) Challenge(ctx context.Context, presented string) (store.PendingChallenge, bool,
	error,
) {
	digest, ok := auth.ChallengeDigest(presented)
	if !ok {
		return store.PendingChallenge{}, false, nil
	}

	return m.factors.LiveChallenge(ctx, digest, MaxChallengeFailures)
}

// FailChallenge compte un essai raté. Le challenge survit jusqu'au seuil : un opérateur qui s'est
// trompé quatre fois doit encore pouvoir entrer, sinon la garde refuserait du légitime et finirait
// retirée.
func (m *Manager) FailChallenge(ctx context.Context, id string) error {
	return m.factors.RecordChallengeFailure(ctx, id)
}

// ConsumeChallenge le marque servi, et une seule fois.
func (m *Manager) ConsumeChallenge(ctx context.Context, id string) (bool, error) {
	return m.factors.ConsumeChallenge(ctx, id)
}

package mfa

import (
	"context"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// MaxFailures et LockWindow bornent les essais de second facteur d'un opérateur, **toutes connexions
// confondues**. C'est la seule chose qui rende la recherche exhaustive d'un code à six chiffres
// infaisable, et elle a manqué : le compteur du premier facteur ne borne rien ici, puisque
// `RecordFailure` n'est appelé que sur le chemin d'échec de `auth.Login` et que le chemin de succès
// appelle `ClearFailures`. Une connexion réussie n'incrémente donc aucun compteur, et qui détient le
// mot de passe émet autant de challenges qu'il veut. L'arithmétique est dans la migration 00007.
//
// Les mêmes valeurs qu'au premier facteur, et pour les mêmes raisons : cinq parce qu'un opérateur qui
// hésite entre deux téléphones ou tape à côté en consomme trois sans être un attaquant ; un quart
// d'heure qui est **à la fois** la durée du verrou et la fenêtre d'oubli, sans quoi un verrou qui
// vient d'expirer se refermerait au premier essai suivant.
//
// Ce qu'elles achètent, **recalculé en step-025 et corrigé** : cinq essais par quart d'heure, sur 10⁶
// codes dont trois sont valables à la fois, donc 231 000 essais pour une chance sur deux et
// 175 200 essais par an — de l'ordre de **seize mois**, pour un attaquant qui détient déjà le mot de
// passe et s'acharne sans interruption.
//
// La rédaction précédente disait « quatre-vingts ans ». Le chiffre était faux d'un facteur soixante,
// et personne ne l'avait refait : il vivait ici et dans `done/step-023.md`, à côté de ses propres
// prémisses, qui suffisent à le contredire. Seize mois n'est pas « infaisable » — c'est cher, et
// c'est la raison pour laquelle l'enrôlement a cessé d'ouvrir un second seau (step-025).
const (
	MaxFailures = 5
	LockWindow  = 15 * time.Minute
)

// MaxEnrollments borne les **appels** à `POST /auth/mfa/totp/enroll`, réussis compris. Le compteur
// d'échecs ci-dessus ne voit rien de cette route : elle réussit, et une session de premier facteur
// suffit à la répéter.
//
// Ce qu'elle coûte au serveur est mesuré (step-023) : dix argon2id par appel, soit dix fois le
// processeur d'une connexion. Cinq par quart d'heure laisse largement l'usage réel — enrôler deux
// fois de suite est déjà inhabituel — et la même fenêtre que partout ailleurs, pour la raison qui
// l'a fait choisir : un verrou qui vient d'expirer se refermerait au premier appel suivant si la
// fenêtre d'oubli était plus courte que lui.
const MaxEnrollments = 5

// Manager compose l'authentificateur et le stockage, comme `session.Manager` compose le sceau du
// cookie et sa table. Rien hors de ce paquet ne voit un secret déchiffré ni un code en clair — sauf
// l'enrôlement, dont c'est précisément l'objet, et une seule fois.
type Manager struct {
	authenticator *Authenticator
	factors       *store.MFA
	// enrollments borne les appels à l'enrôlement. Il est distinct du compteur d'échecs porté par
	// `factors` : celui-ci compte des refus de second facteur, celui-là des appels qui réussissent.
	enrollments *store.Counter
}

func NewManager(factors *store.MFA, enrollments *store.Counter, passphrase []byte,
	issuer string,
) (*Manager, error) {
	authenticator, err := NewAuthenticator(passphrase, issuer)
	if err != nil {
		return nil, err
	}

	return &Manager{authenticator: authenticator, factors: factors, enrollments: enrollments}, nil
}

// AdmitEnrollment consulte le verrou d'enrôlement puis compte l'appel. Un verrou non nul veut dire
// « refusé ».
func (m *Manager) AdmitEnrollment(ctx context.Context, operatorID string) (store.Lock, error) {
	return m.enrollments.Admit(ctx, operatorID, LockWindow, MaxEnrollments)
}

// State rend ce qu'un opérateur détient et le pas de temps courant.
func (m *Manager) State(ctx context.Context, operatorID string) (store.TOTPState, bool, error) {
	return m.factors.TOTPStateOf(ctx, operatorID, PeriodSeconds)
}

// Factors rend ce que `GET /auth/me` annonce : un booléen et un compte.
func (m *Manager) Factors(ctx context.Context, operatorID string) (store.SecondFactors, error) {
	return m.factors.FactorsOf(ctx, operatorID)
}

// Enroll tire un authentificateur, l'écrit, et rend ce qui n'est montré qu'une fois. `false` dit
// qu'un second facteur était déjà en place et que `replace` ne l'autorisait pas — la garde est
// appliquée par l'écriture elle-même, voir `store.MFA.Enroll`.
func (m *Manager) Enroll(ctx context.Context, operatorID, accountName string, replace bool) (Enrollment,
	bool, error,
) {
	enrollment, err := m.authenticator.Enroll(operatorID, accountName)
	if err != nil {
		return Enrollment{}, false, err
	}

	written, err := m.factors.Enroll(ctx, operatorID, enrollment.SealedSecret,
		enrollment.RecoveryCodeHashes, replace)
	if err != nil || !written {
		return Enrollment{}, false, err
	}

	return enrollment, true, nil
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

// VerifyRecoveryCode confronte le code aux hachages restants **puis** détruit celui qui a servi.
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

	return m.factors.LiveChallenge(ctx, digest)
}

// ConsumeChallenge le marque servi, et une seule fois.
func (m *Manager) ConsumeChallenge(ctx context.Context, id string) (bool, error) {
	return m.factors.ConsumeChallenge(ctx, id)
}

// Lock rend le verrou d'essais qui pèse sur cet opérateur. L'appelant le consulte **avant** toute
// dépense : sinon le verrou protégerait le compte sans protéger le serveur.
func (m *Manager) Lock(ctx context.Context, operatorID string) (store.Lock, error) {
	return m.factors.LockFor(ctx, operatorID, LockWindow, MaxFailures)
}

// Fail compte un essai raté et rend le verrou qui en résulte. Il annonce le verrou **à l'échec qui le
// franchit**, plutôt que de rendre un refus nu et de surprendre à l'essai suivant : la charte exige
// qu'un contrôle qui refuse dise jusqu'à quand.
func (m *Manager) Fail(ctx context.Context, operatorID string) (store.Lock, error) {
	return m.factors.RecordFailure(ctx, operatorID, LockWindow, MaxFailures)
}

// Succeed efface le compteur d'un opérateur qui vient de franchir son second facteur.
func (m *Manager) Succeed(ctx context.Context, operatorID string) error {
	return m.factors.ClearFailures(ctx, operatorID)
}

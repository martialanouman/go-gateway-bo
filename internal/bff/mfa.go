package bff

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/session"
)

// maximumCodeLength redit en Go la borne que le contrat déclare, pour la même raison que celles de
// `Login` : rien dans ce dépôt ne valide une requête à l'exécution contre le YAML. Elle n'est pas
// cosmétique — le chemin des codes de récupération paie un argon2id par code restant, donc un champ
// sans borne en
// ferait une arme.
const maximumCodeLength = 64

// EnrollTotp enrôle une application d'authentification et rend, **une seule fois**, de quoi la
// configurer.
//
// Il n'élève pas la session : c'est `VerifyMfa` qui le fait, avec le premier code. Un enrôlement qui
// élèverait ferait du second facteur une formalité — il suffirait de s'en attacher un neuf.
func (a API) EnrollTotp(ctx context.Context, _ EnrollTotpRequestObject) (EnrollTotpResponseObject,
	error,
) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return EnrollTotp401JSONResponse(notAuthenticated()), nil
	}

	state, found, err := a.SecondFactor.State(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if !found {
		return EnrollTotp401JSONResponse(notAuthenticated()), nil
	}

	// **La garde de la step.** Le premier enrôlement est libre — il faut bien pouvoir entrer une
	// première fois. Le remplacer exige d'avoir franchi celui qui est en place, sans quoi quiconque
	// détient le mot de passe contourne le second facteur en s'en attachant un autre.
	//
	// Ce `if` est un raccourci de **coût**, pas la garde : il évite le quart de seconde de hachage
	// quand le refus est déjà certain. La garde, elle, est appliquée par l'écriture — sans quoi deux
	// enrôlements concurrents la traverseraient tous les deux.
	if state.Enrolled && !resolved.Elevated {
		return EnrollTotp409JSONResponse(secondFactorAlreadyEnrolled()), nil
	}

	enrollment, written, err := a.SecondFactor.Enroll(ctx, resolved.OperatorID, state.Email,
		resolved.Elevated)
	if err != nil {
		return nil, err
	}

	if !written {
		return EnrollTotp409JSONResponse(secondFactorAlreadyEnrolled()), nil
	}

	// Le DTO se compose champ par champ. `Enrollment` porte aussi le secret **chiffré** et les
	// hachages des codes ; les oublier ici n'est pas une vigilance, c'est qu'ils ne sont pas nommés.
	return EnrollTotp200JSONResponse{
		Secret:        enrollment.Secret,
		OtpauthUri:    enrollment.OtpauthURI,
		RecoveryCodes: enrollment.RecoveryCodes,
	}, nil
}

// VerifyMfa vérifie le second facteur et élève la session.
//
// **L'ordre des gestes est la garde**, et chacun a sa raison d'être là :
//
//  1. la session vivante, qui dit de qui il s'agit ;
//  2. le challenge vivant **et le sien** — sans cette seconde moitié, le challenge d'un opérateur
//     élèverait la session d'un autre ;
//  3. le code, dont la vérification consomme déjà ce qu'elle valide — le pas de temps ou la ligne du
//     code de récupération, dans les deux cas par un `WHERE` qui tranche le rejeu ;
//  4. l'échec compté, qui borne la recherche exhaustive ;
//  5. le challenge consommé, une seule fois ;
//  6. la session élevée, jeton régénéré.
//
// Les cinq refus rendent le **même** 401 : un code faux, un code rejoué, un challenge inconnu, échu
// ou épuisé, et l'absence de session. Les distinguer dirait à une machine où elle en est.
func (a API) VerifyMfa(ctx context.Context, request VerifyMfaRequestObject) (VerifyMfaResponseObject,
	error,
) {
	if request.Body == nil || len([]rune(request.Body.Code)) > maximumCodeLength ||
		!request.Body.Method.Valid() {
		return VerifyMfa400JSONResponse(badRequest()), nil
	}

	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
	}

	challenge, live, err := a.SecondFactor.Challenge(ctx, request.Body.Challenge)
	if err != nil {
		return nil, err
	}

	if !live || challenge.OperatorID != resolved.OperatorID {
		return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
	}

	verified, err := a.verifyPresentedFactor(ctx, resolved.OperatorID, *request.Body)
	if err != nil {
		return nil, err
	}

	if !verified {
		// L'échec est compté **avant** de refuser, et le challenge n'est pas consommé : une faute de
		// frappe ne doit pas obliger à refaire toute la connexion, mais elle doit coûter un essai.
		if err = a.SecondFactor.FailChallenge(ctx, challenge.ID); err != nil {
			return nil, err
		}

		return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
	}

	consumed, err := a.SecondFactor.ConsumeChallenge(ctx, challenge.ID)
	if err != nil {
		return nil, err
	}

	if !consumed {
		// Course perdue : une autre requête a servi ce challenge entre la lecture et ici. Le code, lui,
		// vient d'être consommé — c'est le prix de ne pas tenir les deux dans une transaction, et il est
		// payé par celui qui a envoyé deux fois.
		return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
	}

	renewed, elevated, err := a.Sessions.Elevate(ctx, resolved.ID)
	if err != nil {
		return nil, err
	}

	if !elevated {
		// La session est morte entre sa résolution et ici — fermée par un logout concurrent, ou son
		// opérateur désactivé.
		return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
	}

	postCookie(ctx, session.Issued(renewed))

	return VerifyMfa204Response{}, nil
}

// verifyPresentedFactor aiguille sur la méthode déclarée plutôt que d'essayer les deux.
//
// Essayer les deux ferait payer les argon2id du chemin de récupération à chaque code TOTP faux,
// et la durée de la réponse dirait alors laquelle des deux voies a répondu.
func (a API) verifyPresentedFactor(ctx context.Context, operatorID string,
	verification MfaVerification,
) (bool, error) {
	if verification.Method == MfaVerificationMethodRecoveryCode {
		return a.SecondFactor.VerifyRecoveryCode(ctx, operatorID, verification.Code)
	}

	return a.SecondFactor.VerifyTOTP(ctx, operatorID, verification.Code)
}

// refusedSecondFactor est le refus **unique** du second facteur, comme `refusedCredentials` l'est du
// premier : un seul constructeur, donc pas deux messages entre lesquels choisir.
//
// La copie dit la conséquence d'abord et les deux gestes qui peuvent débloquer, sans nommer laquelle
// des cinq causes s'applique — un challenge épuisé et un chiffre de travers lisent la même phrase.
func refusedSecondFactor() Error {
	return Error{
		Code: "invalid_second_factor",
		Message: "Ce code n'a pas été accepté. Vérifiez l'heure de votre application " +
			"d'authentification, ou reprenez la connexion depuis le début.",
	}
}

// secondFactorAlreadyEnrolled dit ce que le refus couvre **et** où s'arrête l'accès : la charte
// interdit un contrôle qui refuse sans expliquer par où passer.
func secondFactorAlreadyEnrolled() Error {
	return Error{
		Code: "mfa_already_enrolled",
		Message: "Un second facteur est déjà en place sur ce compte. Pour le remplacer, franchissez " +
			"d'abord celui que vous utilisez aujourd'hui ; s'il est perdu, un administrateur doit le " +
			"réinitialiser.",
	}
}

// secondFactorsOf compose ce que `GET /auth/me` annonce du second facteur : un booléen et un compte,
// jamais un secret ni un code.
func secondFactorsOf(ctx context.Context, factors *mfa.Manager, operatorID string) (SecondFactors,
	error,
) {
	held, err := factors.Factors(ctx, operatorID)
	if err != nil {
		return SecondFactors{}, err
	}

	return SecondFactors{
		Totp:                   held.TOTPEnrolled,
		RecoveryCodesRemaining: held.RecoveryCodesRemaining,
	}, nil
}

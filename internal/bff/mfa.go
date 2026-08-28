package bff

import (
	"context"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/session"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// maximumChallengeLength borne ce qu'un corps peut présenter comme challenge. Le contrat n'en déclare
// que la longueur minimale, et `auth.ChallengeDigest` refuse déjà tout ce qui ne fait pas exactement
// trente-deux octets décodés — cette borne-ci refuse simplement plus tôt, avant le décodage.
const maximumChallengeLength = 64

// maximumCodeLength redit en Go la borne que le contrat déclare, pour la même raison que celles de
// `Login` : rien dans ce dépôt ne valide une requête à l'exécution contre le YAML.
//
// Ce qu'elle achète est un refus **tôt**, pas une économie de calcul : argon2id ne dépend pas de la
// longueur de son entrée, donc un code de soixante-quatre caractères et un code de six coûtent
// exactement le même quart de seconde. Le corps entier est par ailleurs déjà borné à huit kibioctets
// par `RequestSize`.
const maximumCodeLength = 64

// EnrollTotp enrôle une application d'authentification et rend, **une seule fois**, de quoi la
// configurer.
//
// Il n'élève pas la session : c'est `VerifyMfa` qui le fait, avec le premier code. Un enrôlement qui
// élèverait ferait du second facteur une formalité — il suffirait de s'en attacher un neuf.
func (a API) EnrollTotp(ctx context.Context, request EnrollTotpRequestObject) (EnrollTotpResponseObject,
	error,
) {
	if request.Body == nil || !presentedFactorIsWellFormed(*request.Body) {
		return EnrollTotp400JSONResponse(badRequest()), nil
	}

	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return EnrollTotp401JSONResponse(notAuthenticated()), nil
	}

	// **Avant toute dépense**, et avant même de lire l'état du facteur : cette route hache dix
	// argon2id par appel, et jusqu'ici une session de premier facteur suffisait à la répéter sans
	// qu'aucun compteur la voie — elle réussit, et les compteurs d'échecs ne comptent que les refus.
	// Compté ici et non au succès : le travail est fait dès qu'on entre, et un client qui coupe la
	// connexion pendant les dix hachages les a fait payer quand même. Un refus en aval — 401 sur une
	// session survivante, 409 sur un remplacement sans preuve — a lui aussi coûté, jusqu'aux argon2id
	// du code présenté.
	enrollments, err := a.SecondFactor.AdmitEnrollment(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if enrollments.Locked() {
		return tooManyEnrollments(enrollments.Remaining), nil
	}

	state, found, err := a.SecondFactor.State(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if !found {
		return EnrollTotp401JSONResponse(notAuthenticated()), nil
	}

	// **La garde de la step.** Le premier enrôlement est libre — il faut bien pouvoir entrer une
	// première fois, et il n'y a rien à prouver. Le remplacement, lui, **détruit** l'authentificateur
	// en place et ses dix codes de récupération : il exige donc de présenter ce qu'on détruit.
	//
	// Une preuve du mot de passe n'y suffirait pas — un cookie de session élevée capté évincerait
	// définitivement l'opérateur. Et un challenge frais serait **inatteignable** : se reconnecter pour
	// en obtenir un ferme la session présentée et la désélève. La raison longue est au contrat.
	//
	// Ce `if` est un raccourci de **coût** pour le cas sans preuve : il évite le quart de seconde de
	// hachage quand le refus est déjà certain. La garde du remplacement, elle, est appliquée par
	// l'écriture — sans quoi deux enrôlements concurrents la traverseraient tous les deux.
	// **Un facteur qui n'est pas un TOTP ne peut pas être présenté ici** : le corps de cette route ne
	// déclare que `totp` et `recovery_code`, et l'y ajouter reviendrait à faire passer une assertion
	// WebAuthn par un champ `code`. C'est donc l'élévation qui tient lieu de preuve — la même garde
	// que `POST /auth/mfa/webauthn/register/begin`, pour la même raison.
	//
	// Sans elle, un opérateur qui ne détient qu'une passkey se faisait enrôler une application
	// d'authentification par quiconque détenait son mot de passe : l'enrôlement rendait le secret et
	// dix codes de récupération, et la vérification élevait la session sans que la clé ait jamais été
	// présentée. Trouvé en revue, et le scénario qui le garde a d'abord rendu 200.
	held, err := a.SecondFactor.Factors(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if !state.Enrolled && held.Passkeys > 0 && !resolved.Elevated {
		return EnrollTotp409JSONResponse(elevationRequiredToAddAFactor()), nil
	}

	replace := false

	if state.Enrolled {
		if request.Body.Code == nil {
			return EnrollTotp409JSONResponse(secondFactorAlreadyEnrolled()), nil
		}

		replace, err = a.verifyPresentedFactor(ctx, resolved.OperatorID, string(*request.Body.Method),
			*request.Body.Code)
		if err != nil {
			return nil, err
		}

		if !replace {
			return EnrollTotp409JSONResponse(secondFactorAlreadyEnrolled()), nil
		}
	}

	enrollment, written, err := a.SecondFactor.Enroll(ctx, resolved.OperatorID, state.Email, replace)
	if err != nil {
		return nil, err
	}

	if !written {
		return EnrollTotp409JSONResponse(secondFactorAlreadyEnrolled()), nil
	}

	// Le DTO se compose champ par champ. `Enrollment` porte aussi le secret **chiffré** et les
	// hachages des codes ; les oublier ici n'est pas une vigilance, c'est qu'ils ne sont pas nommés.
	// L'état d'après ne porte que ce qu'une enquête doit savoir : un facteur a été posé, et il a
	// remplacé ou non celui d'avant. Ni le secret, ni les codes — `Fields` n'a d'ailleurs pas de
	// méthode pour les y mettre.
	if err = a.audited(ctx, store.Event{
		OperatorID: resolved.OperatorID,
		Action:     actionMFAEnroll,
		TargetType: auditTargetOperator,
		TargetID:   resolved.OperatorID,
		After:      store.NewFields().Text("method", "totp").Flag("replaced", replace),
	}); err != nil {
		return nil, err
	}

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
//  2. **le verrou d'essais de l'opérateur, avant toute dépense** — c'est ce qui borne la recherche
//     exhaustive, et le consulter après aurait fait payer au serveur le déchiffrement et les argon2id
//     de chaque essai qu'il refuse ;
//  3. le challenge vivant **et le sien** — sans cette seconde moitié, le challenge d'un opérateur
//     élèverait la session d'un autre ;
//  4. le code, dont la vérification consomme déjà ce qu'elle valide — le pas de temps ou la ligne du
//     code de récupération, dans les deux cas par un `WHERE` qui tranche le rejeu ;
//  5. l'échec compté sur l'opérateur, ce qui borne ce que toutes ses connexions peuvent servir ;
//  6. le challenge consommé, une seule fois ;
//  7. la session élevée, jeton régénéré, et le compteur effacé.
//
// **Tous les refus rendent le même 401**, sauf le verrou : un code faux ou déjà servi, un challenge
// inconnu, échu, consommé ou appartenant à un autre, l'absence de session et sa mort en cours
// de route sont indiscernables. Le verrou, lui, rend 429 avec sa durée — ce qu'il révèle est ce que
// l'attaquant constate de toute façon, et le taire priverait l'opérateur légitime de la seule
// information qui lui dise quoi faire.
func (a API) VerifyMfa(ctx context.Context, request VerifyMfaRequestObject) (VerifyMfaResponseObject,
	error,
) {
	if request.Body == nil || !presentedSecondFactorIsWellFormed(*request.Body) {
		return VerifyMfa400JSONResponse(badRequest()), nil
	}

	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
	}

	lock, err := a.SecondFactor.Lock(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if lock.Locked() {
		return tooManySecondFactorAttempts(lock.Remaining), nil
	}

	challenge, live, err := a.SecondFactor.Challenge(ctx, request.Body.Challenge)
	if err != nil {
		return nil, err
	}

	if !live || challenge.OperatorID != resolved.OperatorID {
		return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
	}

	verified, err := a.verifySecondFactor(ctx, resolved, *request.Body)
	if err != nil {
		return nil, err
	}

	if !verified {
		return a.refuseSecondFactor(ctx, resolved.OperatorID)
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

	if err = a.SecondFactor.Succeed(ctx, resolved.OperatorID); err != nil {
		return nil, err
	}

	postCookie(ctx, session.Issued(renewed))

	if err = a.audited(ctx, store.Event{
		OperatorID: resolved.OperatorID,
		Action:     actionMFAVerify,
		TargetType: auditTargetOperator,
		TargetID:   resolved.OperatorID,
		After:      store.NewFields().Text("method", string(request.Body.Method)),
	}); err != nil {
		return nil, err
	}

	return VerifyMfa204Response{}, nil
}

// refuseSecondFactor compte l'essai raté et refuse.
//
// Le challenge n'est **pas** consommé : une faute de frappe ne doit pas obliger à refaire toute la
// connexion. Elle coûte en revanche un essai à l'opérateur, et c'est ce qui borne la recherche
// exhaustive.
//
// **Il n'y a qu'un compteur, et c'est délibéré.** Une première rédaction en portait deux — un par
// challenge, un par opérateur — au même seuil de cinq. Celui de l'opérateur compte à travers toutes
// les connexions, donc il mord toujours le premier : celui du challenge n'était plus observable, ni
// par un test ni par une mutation. Deux gardes dont l'une masque l'autre valent une garde et une
// illusion.
//
// L'échec qui **franchit** le seuil annonce le verrou tout de suite, plutôt que de rendre un refus nu
// et de surprendre à l'essai suivant : la charte exige qu'un contrôle qui refuse dise jusqu'à quand.
// Même forme qu'au premier facteur.
func (a API) refuseSecondFactor(ctx context.Context, operatorID string) (VerifyMfaResponseObject,
	error,
) {
	lock, err := a.SecondFactor.Fail(ctx, operatorID)
	if err != nil {
		return nil, err
	}

	if lock.Locked() {
		return tooManySecondFactorAttempts(lock.Remaining), nil
	}

	return VerifyMfa401JSONResponse(refusedSecondFactor()), nil
}

// tooManySecondFactorAttempts annonce le verrou **et sa durée**. Les deux durées — l'en-tête et la
// phrase — sortent du même arrondi, pour qu'un client qui lit l'un et un opérateur qui lit l'autre ne
// voient jamais deux nombres différents. Même construction qu'au premier facteur.
func tooManySecondFactorAttempts(remaining time.Duration) VerifyMfa429JSONResponse {
	seconds := retryAfterSeconds(remaining)

	return VerifyMfa429JSONResponse{
		Headers: VerifyMfa429ResponseHeaders{RetryAfter: seconds},
		Body: Error{
			Code: "too_many_attempts",
			Message: "Le second facteur est temporairement bloqué après plusieurs essais : réessayez " +
				"dans " + humanDelay(seconds) + ". Le blocage porte sur ce compte, se lève tout seul, et " +
				"n'empêche pas de se reconnecter.",
		},
	}
}

// tooManyEnrollments annonce le verrou d'enrôlement et sa durée. Même construction que les deux
// autres : les deux durées — l'en-tête et la phrase — sortent du même arrondi.
//
// La copie dit **ce que le blocage ne touche pas**, parce qu'un opérateur qui lit « bloqué » sur la
// route qui mène au second facteur croirait son compte perdu : se connecter et franchir un facteur
// déjà en place restent ouverts.
func tooManyEnrollments(remaining time.Duration) EnrollTotp429JSONResponse {
	seconds := retryAfterSeconds(remaining)

	return EnrollTotp429JSONResponse{
		Headers: EnrollTotp429ResponseHeaders{RetryAfter: seconds},
		Body: Error{
			Code: "too_many_attempts",
			Message: "L'enrôlement d'une application d'authentification est temporairement bloqué " +
				"après plusieurs demandes : réessayez dans " + humanDelay(seconds) + ". Le blocage " +
				"porte sur ce compte, se lève tout seul, et n'empêche ni de se connecter ni de " +
				"franchir un second facteur déjà en place.",
		},
	}
}

// verifyPresentedFactor aiguille sur la méthode déclarée plutôt que d'essayer les deux.
//
// Essayer les deux ferait payer les argon2id du chemin de récupération à chaque code TOTP faux,
// et la durée de la réponse dirait alors laquelle des deux voies a répondu.
//
// Il sert les **deux** routes : la vérification qui élève, et le remplacement qui détruit. Le geste
// est le même — présenter le facteur en place — et l'écrire deux fois en ferait deux rédactions qui
// divergeraient, dont l'une consommerait le pas de temps et l'autre non.
func (a API) verifyPresentedFactor(ctx context.Context, operatorID string, method, code string,
) (bool, error) {
	if method == string(MfaVerificationMethodRecoveryCode) {
		return a.SecondFactor.VerifyRecoveryCode(ctx, operatorID, code)
	}

	return a.SecondFactor.VerifyTOTP(ctx, operatorID, code)
}

// presentedSecondFactorIsWellFormed dit si une vérification a une forme que le serveur sait exercer.
//
// Le contrat ne sait pas exprimer deux champs qui s'excluent : `code` et `assertion` y sont tous deux
// facultatifs, et c'est ici que la règle vit. Un `webauthn` accompagné d'un code, ou un `totp`
// accompagné d'une assertion, est une requête que le serveur ne saurait pas interpréter — la traiter
// comme un refus rendrait 401 là où le client a fait une faute de forme, et le lui cacherait.
func presentedSecondFactorIsWellFormed(body MfaVerification) bool {
	if len([]rune(body.Challenge)) > maximumChallengeLength || !body.Method.Valid() {
		return false
	}

	if body.Method == MfaVerificationMethodWebauthn {
		return body.Assertion != nil && len(*body.Assertion) > 0 && body.Code == nil
	}

	return body.Assertion == nil && body.Code != nil &&
		len([]rune(*body.Code)) <= maximumCodeLength && *body.Code != ""
}

// verifySecondFactor aiguille sur la méthode présentée.
//
// Trois branches et deux chemins : les deux méthodes qui portent un code partagent
// `verifyPresentedFactor`, que le remplacement d'un authentificateur emprunte aussi. L'assertion, non
// — elle consomme un défi de cérémonie et avance un compteur de signature, ce que ni l'un ni l'autre
// n'a à faire, et l'y forcer aurait fait de la signature une troisième valeur de `code`.
func (a API) verifySecondFactor(ctx context.Context, resolved store.Session,
	body MfaVerification,
) (bool, error) {
	if body.Method == MfaVerificationMethodWebauthn {
		return a.verifyPresentedAssertion(ctx, resolved, *body.Assertion)
	}

	return a.verifyPresentedFactor(ctx, resolved.OperatorID, string(body.Method), *body.Code)
}

// presentedFactorIsWellFormed dit si la preuve d'un enrôlement a une forme exploitable : les deux
// champs ensemble, ou aucun des deux. Un `method` sans `code` — ou l'inverse — est une requête que le
// serveur ne saurait pas interpréter, et la traiter comme « aucune preuve » ferait rendre 409 là où le
// client a fait une faute de forme.
func presentedFactorIsWellFormed(request TotpEnrollmentRequest) bool {
	if request.Method == nil && request.Code == nil {
		return true
	}

	if request.Method == nil || request.Code == nil {
		return false
	}

	// L'enum de **l'enrôlement** et non celui de la vérification, qui porte `webauthn` depuis
	// step-024 : les convertir l'un en l'autre ferait accepter ici une méthode que cette route ne sait
	// pas exercer, et le repli de `verifyPresentedFactor` l'enverrait alors sur le chemin TOTP.
	return request.Method.Valid() && len([]rune(*request.Code)) <= maximumCodeLength
}

// refusedSecondFactor est le refus **unique** du second facteur, comme `refusedCredentials` l'est du
// premier : un seul constructeur, donc pas deux messages entre lesquels choisir.
//
// La copie dit la conséquence d'abord et les deux gestes qui peuvent débloquer, sans nommer laquelle
// des cinq causes s'applique — un challenge épuisé et un chiffre de travers lisent la même phrase.
func refusedSecondFactor() Error {
	return Error{
		Code: "invalid_second_factor",
		Message: "Ce code n'a pas été accepté. Vérifier l'heure de l'application d'authentification, " +
			"ou reprendre la connexion depuis le début.",
	}
}

// secondFactorAlreadyEnrolled dit ce que le refus couvre **et** où s'arrête l'accès : la charte
// interdit un contrôle qui refuse sans expliquer par où passer.
func secondFactorAlreadyEnrolled() Error {
	return Error{
		Code: "mfa_already_enrolled",
		Message: "Un second facteur est déjà en place sur ce compte. Le remplacer demande de franchir " +
			"d'abord celui qui est en place. S'il est perdu, sa réinitialisation par un administrateur " +
			"arrivera avec la gestion des opérateurs.",
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
		Passkeys:               held.Passkeys,
	}, nil
}

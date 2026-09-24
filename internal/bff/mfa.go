package bff

import (
	"context"
	"errors"
	"time"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
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
	// argon2id par appel, et sans ce compteur une session de premier facteur suffirait à la répéter
	// sans qu'aucun autre la voie — elle réussit, et les compteurs d'échecs ne comptent que les refus.
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
		// Course perdue : la session résolue par le middleware impliquait un opérateur actif, et il ne
		// l'est plus. Rien ne l'exerce — voir le constat au-dessus de `VerifyMfa`.
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
	// Sans elle, un opérateur qui ne détient qu'une passkey se ferait enrôler une application
	// d'authentification par quiconque détient son mot de passe : l'enrôlement rendrait le secret et
	// dix codes de récupération, et la vérification élèverait la session sans que la clé ait jamais
	// été présentée.
	held, err := a.SecondFactor.Factors(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if !state.Enrolled && held.Passkeys > 0 && !resolved.Elevated {
		return EnrollTotp409JSONResponse(elevationRequiredToAddAFactor()), nil
	}

	replace := false
	// Un facteur jamais confirmé n'est détenu par personne, pas même son propriétaire : exiger sa
	// preuve l'enfermait dehors. La condition sur les clés d'accès est ce qui empêche la détente de
	// contourner une passkey qui, elle, garde encore le compte.
	unconfirmed := state.Enrolled && !state.Proven && held.Passkeys == 0

	switch {
	case unconfirmed:
		replace = true

	case state.Enrolled:
		if request.Body.Code == nil {
			return EnrollTotp409JSONResponse(secondFactorAlreadyEnrolled()), nil
		}

		// **La réservation d'essai de second facteur, prise ici comme elle l'est par la vérification.**
		// Sans elle, ce chemin ouvrirait un second seau de cinq essais, indépendant du premier : qui
		// détient le mot de passe disposerait de dix devinettes par quart d'heure au lieu de cinq. Le
		// compteur d'appels de la migration 00009 borne le nombre de requêtes, pas le budget de
		// recherche.
		//
		// **Réserver et compter sont deux gardes distinctes, et l'une masque l'autre sur un code
		// faux** — les deux rendent alors le même 429, et la mutation qui retire cette réservation
		// reste verte. Mesuré. Ce qu'elle tient seule se voit sur un code **juste** : sans elle, un
		// compte verrouillé remplacerait son authentificateur, c'est-à-dire que le verrou échouerait à
		// empêcher le succès qu'il existe pour empêcher. C'est ce scénario-là qui la garde.
		lock, err := a.SecondFactor.Reserve(ctx, resolved.OperatorID)
		if err != nil {
			return nil, err
		}

		if lock.Locked() {
			return enrollmentLockedBySecondFactor(lock.Remaining), nil
		}

		replace, err = a.verifyPresentedFactor(ctx, resolved.OperatorID, string(*request.Body.Method),
			*request.Body.Code)
		if err != nil {
			if errors.Is(err, auth.ErrOverloaded) {
				return EnrollTotp503JSONResponse(overloaded()), nil
			}

			return nil, err
		}

		if !replace {
			return refuseReplacement(lock), nil
		}
	}

	// L'état d'après ne porte que ce qu'une enquête doit savoir : un facteur a été posé, et il a
	// remplacé ou non celui d'avant. Ni le secret, ni les codes — `Fields` n'a d'ailleurs pas de
	// méthode pour les y mettre.
	enrollment, written, err := a.SecondFactor.Enroll(ctx, resolved.OperatorID, state.Email, replace,
		a.event(ctx, store.Event{
			OperatorID: resolved.OperatorID,
			Action:     actionMFAEnroll,
			TargetType: auditTargetOperator,
			TargetID:   resolved.OperatorID,
			After: store.NewFields().Text("method", "totp").
				Flag("replaced", replace).Flag("proof_presented", replace && !unconfirmed),
		}))
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
//  2. **la réservation de l'essai, avant toute dépense** — c'est ce qui borne la recherche exhaustive
//     y compris sous une rafale, et la réserver après aurait fait payer au serveur le déchiffrement et
//     les argon2id de chaque essai qu'il refuse, en plus de laisser une rafale entrée ensemble lire
//     toutes « pas de verrou » avant qu'aucune n'ait compté ;
//  3. le challenge vivant **et le sien** — sans cette seconde moitié, le challenge d'un opérateur
//     élèverait la session d'un autre ;
//  4. le code, dont la vérification consomme déjà ce qu'elle valide — le pas de temps ou la ligne du
//     code de récupération, dans les deux cas par un `WHERE` qui tranche le rejeu ; un échec ne
//     recompte rien — l'essai est déjà porté par la réservation du pas 2, et le recompter diviserait
//     le plafond par deux ;
//  5. le challenge consommé, une seule fois ;
//  6. la session élevée, jeton régénéré, et le compteur effacé.
//
// **Tous les refus rendent le même 401**, sauf le verrou : un code faux ou déjà servi, un challenge
// inconnu, échu, consommé ou appartenant à un autre, l'absence de session et sa mort en cours
// de route sont indiscernables. Le verrou, lui, rend 429 avec sa durée — ce qu'il révèle est ce que
// l'attaquant constate de toute façon, et le taire priverait l'opérateur légitime de la seule
// information qui lui dise quoi faire.
//
// **Deux de ses refus ne sont exercés par rien, et c'est mesuré** (critère 4) : le 01/09/2026,
// neutraliser `!consumed` puis `!elevated` — `if false && !x`, un à la fois — laisse `cmd/dashboard`
// et `internal/bff` verts. Idem pour `!found` dans `EnrollTotp`. Aucune n'est morte pour autant : la
// condition n'est garantie que par une lecture antérieure **non transactionnelle**, et le temps passe
// entre les deux.
//
// Aucune n'est atteignable par un test non plus — `a.SecondFactor` et `a.Sessions` sont des types
// concrets, et poser une couture remanierait le câblage. Ce qui est couvert l'est **au niveau du
// store** (`TestUnChallengeNeSeConsommeQuUneFois`, les trois refus d'élévation de `sessions_test.go`) ;
// ce qui ne l'est pas est leur traduction en 401 ici.
//
// La couverture ne peut pas trancher à leur place : les scénarios lancent le binaire en
// sous-processus, donc `-coverprofile` ne voit que 0,1 % de ce paquet. Seule la mutation répond.
//
// **La famille est plus large.** Les cérémonies WebAuthn de `internal/bff/webauthn.go` et
// `internal/mfa/webauthn.go` en portent la forme. Elles ne sont pas auditées ici, et un décompte au
// grep se tromperait : le `!found` de
// `mfa.open` a la même forme sans être une course, et celui de `Passkeys.BeginAssertion` est atteint
// par un scénario, mais par son second membre.
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

	lock, err := a.SecondFactor.Reserve(ctx, resolved.OperatorID)
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
		if errors.Is(err, auth.ErrOverloaded) {
			return VerifyMfa503JSONResponse(overloaded()), nil
		}

		return nil, err
	}

	if !verified {
		return refuseSecondFactor(lock), nil
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

	renewed, elevated, err := a.Sessions.Elevate(ctx, resolved.ID, a.event(ctx, store.Event{
		OperatorID: resolved.OperatorID,
		Action:     actionMFAVerify,
		TargetType: auditTargetOperator,
		TargetID:   resolved.OperatorID,
		After:      store.NewFields().Text("method", string(request.Body.Method)),
	}))
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

	return VerifyMfa204Response{}, nil
}

// refuseSecondFactor refuse. L'essai est déjà compté — par la réservation prise avant la vérification,
// au pas 2 de `VerifyMfa` — et le recompter ici diviserait le plafond par deux.
//
// **`lock.Failures` à hauteur du seuil annonce le verrou tout de suite** : la réservation qui vient de
// l'atteindre n'était pas encore verrouillée — l'appelant a dû vérifier ce dernier essai — et c'est cet
// échec-ci qui pose le verrou, pour la fenêtre entière puisque `last_failure_at` vient d'être posé à
// `now()`.
func refuseSecondFactor(lock store.Lock) VerifyMfaResponseObject {
	if lock.Failures >= mfa.MaxFailures {
		return tooManySecondFactorAttempts(mfa.LockWindow)
	}

	return VerifyMfa401JSONResponse(refusedSecondFactor())
}

// tooManySecondFactorAttempts annonce le verrou **et sa durée**. Les deux durées — l'en-tête et la
// phrase — sortent du même arrondi, pour qu'un client qui lit l'un et un opérateur qui lit l'autre ne
// voient jamais deux nombres différents. Même construction qu'au premier facteur.
func tooManySecondFactorAttempts(remaining time.Duration) VerifyMfa429JSONResponse {
	seconds := retryAfterSeconds(remaining)

	return VerifyMfa429JSONResponse{
		Headers: VerifyMfa429ResponseHeaders{RetryAfter: seconds},
		Body:    secondFactorLocked(seconds),
	}
}

// enrollmentLockedBySecondFactor rend le **même** refus sur la route d'enrôlement : c'est le même
// seau, la même durée et le même remède. Une seconde copie qui dirait « l'enrôlement est bloqué »
// laisserait croire à deux verrous là où il n'y en a qu'un.
//
// Il ne se confond pas avec `tooManyEnrollments`, qui porte le compteur d'**appels** de la migration
// 00009 : même statut, autre cause, autre phrase. Les deux se distinguent au message, et les
// scénarios les exercent sur des routes où une seule des deux peut mordre.
func enrollmentLockedBySecondFactor(remaining time.Duration) EnrollTotp429JSONResponse {
	seconds := retryAfterSeconds(remaining)

	return EnrollTotp429JSONResponse{
		Headers: EnrollTotp429ResponseHeaders{RetryAfter: seconds},
		Body:    secondFactorLocked(seconds),
	}
}

func secondFactorLocked(seconds int) Error {
	return Error{
		Code: "too_many_attempts",
		Message: "Le second facteur est temporairement bloqué après plusieurs essais : réessayez " +
			"dans " + humanDelay(seconds) + ". Le blocage porte sur ce compte, se lève tout seul, et " +
			"n'empêche pas de se reconnecter.",
	}
}

// refuseReplacement refuse le remplacement. Même forme que `refuseSecondFactor` : l'essai est déjà
// compté par la réservation prise plus haut dans `EnrollTotp`, et c'est elle qui annonce le verrou
// quand elle vient d'atteindre le seuil.
//
// **Le corps n'est pas celui de « rien n'a été présenté ».** Le contrat décrit deux causes sous ce
// 409, et les confondre fait lire « présentez votre code » à qui vient de le faire : il retape le
// même.
func refuseReplacement(lock store.Lock) EnrollTotpResponseObject {
	if lock.Failures >= mfa.MaxFailures {
		return enrollmentLockedBySecondFactor(mfa.LockWindow)
	}

	return EnrollTotp409JSONResponse(refusedReplacementProof())
}

// refusedReplacementProof dit ce qui s'est passé : un facteur a été présenté, et il a été refusé.
//
// Le code lui est propre pour que le client **puisse** les séparer : ici le statut ne discrimine rien,
// les trois causes du 409 de cette route le partageant. Aucun écran ne le lit encore — step-028 le
// fera, et sa fiche porte l'obligation.
func refusedReplacementProof() Error {
	return Error{
		Code: "mfa_replacement_refused",
		Message: "Ce second facteur n'a pas été accepté : celui qui est en place n'a pas été " +
			"remplacé. Le présenter à nouveau — un code de récupération convient aussi. Si les deux " +
			"sont perdus, un administrateur détenant « operators:manage » peut réinitialiser votre " +
			"second facteur.",
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

	// L'enum de **l'enrôlement** et non celui de la vérification, qui porte `webauthn` : les convertir
	// l'un en l'autre ferait accepter ici une méthode que cette route ne sait pas exercer, et le repli
	// de `verifyPresentedFactor` l'enverrait alors sur le chemin TOTP.
	return request.Method.Valid() && len([]rune(*request.Code)) <= maximumCodeLength
}

// refusedSecondFactor est le refus **unique** du second facteur, comme `refusedCredentials` l'est du
// premier : un seul constructeur, donc pas deux messages entre lesquels choisir.
//
// La copie dit la conséquence d'abord et les deux gestes qui peuvent débloquer, sans nommer laquelle
// des cinq causes s'applique — un challenge épuisé et un chiffre de travers lisent la même phrase.
//
// **Elle ne nomme aucune méthode.** Ce refus sert les trois — `totp`, `recovery_code` et `webauthn` :
// « vérifier l'heure de l'application d'authentification » enverrait régler une horloge qui n'existe
// pas dans le geste de qui vient de présenter une clé d'accès.
//
// Une copie qui vaut pour trois chemins ne peut nommer que ce qui leur est commun. L'indice de dérive
// d'horloge appartient à l'écran qui présente un code TOTP (`web/src/lib/second-factor.ts`).
func refusedSecondFactor() Error {
	return Error{
		Code: "invalid_second_factor",
		Message: "Second facteur refusé. Réessayez, ou recommencez la connexion.",
	}
}

// secondFactorAlreadyEnrolled dit ce que le refus couvre **et** où s'arrête l'accès : la charte
// interdit un contrôle qui refuse sans expliquer par où passer.
func secondFactorAlreadyEnrolled() Error {
	return Error{
		Code: "mfa_already_enrolled",
		Message: "Un second facteur est déjà en place sur ce compte. Le remplacer demande de franchir " +
			"d'abord celui qui est en place. S'il est perdu, un administrateur détenant " +
			"« operators:manage » peut le réinitialiser.",
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
		Totp:                   held.TOTPConfirmed,
		RecoveryCodesRemaining: held.RecoveryCodesRemaining,
		Passkeys:               held.Passkeys,
	}, nil
}

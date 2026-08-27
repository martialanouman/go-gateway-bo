package bff

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-webauthn/webauthn/protocol"

	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// BeginWebauthnRegistration ouvre l'enregistrement d'une passkey.
//
// L'élévation est exigée **dès qu'un second facteur existe** — TOTP ou passkey. Sans elle, quiconque
// détient le mot de passe s'enrôlerait un facteur neuf et contournerait celui qui est en place ;
// c'est le même arbitrage que le remplacement d'un authentificateur TOTP.
//
// Le premier enrôlement, lui, est libre : c'est l'amorçage, et il n'y a rien à contourner. La fenêtre
// que cela ouvre sur un déploiement neuf est nommée dans la fiche de step-023 et bornée par step-029.
func (a API) BeginWebauthnRegistration(ctx context.Context, _ BeginWebauthnRegistrationRequestObject,
) (BeginWebauthnRegistrationResponseObject, error) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return BeginWebauthnRegistration401JSONResponse(notAuthenticated()), nil
	}

	held, err := a.SecondFactor.Factors(ctx, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if secondFactorHeld(held) && !resolved.Elevated {
		return BeginWebauthnRegistration409JSONResponse(elevationRequiredToAddAFactor()), nil
	}

	creation, found, err := a.Passkeys.BeginRegistration(ctx, resolved.ID, resolved.OperatorID)
	if err != nil {
		return nil, err
	}

	if !found {
		return BeginWebauthnRegistration401JSONResponse(notAuthenticated()), nil
	}

	return BeginWebauthnRegistration200JSONResponse(registrationOptionsOf(creation)), nil
}

// FinishWebauthnRegistration enregistre la passkey que l'appareil vient de produire.
func (a API) FinishWebauthnRegistration(ctx context.Context,
	request FinishWebauthnRegistrationRequestObject,
) (FinishWebauthnRegistrationResponseObject, error) {
	if request.Body == nil || len(request.Body.Attestation) == 0 {
		return FinishWebauthnRegistration400JSONResponse(badRequest()), nil
	}

	// La map vient d'un décodage JSON réussi, donc elle se re-sérialise toujours. Un échec ici n'est
	// pas une requête mal formée mais une panne, et le taire en 400 ferait chercher la faute au client.
	attestation, err := json.Marshal(request.Body.Attestation)
	if err != nil {
		return nil, fmt.Errorf("resérialiser l'attestation reçue : %w", err)
	}

	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return FinishWebauthnRegistration401JSONResponse(refusedCeremony()), nil
	}

	id, err := a.Passkeys.FinishRegistration(ctx, resolved.ID, resolved.OperatorID, attestation)
	if err != nil {
		if mfa.IsRefusedCeremony(err) {
			return FinishWebauthnRegistration401JSONResponse(refusedCeremony()), nil
		}

		return nil, err
	}

	if id == "" {
		// Aucun défi vivant, ou un autre l'a fermé d'abord. Le même refus que pour une signature
		// fausse : les distinguer dirait à une machine où elle en est.
		return FinishWebauthnRegistration401JSONResponse(refusedCeremony()), nil
	}

	return FinishWebauthnRegistration200JSONResponse{Id: id}, nil
}

// BeginWebauthnAssertion ouvre une assertion. Elle n'exige aucun challenge de connexion : ouvrir une
// cérémonie ne prouve rien et n'élève rien — c'est `POST /auth/mfa/verify` qui l'exige, comme pour un
// code TOTP.
func (a API) BeginWebauthnAssertion(ctx context.Context, _ BeginWebauthnAssertionRequestObject,
) (BeginWebauthnAssertionResponseObject, error) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive {
		return BeginWebauthnAssertion401JSONResponse(notAuthenticated()), nil
	}

	assertion, err := a.Passkeys.BeginAssertion(ctx, resolved.ID, resolved.OperatorID)
	if err != nil {
		if errors.Is(err, mfa.ErrNoPasskey) {
			return BeginWebauthnAssertion400JSONResponse(noPasskeyToAssert()), nil
		}

		return nil, err
	}

	return BeginWebauthnAssertion200JSONResponse(assertionOptionsOf(assertion)), nil
}

// DeleteWebauthnPasskey retire une passkey.
//
// L'élévation est exigée, mais **pas** de présenter la passkey qu'on retire : on la retire
// précisément quand on ne l'a plus. Ce que l'élévation seule ne couvre pas est écrit dans le §6.9 —
// elle vaut douze heures — et ce qui reste est tenu par le refus du dernier facteur, plus l'audit de
// step-025.
func (a API) DeleteWebauthnPasskey(ctx context.Context,
	request DeleteWebauthnPasskeyRequestObject,
) (DeleteWebauthnPasskeyResponseObject, error) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return nil, err
	}

	if !alive || !resolved.Elevated {
		return DeleteWebauthnPasskey401JSONResponse(notAuthenticated()), nil
	}

	outcome, err := a.Passkeys.Remove(ctx, resolved.OperatorID, request.PasskeyId)
	if err != nil {
		return nil, err
	}

	switch outcome {
	case store.PasskeyIsLastFactor:
		return DeleteWebauthnPasskey409JSONResponse(lastSecondFactor()), nil
	case store.PasskeyUnknown:
		// « Elle n'existe pas » et « elle n'est pas à vous » rendent le même corps : distinguer dirait
		// ce que possède quelqu'un d'autre.
		return DeleteWebauthnPasskey401JSONResponse(notAuthenticated()), nil
	case store.PasskeyRemoved:
		return DeleteWebauthnPasskey204Response{}, nil
	}

	return nil, fmt.Errorf("issue de retrait de passkey inattendue : %d", outcome)
}

// verifyPresentedAssertion est la troisième branche de la vérification du second facteur. Elle vit
// ici et non dans `verifyPresentedFactor` parce qu'elle ne fait pas le même geste : elle consomme un
// défi de cérémonie et avance un compteur de signature, ce que ni le TOTP ni un code de récupération
// n'ont à faire.
func (a API) verifyPresentedAssertion(ctx context.Context, resolved store.Session,
	assertion map[string]any,
) (bool, error) {
	// Même raison qu'à l'enregistrement : un échec ici est une panne, jamais un refus de facteur.
	encoded, err := json.Marshal(assertion)
	if err != nil {
		return false, fmt.Errorf("resérialiser l'assertion reçue : %w", err)
	}

	return a.Passkeys.VerifyAssertion(ctx, resolved.ID, resolved.OperatorID, encoded)
}

// secondFactorHeld dit si l'opérateur détient déjà de quoi élever une session. Les codes de
// récupération n'en font pas partie : ils sont la sortie de secours d'un TOTP, jamais un facteur qui
// se tient seul.
func secondFactorHeld(held store.SecondFactors) bool {
	return held.TOTPEnrolled || held.Passkeys > 0
}

func elevationRequiredToAddAFactor() Error {
	return Error{
		Code: "mfa_elevation_required",
		Message: "Un second facteur est déjà en place sur ce compte. En ajouter un demande de franchir " +
			"d'abord celui qui est en place, sur cette même session.",
	}
}

func lastSecondFactor() Error {
	return Error{
		Code: "mfa_last_factor",
		Message: "C'est le dernier second facteur de ce compte : le retirer en fermerait l'accès. " +
			"Enrôler un autre facteur d'abord, puis reprendre ce retrait.",
	}
}

func noPasskeyToAssert() Error {
	return Error{
		Code: "no_passkey_enrolled",
		Message: "Aucune clé d'accès n'est enregistrée sur ce compte. En enregistrer une, ou franchir " +
			"le second facteur autrement.",
	}
}

// refusedCeremony est le refus unique des cérémonies, comme `refusedSecondFactor` l'est des codes :
// un seul constructeur, donc pas deux messages entre lesquels choisir.
func refusedCeremony() Error {
	return Error{
		Code: "webauthn_ceremony_refused",
		Message: "Cette clé d'accès n'a pas été acceptée. Reprendre depuis le début, ou franchir le " +
			"second facteur autrement.",
	}
}

// registrationOptionsOf traduit ce que la bibliothèque a tiré en ce que le contrat déclare.
//
// Champ par champ, plutôt que de sérialiser son type : c'est ce que la règle du DTO achète — un champ
// qu'un bump ajouterait ne traverserait pas cette frontière en silence. Le prix est ce mapping, à
// tenir.
func registrationOptionsOf(creation *protocol.CredentialCreation) WebauthnRegistrationOptions {
	var options WebauthnRegistrationOptions

	response := creation.Response

	options.PublicKey.Rp.Id = response.RelyingParty.ID
	options.PublicKey.Rp.Name = response.RelyingParty.Name
	options.PublicKey.User.Id = userHandleOf(response.User.ID)
	options.PublicKey.User.Name = response.User.Name
	options.PublicKey.User.DisplayName = response.User.DisplayName
	options.PublicKey.Challenge = encodeChallenge(response.Challenge)

	for _, parameter := range response.Parameters {
		options.PublicKey.PubKeyCredParams = append(options.PublicKey.PubKeyCredParams, struct {
			Alg  int                                                      `json:"alg"`
			Type WebauthnRegistrationOptionsPublicKeyPubKeyCredParamsType `json:"type"`
		}{
			Alg:  int(parameter.Algorithm),
			Type: WebauthnRegistrationOptionsPublicKeyPubKeyCredParamsType(parameter.Type),
		})
	}

	if response.Timeout > 0 {
		timeout := response.Timeout
		options.PublicKey.Timeout = &timeout
	}

	if descriptors := descriptorsOf(response.CredentialExcludeList); len(descriptors) > 0 {
		options.PublicKey.ExcludeCredentials = &descriptors
	}

	residentKey := string(response.AuthenticatorSelection.ResidentKey)
	userVerification := string(response.AuthenticatorSelection.UserVerification)
	options.PublicKey.AuthenticatorSelection = &struct {
		ResidentKey      *string `json:"residentKey,omitempty"`
		UserVerification *string `json:"userVerification,omitempty"`
	}{ResidentKey: &residentKey, UserVerification: &userVerification}

	return options
}

func assertionOptionsOf(assertion *protocol.CredentialAssertion) WebauthnAssertionOptions {
	var options WebauthnAssertionOptions

	response := assertion.Response

	options.PublicKey.Challenge = encodeChallenge(response.Challenge)

	if response.RelyingPartyID != "" {
		rpID := response.RelyingPartyID
		options.PublicKey.RpId = &rpID
	}

	if response.Timeout > 0 {
		timeout := response.Timeout
		options.PublicKey.Timeout = &timeout
	}

	if descriptors := descriptorsOf(response.AllowedCredentials); len(descriptors) > 0 {
		options.PublicKey.AllowCredentials = &descriptors
	}

	if response.UserVerification != "" {
		verification := string(response.UserVerification)
		options.PublicKey.UserVerification = &verification
	}

	return options
}

func descriptorsOf(credentials []protocol.CredentialDescriptor) []WebauthnCredentialDescriptor {
	descriptors := make([]WebauthnCredentialDescriptor, 0, len(credentials))

	for _, credential := range credentials {
		descriptor := WebauthnCredentialDescriptor{
			Id:   base64.RawURLEncoding.EncodeToString(credential.CredentialID),
			Type: WebauthnCredentialDescriptorType(credential.Type),
		}

		if len(credential.Transport) > 0 {
			transports := make([]string, 0, len(credential.Transport))
			for _, transport := range credential.Transport {
				transports = append(transports, string(transport))
			}

			descriptor.Transports = &transports
		}

		descriptors = append(descriptors, descriptor)
	}

	return descriptors
}

// encodeChallenge rend le défi dans la forme que le navigateur décodera. `RawURLEncoding` — sans
// remplissage — parce que c'est ce que la spécification WebAuthn emploie partout, et ce que la
// bibliothèque produit quand elle sérialise elle-même.
func encodeChallenge(challenge protocol.URLEncodedBase64) string {
	return base64.RawURLEncoding.EncodeToString(challenge)
}

// userHandleOf rend le *user handle* tel que le navigateur l'attend. La bibliothèque le porte en
// `any` parce que sa configuration décide s'il voyage en chaîne ou en base64url ; nous ne l'écrivons
// qu'ici, et toujours en base64url — c'est le défaut, et le seul cas que la spécification décrit
// pour un identifiant binaire.
func userHandleOf(id any) string {
	switch handle := id.(type) {
	case []byte:
		return base64.RawURLEncoding.EncodeToString(handle)
	case string:
		return base64.RawURLEncoding.EncodeToString([]byte(handle))
	default:
		return ""
	}
}

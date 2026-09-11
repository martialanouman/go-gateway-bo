package mfa_test

import (
	"encoding/json"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Ce test-ci existe pour **nommer une cause**, et c'est sa seule raison d'être : les scénarios
// de `cmd/dashboard` exercent déjà les deux cérémonies, mieux et plus loin que lui.
//
// La dette qu'il paie est écrite en DN-12 de step-024 : `descope/virtualwebauthn` déclare
// `go-webauthn v0.16.5` dans son propre `go.mod`, quand le produit exige 0.18.0 — MVS retient la
// plus haute, donc **l'authentificateur du harnais est compilé contre une version serveur qu'il n'a
// jamais vue**. Elle fonctionne ; un durcissement futur de la bibliothèque serveur pourrait la
// mettre en défaut, « et le symptôme serait une suite rouge sans cause lisible dans le produit ».
//
// C'est ce symptôme-là qu'il change, pas le risque. Le jour où ce test rougit avec les scénarios
// WebAuthn, la cause est ici, en trente lignes sans base, sans HTTP et sans binaire : la
// bibliothèque de **test** ne sait plus parler à la bibliothèque serveur. Le jour où il reste vert
// pendant que les scénarios rougissent, c'est le produit.
//
// **Pourquoi elle est gardée plutôt que réécrite.** DN-12 chiffre le repli à cent cinquante lignes
// de crypto EC2 et CBOR à maintenir, sur un chemin de sécurité, pour remplacer huit appels et deux
// cérémonies. Ce qui se payait n'était pas la dépendance, c'était son mode d'échec illisible.
func TestLAuthentificateurDuHarnaisParleALaBibliothequeServeur(t *testing.T) {
	t.Parallel()

	ceremonies, err := mfa.NewPasskeys(relyingPartyID, ceremonyOrigin, productName)
	require.NoError(t, err)

	authenticator := virtualwebauthn.NewAuthenticator()
	relyingParty := virtualwebauthn.RelyingParty{
		Name:   productName,
		ID:     relyingPartyID,
		Origin: ceremonyOrigin,
	}

	owner := store.PasskeyOwner{
		ID:          "01998a3f-0000-7000-8000-00000000000a",
		Email:       "camille.durand@exemple.test",
		DisplayName: "Camille Durand",
	}

	creation, registrationSession, err := ceremonies.BeginRegistration(owner)
	require.NoError(t, err)

	attestationOptions, err := virtualwebauthn.ParseAttestationOptions(marshal(t, creation))
	require.NoError(t, err)

	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	attestation := virtualwebauthn.CreateAttestationResponse(relyingParty, authenticator, credential,
		*attestationOptions)

	registered, err := ceremonies.FinishRegistration(owner, *registrationSession, []byte(attestation))
	require.NoError(t, err, "la bibliothèque serveur a refusé l'attestation du harnais")

	authenticator.AddCredential(credential)
	owner.Passkeys = []store.Passkey{registered}

	assertion, assertionSession, err := ceremonies.BeginAssertion(owner)
	require.NoError(t, err)

	assertionOptions, err := virtualwebauthn.ParseAssertionOptions(marshal(t, assertion))
	require.NoError(t, err)

	allowed := authenticator.FindAllowedCredential(*assertionOptions)
	require.NotNil(t, allowed, "l'authentificateur ne retrouve pas la passkey qu'il vient de poser")

	signed := virtualwebauthn.CreateAssertionResponse(relyingParty, authenticator, *allowed,
		*assertionOptions)

	asserted, err := ceremonies.FinishAssertion(owner, *assertionSession, []byte(signed))
	require.NoError(t, err, "la bibliothèque serveur a refusé la signature du harnais")

	require.Equal(t, registered.CredentialID, asserted.CredentialID,
		"l'assertion aboutit sur une autre passkey que celle qui vient d'être enregistrée")
}

const (
	relyingPartyID = "localhost"
	ceremonyOrigin = "http://localhost:3001"
	productName    = "Passerelle SMS"
)

// marshal rend les options telles que le BFF les sert : `virtualwebauthn` lit du JSON, comme le
// navigateur. Passer par la sérialisation plutôt que par les structures est ce qui donne au test sa
// valeur — c'est là que les deux versions de la bibliothèque peuvent diverger.
func marshal(t *testing.T, options any) string {
	t.Helper()

	encoded, err := json.Marshal(options)
	require.NoError(t, err)

	return string(encoded)
}

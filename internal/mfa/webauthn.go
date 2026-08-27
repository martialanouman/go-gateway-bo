package mfa

import (
	"errors"
	"fmt"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// displayName est ce que le navigateur affiche pendant la cérémonie. Même contrainte que l'`issuer`
// du TOTP, et même prix : deux déploiements du même produit s'y ressemblent.
const displayName = "Passerelle SMS Admin"

// Passkeys mène les deux cérémonies WebAuthn. Il ne tient ni pool ni HTTP — comme `Authenticator`,
// il reçoit ce qu'il lui faut et rend ce qu'il a produit.
//
// `origin` est conservé à part de la configuration de la bibliothèque parce qu'il sert deux fois :
// une fois comme origine *acceptable*, une fois comme origine *attendue* pour chaque cérémonie prise
// une par une. Les deux ne sont égales qu'aujourd'hui, où il n'y en a qu'une.
type Passkeys struct {
	ceremonies *webauthn.WebAuthn
	origin     string
}

// NewPasskeys valide le domaine et l'origine, et échoue si l'un des deux ne peut mener aucune
// cérémonie — une adresse IP, un label vide, un port sans hôte.
//
// C'est **ici** que la configuration est jugée, et non dans `internal/config` : la spécification
// WebAuthn §5.1.3 dit ce qu'est un domaine valable, la bibliothèque l'applique, et le redire ailleurs
// en ferait deux rédactions dont une périmerait. L'appelant doit donc le construire **avant de lier
// son port**, sans quoi le serveur écouterait en refusant chaque cérémonie sans avoir rien dit.
func NewPasskeys(rpID, origin string) (*Passkeys, error) {
	ceremonies, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: displayName,
		RPOrigins:     []string{origin},

		// L'authentificateur choisit ; nous n'exigeons ni clé résidente, ni vérification de
		// l'utilisateur. La passkey **est** le second facteur — le premier est le mot de passe, déjà
		// présenté — donc exiger en plus un code PIN ou une biométrie ajouterait un troisième geste
		// pour la même garantie. `preferred` laisse l'appareil le faire quand il sait le faire seul.
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementPreferred,
			UserVerification: protocol.VerificationPreferred,
		},

		// `Timeouts` est laissé à sa valeur nulle, et c'est un choix : `Enforce` à faux laisse
		// `SessionData.Expires` à zéro, donc la bibliothèque ne compare rien à `time.Now()`.
		// L'échéance d'un défi vit dans `webauthn_challenges.expires_at`, calculée par PostgreSQL —
		// comme celle des sessions et des challenges de premier facteur. Deux instances aux horloges
		// décalées n'expireraient sinon pas les mêmes défis.
	})
	if err != nil {
		return nil, fmt.Errorf("configurer les cérémonies WebAuthn : %w", err)
	}

	return &Passkeys{ceremonies: ceremonies, origin: origin}, nil
}

// BeginRegistration tire les options de création d'une passkey, et l'état que la finition exigera.
//
// Les passkeys déjà détenues sont exclues : sans cela, l'authentificateur en enregistrerait une
// seconde sur le même appareil, que l'opérateur ne saurait pas distinguer de la première.
func (p *Passkeys) BeginRegistration(subject store.PasskeyOwner) (*protocol.CredentialCreation,
	*webauthn.SessionData, error,
) {
	holder := credentialHolder{owner: subject}

	creation, session, err := p.ceremonies.BeginRegistration(holder,
		webauthn.WithExclusions(holder.excludedCredentials()),
		webauthn.WithRegistrationOrigin(p.origin))
	if err != nil {
		return nil, nil, fmt.Errorf("ouvrir la cérémonie d'enregistrement : %w", err)
	}

	return creation, session, nil
}

// FinishRegistration confronte la réponse de l'authentificateur au défi tiré, et rend la passkey à
// écrire.
//
// La réponse arrive en **octets** et non en `*http.Request` : le handler est en mode strict et n'a
// pas la requête sous la main. `ParseCredentialCreationResponseBytes` est le même analyseur que
// celui qu'emprunte la variante HTTP.
func (p *Passkeys) FinishRegistration(subject store.PasskeyOwner, session webauthn.SessionData,
	response []byte,
) (store.Passkey, error) {
	parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
	if err != nil {
		return store.Passkey{}, refusedCeremony(err)
	}

	credential, err := p.ceremonies.CreateCredential(credentialHolder{owner: subject}, session, parsed)
	if err != nil {
		return store.Passkey{}, refusedCeremony(err)
	}

	return passkeyOf(credential), nil
}

// BeginAssertion tire les options d'assertion pour les passkeys que l'opérateur détient.
func (p *Passkeys) BeginAssertion(subject store.PasskeyOwner) (*protocol.CredentialAssertion,
	*webauthn.SessionData, error,
) {
	assertion, session, err := p.ceremonies.BeginLogin(credentialHolder{owner: subject},
		webauthn.WithLoginOrigin(p.origin))
	if err != nil {
		return nil, nil, fmt.Errorf("ouvrir la cérémonie d'assertion : %w", err)
	}

	return assertion, session, nil
}

// FinishAssertion vérifie la signature et rend la passkey qui l'a produite, avec le compteur que
// l'authentificateur vient d'annoncer.
//
// **Ce compteur n'est pas jugé ici.** La bibliothèque pose bien un `CloneWarning`, mais le décider en
// Go laisserait deux assertions concurrentes le lire toutes deux avant qu'aucune n'écrive : c'est
// l'`UPDATE` monotone de `store.Webauthn.ConsumeSignCount` qui tranche, sur un verrou de ligne.
func (p *Passkeys) FinishAssertion(subject store.PasskeyOwner, session webauthn.SessionData,
	response []byte,
) (store.Passkey, error) {
	parsed, err := protocol.ParseCredentialRequestResponseBytes(response)
	if err != nil {
		return store.Passkey{}, refusedCeremony(err)
	}

	credential, err := p.ceremonies.ValidateLogin(credentialHolder{owner: subject}, session, parsed)
	if err != nil {
		return store.Passkey{}, refusedCeremony(err)
	}

	return passkeyOf(credential), nil
}

// RefusedCeremonyError dit qu'une cérémonie n'a pas abouti — défi qui ne correspond pas, origine
// inattendue, signature fausse, réponse mal formée.
//
// **Toutes ces causes sont une seule ici**, comme les cinq du refus de second facteur : ce que
// l'appelant en fait est un 401 muet, et distinguer dirait à une machine où elle en est. La cause
// réelle est enveloppée pour le journal, jamais rendue au client.
type RefusedCeremonyError struct {
	cause error
}

func (e RefusedCeremonyError) Error() string {
	return "cérémonie WebAuthn refusée : " + e.cause.Error()
}

func (e RefusedCeremonyError) Unwrap() error { return e.cause }

func refusedCeremony(cause error) error {
	return RefusedCeremonyError{cause: cause}
}

// IsRefusedCeremony distingue « cette cérémonie n'aboutit pas » de « quelque chose est cassé ». Les
// confondre rendrait 500 sur une signature fausse, ou 401 sur une base tombée.
func IsRefusedCeremony(err error) bool {
	var refused RefusedCeremonyError

	return errors.As(err, &refused)
}

// credentialHolder adapte un opérateur à ce que la bibliothèque attend d'un utilisateur.
//
// Il n'existe que le temps d'une cérémonie et ne sort pas de ce paquet : `store.PasskeyOwner` reste
// la forme que le reste du dépôt manipule, et rien n'oblige `internal/store` à connaître la
// bibliothèque.
type credentialHolder struct {
	owner store.PasskeyOwner
}

// WebAuthnID est le *user handle* que l'authentificateur mémorisera. L'identifiant d'opérateur et non
// l'adresse : le handle est stocké en clair par l'appareil et voyage dans chaque assertion, alors
// qu'un UUID ne dit rien de personne.
func (h credentialHolder) WebAuthnID() []byte { return []byte(h.owner.ID) }

func (h credentialHolder) WebAuthnName() string { return h.owner.Email }

func (h credentialHolder) WebAuthnDisplayName() string { return h.owner.DisplayName }

func (h credentialHolder) WebAuthnCredentials() []webauthn.Credential {
	credentials := make([]webauthn.Credential, 0, len(h.owner.Passkeys))

	for _, passkey := range h.owner.Passkeys {
		credentials = append(credentials, credentialOf(passkey))
	}

	return credentials
}

func (h credentialHolder) excludedCredentials() []protocol.CredentialDescriptor {
	excluded := make([]protocol.CredentialDescriptor, 0, len(h.owner.Passkeys))

	for _, credential := range h.WebAuthnCredentials() {
		excluded = append(excluded, credential.Descriptor())
	}

	return excluded
}

// credentialOf reconstruit ce que la bibliothèque relit d'une passkey enregistrée.
//
// Ce que la ligne ne porte pas est délibéré : ni le type ni le format d'attestation, parce que nous
// n'en demandons aucune — les stocker garderait « none » sur chaque ligne. `Attestation` et
// `Extensions` sont vides pour la même raison, et l'assertion ne les lit pas.
func credentialOf(passkey store.Passkey) webauthn.Credential {
	transports := make([]protocol.AuthenticatorTransport, 0, len(passkey.Transports))
	for _, transport := range passkey.Transports {
		transports = append(transports, protocol.AuthenticatorTransport(transport))
	}

	return webauthn.Credential{
		ID:        passkey.CredentialID,
		PublicKey: passkey.PublicKey,
		Transport: transports,
		Flags: webauthn.CredentialFlags{
			UserPresent:    true,
			UserVerified:   passkey.UserVerified,
			BackupEligible: passkey.BackupEligible,
			BackupState:    passkey.BackupState,
		},
		Authenticator: webauthn.Authenticator{
			AAGUID:     passkey.AAGUID,
			SignCount:  passkey.SignCount,
			Attachment: protocol.AuthenticatorAttachment(passkey.Attachment),
		},
	}
}

// passkeyOf est l'inverse : ce qu'une cérémonie vient de produire, sous la forme que la base écrit.
func passkeyOf(credential *webauthn.Credential) store.Passkey {
	transports := make([]string, 0, len(credential.Transport))
	for _, transport := range credential.Transport {
		transports = append(transports, string(transport))
	}

	return store.Passkey{
		CredentialID:   credential.ID,
		PublicKey:      credential.PublicKey,
		SignCount:      credential.Authenticator.SignCount,
		AAGUID:         credential.Authenticator.AAGUID,
		Transports:     transports,
		Attachment:     string(credential.Authenticator.Attachment),
		UserVerified:   credential.Flags.UserVerified,
		BackupEligible: credential.Flags.BackupEligible,
		BackupState:    credential.Flags.BackupState,
	}
}

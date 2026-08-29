package bff

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Les actions que le journal porte, en `domaine.verbe` — la convention du §3.1. Elles se grep dans le
// journal, donc elles ne se traduisent pas et ne se composent pas à la volée.
//
// **Six des huit mutations de `/auth/` en portent une.** Les deux exemptées sont les ouvertures de
// cérémonie WebAuthn : elles n'ont aucun effet durable — un défi tiré, remplacé au prochain appel, et
// consommé ou échu en cinq minutes. Les tracer produirait du bruit qu'une enquête devrait apprendre à
// écarter, ce qui est le meilleur moyen de lui faire écarter autre chose.
const (
	actionLogin           = "operator.login"
	actionLogout          = "operator.logout"
	actionMFAEnroll       = "mfa.enroll"
	actionMFAVerify       = "mfa.verify"
	actionPasskeyRegister = "passkey.register"
	actionPasskeyRemove   = "passkey.remove"
)

// Les types de cible que ces actions désignent. Le §3.1 les laisse libres ; les nommer ici évite que
// deux handlers écrivent `passkey` et `webauthn_credential` pour la même chose, ce qu'aucune porte ne
// verrait et qui rendrait un filtre par cible incomplet.
const (
	auditTargetOperator = "operator"
	auditTargetPasskey  = "passkey"
)

// audited écrit une ligne au journal si un journal est branché.
//
// **Seuls les succès sont journalisés.** Un refus est déjà compté par le verrou d'essais, et
// journaliser les échecs de connexion ouvrirait une écriture par requête non authentifiée — ce que
// `login_attempt_counters` existe précisément pour éviter d'exposer.
//
// L'erreur remonte : une action qui ne peut pas être tracée n'a pas eu lieu. C'est ce qui rend la
// trace non contournable, et c'est aussi pourquoi les partitions du journal sont entretenues au
// démarrage — sans elles, l'écriture échoue et l'action tombe avec.
func (a API) audited(ctx context.Context, event store.Event) error {
	if address, ok := clientAddressFrom(ctx); ok {
		event.IPAddress = address
	}

	return a.Audit.Record(ctx, event)
}

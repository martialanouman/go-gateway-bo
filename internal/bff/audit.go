package bff

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Les actions que le journal porte, en `domaine.verbe` — la convention du §3.1. Elles se grep dans le
// journal, donc elles ne se traduisent pas et ne se composent pas à la volée.
//
// **Huit des dix mutations de `/auth/` en portent une.** Les deux exemptées sont les ouvertures de
// cérémonie WebAuthn : elles n'ont aucun effet durable — un défi tiré, remplacé au prochain appel, et
// consommé ou échu en cinq minutes. Les tracer produirait du bruit qu'une enquête devrait apprendre à
// écarter, ce qui est le meilleur moyen de lui faire écarter autre chose.
const (
	actionLogin           = "operator.login"
	actionLogout          = "operator.logout"
	actionMFAEnroll       = "mfa.enroll"
	actionMFAVerify       = "mfa.verify"
	actionMFAConfirm      = "mfa.confirm"
	actionPasskeyRegister = "passkey.register"
	actionPasskeyRemove   = "passkey.remove"
	actionPasswordSet     = "operator.password_set"

	actionPermissionDenied   = "permission.denied"
	actionOperatorCreate     = "operator.create"
	actionOperatorDisable    = "operator.disable"
	actionOperatorEnable     = "operator.enable"
	actionOperatorRolesSet   = "operator.assign_roles"
	actionOperatorAccessLink = "operator.access_link"
	actionRoleCreate         = "role.create"
	actionRoleUpdate         = "role.update"
	actionRoleDelete         = "role.delete"
)

// Les types de cible que ces actions désignent. Le §3.1 les laisse libres ; les nommer ici évite que
// deux handlers écrivent `passkey` et `webauthn_credential` pour la même chose, ce qu'aucune porte ne
// verrait et qui rendrait un filtre par cible incomplet.
const (
	auditTargetOperator = "operator"
	auditTargetPasskey  = "passkey"
	auditTargetRole     = "role"
	// auditTargetOperation désigne l'opération du contrat qu'un refus a arrêtée.
	auditTargetOperation = "operation"
)

// auditExemptions nomme les mutations qui ne laissent **pas** de trace, et pourquoi.
//
// **Une table distincte de `authorization`, parce que garder et auditer ne sont pas le même geste.**
// Le cas qui le prouve est `FinishWebauthnRegistration` : exempté de garde de permission — poser son
// propre second facteur est du self-service — et pourtant audité, parce que c'est l'événement qu'une
// enquête sur compte compromis cherche en premier. Une table unique avec un champ optionnel aurait
// laissé les deux décisions se confondre.
//
// La porte d'énumération lit cette table **et le code** : une mutation qui n'écrit pas et n'est pas
// listée ici fait rougir.
var auditExemptions = map[string]string{
	"BeginWebauthnRegistration": "un défi tiré, remplacé au prochain appel, consommé ou échu en cinq " +
		"minutes : aucun effet durable à retrouver dans une enquête",
	"BeginWebauthnAssertion": "même chose que l'ouverture d'enregistrement — et tracer les deux " +
		"produirait un bruit qu'une enquête devrait apprendre à écarter, ce qui est le meilleur moyen " +
		"de lui faire écarter autre chose",
}

// event pose l'adresse de l'appelant sur l'événement que le handler compose. L'écriture, elle, a lieu
// dans la transaction de l'action, côté `store` : ou les deux, ou aucune. **Sauf pour `Logout`**, qui
// passe encore par `Audit.Record` sur le pool — l'arbitrage est écrit sur le handler.
//
// **Seuls les succès sont journalisés, sauf le refus de permission** (`recordDenial`). Un échec de
// connexion est déjà compté par le verrou d'essais, et le journaliser ouvrirait une écriture par
// requête non authentifiée — ce que `login_attempt_counters` existe précisément pour éviter d'exposer.
func (a API) event(ctx context.Context, event store.Event) store.Event {
	if address, ok := clientAddressFrom(ctx); ok {
		event.IPAddress = address
	}

	return event
}

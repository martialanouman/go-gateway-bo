package bff

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/session"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// API implémente l'interface **stricte** qu'engendre `api/openapi-bff.yaml`. Ce que l'interface
// stricte achète tient en une phrase : elle **retire le `http.ResponseWriter` de la signature du
// handler**, qui rend une valeur là où l'interface simple lui tendait un writer nu.
//
// Elle ne tient pas le DTO de sortie pour autant, et il vaut mieux le savoir que le croire : la seule
// méthode de `HealthResponseObject` prend elle-même un `ResponseWriter` nu. Mesuré le 02/08/2026, un
// type de réponse écrit à la main qui l'implémente compile et écrit ce qu'il veut,
// `{"status":"ok","body":"http://passerelle.interne.svc:8443","secret":"fuite"}` compris.
//
// Ce que la porte `TestResponseTypesDeclareTheirFields` couvre est plus étroit que « §1.11 » : la
// **forme des champs déclarés** — ni map ni interface vide, à n'importe quelle profondeur — et
// l'embarquement de types que le contrat n'engendre pas. Mesuré le même jour, sur ce type sans champ :
// la porte reste **verte**. Elle voit pourtant bien ce type — le même, doté d'un champ
// `map[string]any`, la fait tomber en le nommant.
//
// Ce qu'**aucune porte structurelle** ne couvre, donc : un `Visit…` écrit à la main qui sérialise
// autre chose que ses champs. Ce qui rougit se compte par route et non par propriété — mesuré, le
// type ci-dessus effectivement servi par `Health` fait tomber deux choses, le test de corps exact
// `TestHealthProbe` et le scénario godog « la sonde de vivacité rend ce que le contrat décrit », qui
// confronte la réponse servie au YAML du dépôt (`additionalProperties: false` y refuse `body` et
// `secret`). Une route livrée sans l'un ni l'autre n'aurait rien. La forme normale reste celle-ci, où
// `Health200JSONResponse` et son `Visit…` viennent tous deux du contrat.
//
// Elle n'embarque pas `Unimplemented`, et la raison n'est pas celle qu'on croit : `Unimplemented` ne
// porte que des méthodes de l'interface **simple**, donc une opération déclarée et non écrite rompt la
// compilation de toute façon — mesuré, `type API struct{ bff.Unimplemented }` sans `Health` strict est
// refusé avec « wrong type for method Health ». Ce que l'embarquer coûterait est une promesse
// trompeuse dans le type : un repli en 501 que le langage n'honorera jamais ici, et sur lequel un
// lecteur pressé comptera. C'est cette promesse-là que garde
// `TestTheMountedImplementationDoesNotEmbedUnimplemented`.
type API struct {
	// Authenticator porte le premier facteur. `API` cesse ici d'être un struct vide : la remarque
	// ci-dessus sur les portes structurelles reste vraie, elle parle simplement d'un type qui a
	// désormais un champ.
	Authenticator *auth.Authenticator
	// Sessions ouvre, résout et ferme les sessions. Le premier facteur et la session sont deux
	// collaborateurs distincts : c'est ici qu'ils se composent, et nulle part plus bas.
	Sessions *session.Manager
	// SecondFactor enrôle et vérifie le second facteur, et c'est le troisième collaborateur distinct.
	// Ni `auth` ni `session` ne le connaissent : le premier n'a rien à voir avec lui, et le second
	// n'apprend que le geste d'élévation, qui lui appartient.
	SecondFactor *mfa.Manager
	// Passkeys mène les cérémonies WebAuthn et tient ce qu'elles produisent. Un quatrième
	// collaborateur et non une part de `SecondFactor` : les deux facteurs ne partagent que le verrou
	// d'essais et l'élévation, et les réunir aurait fait d'un manager la somme de deux protocoles qui
	// n'ont ni la même forme ni le même nombre d'allers-retours.
	Passkeys *mfa.PasskeyManager
	// Audit écrit le journal. Cinquième collaborateur, et le seul dont **toutes** les routes de
	// mutation dépendent : c'est la moitié « et l'audit avec elle » de l'invariant (c).
	Audit *store.Audit
}

// Health ne touche ni la base ni la passerelle : c'est une sonde de **vivacité**, qui répond « le
// process est en vie », pas « le service est disponible ». Y brancher une dépendance ferait
// redémarrer un serveur sain parce qu'une autre brique est tombée.
func (API) Health(_ context.Context, _ HealthRequestObject) (HealthResponseObject, error) {
	return Health200JSONResponse{Status: HealthStatusOk}, nil
}

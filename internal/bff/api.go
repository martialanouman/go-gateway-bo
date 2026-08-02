package bff

import "context"

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
type API struct{}

// Health ne touche ni la base ni la passerelle : c'est une sonde de **vivacité**, qui répond « le
// process est en vie », pas « le service est disponible ». Y brancher une dépendance ferait
// redémarrer un serveur sain parce qu'une autre brique est tombée.
func (API) Health(_ context.Context, _ HealthRequestObject) (HealthResponseObject, error) {
	return Health200JSONResponse{Status: HealthStatusOk}, nil
}

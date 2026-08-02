package bff

import "context"

// API implémente l'interface **stricte** qu'engendre `api/openapi-bff.yaml`. Ce que l'interface
// stricte achète tient en une phrase : elle **retire le `http.ResponseWriter` de la signature du
// handler**, qui rend une valeur là où l'interface simple lui tendait un writer nu.
//
// Elle ne tient pas le DTO de sortie pour autant, et il vaut mieux le savoir que le croire : la seule
// méthode de `HealthResponseObject` prend elle-même un `ResponseWriter` nu. Mesuré le 02/08/2026, un
// type de réponse écrit à la main qui l'implémente compile et écrit ce qu'il veut,
// `{"status":"ok","body":"…"}` compris. Ce qui garde §1.11 est la porte
// `TestResponseTypesDeclareTheirFields`, pas le compilateur.
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

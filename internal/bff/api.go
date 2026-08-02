package bff

import "context"

// API implémente l'interface **stricte** qu'engendre `api/openapi-bff.yaml` : chaque opération y rend
// un type de réponse déclaré par le contrat, là où l'interface simple ne rendrait qu'un
// `http.ResponseWriter` nu. C'est la convention du DTO de sortie (§1.11) tenue par le compilateur —
// un champ absent du contrat n'a pas de type où être écrit.
//
// Elle n'embarque pas `Unimplemented` : une opération que le contrat déclare et que personne n'écrit
// doit rompre la compilation, pas rendre 501 en silence.
type API struct{}

// Health ne touche ni la base ni la passerelle : c'est une sonde de **vivacité**, qui répond « le
// process est en vie », pas « le service est disponible ». Y brancher une dépendance ferait
// redémarrer un serveur sain parce qu'une autre brique est tombée.
func (API) Health(_ context.Context, _ HealthRequestObject) (HealthResponseObject, error) {
	return Health200JSONResponse{Status: HealthStatusOk}, nil
}

package bff

import (
	"encoding/json"
	"net/http"
)

// errorResponse est la forme d'erreur unique du produit : `code` se grep dans les logs et ne se
// traduit pas, `message` s'affiche à l'opérateur. La traduction des erreurs de l'API Admin vers ce
// DTO arrive en step-003.
type errorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// writeJSON sérialise un DTO de sortie déclaré. Le corps est produit **avant** l'en-tête de statut :
// une fois le statut envoyé, un échec de sérialisation ne laisserait qu'une réponse tronquée que le
// client interpréterait comme un succès.
func writeJSON(w http.ResponseWriter, status int, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		// Inatteignable tant que les réponses sont des structs déclarés (§1.11) : aucun test ne
		// couvre cette branche, et le vérifier demanderait un DTO que la convention interdit.
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)

		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

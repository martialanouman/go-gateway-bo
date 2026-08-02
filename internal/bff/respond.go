package bff

import (
	"encoding/json"
	"net/http"
)

// errorResponse est la forme d'erreur unique du produit : `code` se grep dans les logs et ne se
// traduit pas, `message` s'affiche à l'opérateur. La traduction des erreurs de l'API Admin vers ce
// DTO — et le champ `errors[]` qui l'accompagne — arrive avec la première route du BFF qui **appelle**
// la passerelle, soit **step-060**. Step-003 a livré le client et le mapping typé, et a explicitement
// refusé de porter la réexposition, faute d'une route à servir (fiche step-003, DN-12).
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

	// Sans `charset` : la RFC 8259 §8.1 définit JSON comme de l'UTF-8 et n'enregistre aucun paramètre
	// `charset` pour `application/json`. C'est aussi ce que pose le code engendré depuis le contrat
	// (`bff.gen.go`, `VisitHealthResponse`) — deux formes dans le même produit finiraient figées d'un
	// côté par un test et de l'autre par un autre.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

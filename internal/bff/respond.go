package bff

import (
	"encoding/json"
	"net/http"
)

// writeJSON sérialise un DTO de sortie déclaré. Le corps est produit **avant** l'en-tête de statut :
// une fois le statut envoyé, un échec de sérialisation ne laisserait qu'une réponse tronquée que le
// client interpréterait comme un succès.
//
// **`body` est un `any`, et c'est la seule surface de sérialisation non typée du paquet** — par
// propriété et non par constat : `TestUnCorpsDeReponseNeSEcritQuALEndroitPrevu` refuse qu'un
// `http.ResponseWriter` atteigne autre chose qu'un puits nommé, hors de ce fichier et de l'engendré.
// Le mode strict retire le `ResponseWriter` du *handler*, pas du produit : ce que les middlewares
// refusent part par ici, hors de tout `Visit…Response` engendré. La règle qui s'y applique est celle
// du §1.11, et elle n'est pas une discipline — `TestLeSecondCheminVersLeFilNeSerialiseQueDesDTODeclares`
// exige de chaque site d'appel que le type **statique** de son argument vienne du contrat.
//
// Le paramètre reste un `any` faute de type Go qui dise « un DTO engendré » : les **dix** interfaces
// `…ResponseObject` sont par opération, et aucune n'est implémentée par `Error`. Le resserrer à
// `Error` fermerait la porte au premier refus qui portera autre chose. C'est donc une porte qui tient
// ce que la signature ne peut pas.
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

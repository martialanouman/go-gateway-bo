// Package fuite est le **témoin permanent** des portes de sérialisation : un paquet qui porte,
// exprès, les deux défauts qu'elles existent pour refuser.
//
// Il vit sous `testdata/`, donc `go list ./...` ne l'énumère pas et `go vet ./...` n'en signale rien
// — c'est le patron de `testdata/divergent`. La suite normale ne le voit pas ; il n'est chargé que
// par `TestLesPortesMordentSurLeTemoin`, qui **exige** que chacune le rapporte.
//
// Sans lui, la mordance des portes ne serait établie que par des mutations jouées à la main puis
// retirées, dont rien ne resterait dans le dépôt.
package fuite

import (
	"encoding/json"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Fuite implémente `bff.HealthResponseObject` sans venir du contrat, **et** porte un type de domaine.
// Deux défauts en un type, pour que le témoin exerce les deux portes à la fois.
type Fuite struct {
	Operateur store.Operator `json:"operateur"`
}

// VisitHealthResponse est la méthode que le wrapper engendré servirait : elle décide seule de ce qui
// part sur le fil, et ce qu'elle y met est le hachage du mot de passe.
func (f Fuite) VisitHealthResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	return json.NewEncoder(w).Encode(f.Operateur)
}

package fakegateway

import (
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"
)

const GroupsPath = "/admin/customer-groups"

type group struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description *string   `json:"description,omitempty"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Groups sert le CRUD des groupes de clients avec un état en mémoire : le mock Prism, sans état, ne
// retrouverait pas sous le filtre « archivés » le groupe qu'un parcours vient d'archiver.
type Groups struct {
	mu     sync.Mutex
	groups []group
}

func (g *Groups) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()

	id := r.PathValue("id")
	index := slices.IndexFunc(g.groups, func(candidate group) bool { return candidate.ID == id })

	switch {
	case id == "" && r.Method == http.MethodGet:
		status := r.URL.Query().Get("status")
		listed := slices.DeleteFunc(slices.Clone(g.groups), func(candidate group) bool {
			return status != "" && candidate.Status != status
		})
		reply(w, http.StatusOK, listed)
	case id == "" && r.Method == http.MethodPost:
		var body struct {
			Name        string  `json:"name"`
			Description *string `json:"description"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			reply(w, http.StatusUnprocessableEntity, map[string]string{"code": "validation_error", "message": "bad body"})

			return
		}

		now := time.Now().UTC()
		created := group{
			ID: uuid.NewString(), Name: body.Name, Description: body.Description, Status: "active",
			CreatedAt: now, UpdatedAt: now,
		}
		g.groups = append(g.groups, created)
		reply(w, http.StatusCreated, created)
	case index < 0:
		reply(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "customer group not found"})
	case r.Method == http.MethodGet:
		reply(w, http.StatusOK, g.groups[index])
	case r.Method == http.MethodPatch:
		var patch struct {
			Name        *string `json:"name"`
			Description *string `json:"description"`
			Status      *string `json:"status"`
		}
		if json.NewDecoder(r.Body).Decode(&patch) != nil {
			reply(w, http.StatusUnprocessableEntity, map[string]string{"code": "validation_error", "message": "bad body"})

			return
		}

		updated := &g.groups[index]
		if patch.Name != nil {
			updated.Name = *patch.Name
		}

		if patch.Description != nil {
			updated.Description = patch.Description
		}

		if patch.Status != nil {
			updated.Status = *patch.Status
		}

		updated.UpdatedAt = time.Now().UTC()
		reply(w, http.StatusOK, *updated)
	case r.Method == http.MethodDelete:
		g.groups = slices.Delete(g.groups, index, index+1)
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

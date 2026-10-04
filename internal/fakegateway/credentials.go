package fakegateway

import (
	"crypto/rand"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
)

type credential struct {
	ID             string     `json:"id"`
	AccountID      string     `json:"account_id"`
	Type           string     `json:"type"`
	SystemID       *string    `json:"system_id"`
	Status         string     `json:"status"`
	LastUsedAt     *time.Time `json:"last_used_at"`
	GraceExpiresAt *time.Time `json:"grace_expires_at"`
	CreatedAt      time.Time  `json:"created_at"`
	RotatedAt      *time.Time `json:"rotated_at"`
}

type credentialWithSecret struct {
	credential
	Secret string `json:"secret"`
}

// serveCredentials suit la passerelle corrigée pour step-066 : une rotation réactive un identifiant
// révoqué, et refuse alors toute fenêtre de grâce.
func (c *Customers) serveCredentials(w http.ResponseWriter, r *http.Request, accountID string) {
	itemID := r.PathValue("itemId")
	index := slices.IndexFunc(c.creds, func(candidate credential) bool {
		return candidate.AccountID == accountID && candidate.ID == itemID
	})

	switch {
	case itemID == "" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, slices.DeleteFunc(append([]credential{}, c.creds...), func(candidate credential) bool {
			return candidate.AccountID != accountID
		}))
	case itemID == "" && r.Method == http.MethodPost:
		c.createCredential(w, r, accountID)
	case index < 0:
		reply(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "no such credential"})
	case r.PathValue("verb") == "rotate" && r.Method == http.MethodPost:
		c.rotateCredential(w, r, index)
	case r.PathValue("verb") == "" && r.Method == http.MethodDelete:
		c.creds[index].Status = "revoked"
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (c *Customers) createCredential(w http.ResponseWriter, r *http.Request, accountID string) {
	var body struct {
		Type     string  `json:"type"`
		SystemID *string `json:"system_id"`
	}
	if !decode(w, r, &body) {
		return
	}

	if slices.ContainsFunc(c.creds, func(candidate credential) bool {
		return candidate.AccountID == accountID && candidate.Type == body.Type
	}) {
		reply(w, http.StatusConflict, map[string]string{"code": "conflict", "message": "credential type taken"})

		return
	}

	created := credential{
		ID: uuid.NewString(), AccountID: accountID, Type: body.Type, SystemID: body.SystemID, Status: "active",
		CreatedAt: time.Now().UTC(),
	}
	c.creds = append(c.creds, created)
	reply(w, http.StatusCreated, credentialWithSecret{credential: created, Secret: rand.Text()})
}

func (c *Customers) rotateCredential(w http.ResponseWriter, r *http.Request, index int) {
	var body struct {
		GracePeriodSec *int `json:"grace_period_sec"`
	}
	if !decode(w, r, &body) {
		return
	}

	grace := 0
	if body.GracePeriodSec != nil {
		grace = *body.GracePeriodSec
	}

	if c.creds[index].Status == "revoked" && grace > 0 {
		reply(w, http.StatusUnprocessableEntity, map[string]any{
			"code": "validation_error", "message": "no grace for a revoked credential",
			"errors": []map[string]string{{"field": "grace_period_sec", "message": "must be empty"}},
		})

		return
	}

	now := time.Now().UTC()
	c.creds[index].Status = "active"
	c.creds[index].RotatedAt = &now
	c.creds[index].GraceExpiresAt = nil

	if grace > 0 {
		expires := now.Add(time.Duration(grace) * time.Second)
		c.creds[index].GraceExpiresAt = &expires
	}

	reply(w, http.StatusOK, credentialWithSecret{credential: c.creds[index], Secret: rand.Text()})
}

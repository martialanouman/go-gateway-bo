package fakegateway

import (
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"
)

const CustomersPath = "/admin/customers"

type customer struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Status         string    `json:"status"`
	GroupID        *string   `json:"group_id,omitempty"`
	BillingEnabled bool      `json:"billing_enabled"`
	BalanceScope   string    `json:"balance_scope"`
	ContentStorage string    `json:"content_storage"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type senderID struct {
	ID         string    `json:"id"`
	CustomerID string    `json:"customer_id"`
	Address    string    `json:"address"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// Customers sert les clients et leurs sender IDs avec un état en mémoire, pour qu'un parcours
// retrouve sous le filtre d'un groupe le client qu'il vient d'y créer, puis sur sa fiche ce qu'il
// vient d'y faire. Une seule page : un parcours ne crée pas cinquante clients. Aucun compte : ils
// naissent avec step-063.
type Customers struct {
	mu        sync.Mutex
	customers []customer
	senders   []senderID
}

func (c *Customers) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if id := r.PathValue("id"); id != "" {
		c.serveCustomer(w, r, id)

		return
	}

	switch r.Method {
	case http.MethodGet:
		status, group := r.URL.Query().Get("status"), r.URL.Query().Get("groupId")
		listed := slices.DeleteFunc(append([]customer{}, c.customers...), func(candidate customer) bool {
			return (status != "" && candidate.Status != status) ||
				(group != "" && (candidate.GroupID == nil || *candidate.GroupID != group))
		})
		reply(w, http.StatusOK, map[string]any{"data": listed, "has_more": false})
	case http.MethodPost:
		var body struct {
			Name    string  `json:"name"`
			GroupID *string `json:"group_id"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			reply(w, http.StatusUnprocessableEntity, map[string]string{"code": "validation_error", "message": "bad body"})

			return
		}

		now := time.Now().UTC()
		created := customer{
			ID: uuid.NewString(), Name: body.Name, Status: "active", GroupID: body.GroupID,
			BalanceScope: "customer", ContentStorage: "inherit", CreatedAt: now, UpdatedAt: now,
		}
		c.customers = append(c.customers, created)
		reply(w, http.StatusCreated, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (c *Customers) serveCustomer(w http.ResponseWriter, r *http.Request, id string) {
	index := slices.IndexFunc(c.customers, func(candidate customer) bool { return candidate.ID == id })
	if index < 0 {
		reply(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "customer not found"})

		return
	}

	found := &c.customers[index]

	switch action := r.PathValue("action"); {
	case action == "" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, *found)
	case action == "" && r.Method == http.MethodPatch:
		var patch struct {
			Name   *string `json:"name"`
			Status *string `json:"status"`
		}
		if !decode(w, r, &patch) {
			return
		}

		if patch.Name != nil {
			found.Name = *patch.Name
		}

		if patch.Status != nil {
			found.Status = *patch.Status
		}

		found.UpdatedAt = time.Now().UTC()
		reply(w, http.StatusOK, *found)
	case action == "group" && r.Method == http.MethodPatch:
		var body struct {
			GroupID *string `json:"group_id"`
		}
		if !decode(w, r, &body) {
			return
		}

		found.GroupID = body.GroupID
		found.UpdatedAt = time.Now().UTC()
		reply(w, http.StatusOK, *found)
	case action == "suspend" && r.Method == http.MethodPost:
		found.Status = "suspended"
		found.UpdatedAt = time.Now().UTC()
		reply(w, http.StatusOK, *found)
	case action == "smpp-accounts" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, []struct{}{})
	case action == "sender-ids":
		c.serveSenderIDs(w, r, id)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (c *Customers) serveSenderIDs(w http.ResponseWriter, r *http.Request, customerID string) {
	sender := r.PathValue("senderId")
	index := slices.IndexFunc(c.senders, func(candidate senderID) bool {
		return candidate.ID == sender && candidate.CustomerID == customerID
	})

	switch {
	case sender == "" && r.Method == http.MethodGet:
		listed := slices.DeleteFunc(append([]senderID{}, c.senders...), func(candidate senderID) bool {
			return candidate.CustomerID != customerID
		})
		reply(w, http.StatusOK, listed)
	case sender == "" && r.Method == http.MethodPost:
		var body struct {
			Address string `json:"address"`
		}
		if !decode(w, r, &body) {
			return
		}

		if slices.ContainsFunc(c.senders, func(candidate senderID) bool {
			return candidate.CustomerID == customerID && candidate.Address == body.Address
		}) {
			reply(w, http.StatusConflict, map[string]string{"code": "conflict", "message": "sender id already exists"})

			return
		}

		now := time.Now().UTC()
		created := senderID{
			ID: uuid.NewString(), CustomerID: customerID, Address: body.Address,
			Status: "pending_carrier_approval", CreatedAt: now, UpdatedAt: now,
		}
		c.senders = append(c.senders, created)
		reply(w, http.StatusCreated, created)
	case index < 0:
		reply(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "sender id not found"})
	case r.Method == http.MethodPatch:
		var patch struct {
			Status string `json:"status"`
		}
		if !decode(w, r, &patch) {
			return
		}

		updated := &c.senders[index]
		updated.Status, updated.UpdatedAt = patch.Status, time.Now().UTC()
		reply(w, http.StatusOK, *updated)
	case r.Method == http.MethodDelete:
		c.senders = slices.Delete(c.senders, index, index+1)
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	if json.NewDecoder(r.Body).Decode(into) != nil {
		reply(w, http.StatusUnprocessableEntity, map[string]string{"code": "validation_error", "message": "bad body"})

		return false
	}

	return true
}

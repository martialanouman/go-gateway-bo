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

type account struct {
	ID               string    `json:"id"`
	CustomerID       string    `json:"customer_id"`
	Name             string    `json:"name"`
	Status           string    `json:"status"`
	SmppEnabled      bool      `json:"smpp_enabled"`
	RestEnabled      bool      `json:"rest_enabled"`
	QuerySmEnabled   bool      `json:"query_sm_enabled"`
	CancelSmEnabled  bool      `json:"cancel_sm_enabled"`
	AllowedBindTypes string    `json:"allowed_bind_types"`
	MaxSessions      int       `json:"max_sessions"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type liveBinds struct {
	MaxSessions int        `json:"max_sessions"`
	Active      int        `json:"active"`
	Sessions    []liveBind `json:"sessions"`
}

type liveBind struct {
	ID          string    `json:"id"`
	BindID      string    `json:"bind_id"`
	BindType    string    `json:"bind_type"`
	PodID       string    `json:"pod_id"`
	RemoteAddr  string    `json:"remote_addr"`
	ConnectedAt time.Time `json:"connected_at"`
}

// Customers sert les clients, leurs sender IDs et leurs comptes avec un état en mémoire, pour qu'un
// parcours retrouve ce qu'il vient de créer. Une seule page : un parcours ne crée pas cinquante
// objets.
type Customers struct {
	mu        sync.Mutex
	customers []customer
	senders   []senderID
	accounts  []account
	webhooks  []webhook
	creds     []credential
}

type webhook struct {
	ID        string `json:"id"`
	AccountID string `json:"account_id"`
	EventType string `json:"event_type"`
	URL       string `json:"url"`
	Status    string `json:"status"`
}

// ServeAccounts sert list-smpp-accounts et create-smpp-account.
func (c *Customers) ServeAccounts(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if r.Method == http.MethodGet {
		reply(w, http.StatusOK, map[string]any{"data": c.accountsOf(r.URL.Query().Get("customerId")), "has_more": false})

		return
	}

	var body struct {
		CustomerID string `json:"customer_id"`
		Name       string `json:"name"`
	}
	if !decode(w, r, &body) {
		return
	}

	if slices.ContainsFunc(c.accounts, func(candidate account) bool {
		return candidate.CustomerID == body.CustomerID && candidate.Name == body.Name
	}) {
		reply(w, http.StatusConflict, map[string]string{"code": "conflict", "message": "account name taken"})

		return
	}

	now := time.Now().UTC()
	created := account{
		ID: uuid.NewString(), CustomerID: body.CustomerID, Name: body.Name, Status: "active", SmppEnabled: true,
		RestEnabled: true, QuerySmEnabled: true, CancelSmEnabled: true, AllowedBindTypes: "trx", MaxSessions: 1, CreatedAt: now,
		UpdatedAt: now,
	}
	c.accounts = append(c.accounts, created)
	reply(w, http.StatusCreated, created)
}

// ServeAccount sert la fiche d'un compte : sa lecture, ses canaux, ses opérations SMPP, ses
// webhooks et ses identifiants.
func (c *Customers) ServeAccount(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()

	id := r.PathValue("id")

	index := slices.IndexFunc(c.accounts, func(candidate account) bool { return candidate.ID == id })
	if index < 0 {
		reply(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "no such account"})

		return
	}

	switch action := r.PathValue("action"); {
	case r.PathValue("verb") != "" && action != "credentials":
		http.NotFound(w, r)
	case action == "" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, c.accounts[index])
	case action == "channels" && r.Method == http.MethodPatch:
		var body struct {
			SmppEnabled bool `json:"smpp_enabled"`
			RestEnabled bool `json:"rest_enabled"`
		}
		if !decode(w, r, &body) {
			return
		}

		c.accounts[index].SmppEnabled, c.accounts[index].RestEnabled = body.SmppEnabled, body.RestEnabled
		reply(w, http.StatusOK, c.accounts[index])
	case action == "smpp-ops" && r.Method == http.MethodPatch:
		var body struct {
			QuerySmEnabled  *bool `json:"query_sm_enabled"`
			CancelSmEnabled *bool `json:"cancel_sm_enabled"`
		}
		if !decode(w, r, &body) {
			return
		}

		if body.QuerySmEnabled != nil {
			c.accounts[index].QuerySmEnabled = *body.QuerySmEnabled
		}

		if body.CancelSmEnabled != nil {
			c.accounts[index].CancelSmEnabled = *body.CancelSmEnabled
		}

		reply(w, http.StatusOK, c.accounts[index])
	case action == "session-limits" && r.Method == http.MethodPatch:
		var body struct {
			MaxSessions      int    `json:"max_sessions"`
			AllowedBindTypes string `json:"allowed_bind_types"`
		}
		if !decode(w, r, &body) {
			return
		}

		c.accounts[index].MaxSessions, c.accounts[index].AllowedBindTypes = body.MaxSessions, body.AllowedBindTypes
		reply(w, http.StatusOK, c.accounts[index])
	// Un client lié en permanence : sans bind ouvert, le parcours ne traverserait jamais l'écart.
	case action == "sessions" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, liveBinds{
			MaxSessions: c.accounts[index].MaxSessions, Active: 1,
			Sessions: []liveBind{{
				ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte(id)).String(), BindID: "bind-" + id,
				BindType: c.accounts[index].AllowedBindTypes, PodID: "pod-0", RemoteAddr: "10.4.19.7",
				ConnectedAt: c.accounts[index].CreatedAt,
			}},
		})
	case action == "webhooks" && r.PathValue("itemId") != "":
		c.serveWebhook(w, r, id, r.PathValue("itemId"))
	case action == "credentials":
		c.serveCredentials(w, r, id)
	case action == "webhooks" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, slices.DeleteFunc(append([]webhook{}, c.webhooks...), func(candidate webhook) bool {
			return candidate.AccountID != id
		}))
	case action == "webhooks" && r.Method == http.MethodPost:
		var body struct {
			EventType string `json:"event_type"`
			URL       string `json:"url"`
		}
		if !decode(w, r, &body) {
			return
		}

		created := webhook{ID: uuid.NewString(), AccountID: id, EventType: body.EventType, URL: body.URL, Status: "active"}
		c.webhooks = append(c.webhooks, created)
		reply(w, http.StatusCreated, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (c *Customers) serveWebhook(w http.ResponseWriter, r *http.Request, accountID, webhookID string) {
	index := slices.IndexFunc(c.webhooks, func(candidate webhook) bool {
		return candidate.AccountID == accountID && candidate.ID == webhookID
	})
	if index < 0 {
		reply(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "no such webhook"})

		return
	}

	switch r.Method {
	case http.MethodPatch:
		var body struct {
			URL    *string `json:"url"`
			Status *string `json:"status"`
		}
		if !decode(w, r, &body) {
			return
		}

		if body.URL != nil {
			c.webhooks[index].URL = *body.URL
		}

		if body.Status != nil {
			c.webhooks[index].Status = *body.Status
		}

		reply(w, http.StatusOK, c.webhooks[index])
	case http.MethodDelete:
		c.webhooks = slices.Delete(c.webhooks, index, index+1)
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (c *Customers) accountsOf(customerID string) []account {
	return slices.DeleteFunc(append([]account{}, c.accounts...), func(candidate account) bool {
		return customerID != "" && candidate.CustomerID != customerID
	})
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

		for index := range c.accounts {
			if c.accounts[index].CustomerID == id {
				c.accounts[index].Status = "suspended"
			}
		}

		reply(w, http.StatusOK, *found)
	case action == "smpp-accounts" && r.Method == http.MethodGet:
		reply(w, http.StatusOK, c.accountsOf(id))
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

func (c *Customers) countIn(groupID string) int {
	c.mu.Lock()
	defer c.mu.Unlock()

	count := 0
	for _, member := range c.customers {
		if member.GroupID != nil && *member.GroupID == groupID {
			count++
		}
	}

	return count
}

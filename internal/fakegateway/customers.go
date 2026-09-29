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

// Customers sert la liste et la création des clients avec un état en mémoire, pour qu'un parcours
// retrouve sous le filtre d'un groupe le client qu'il vient d'y créer. Une seule page : un parcours
// ne crée pas cinquante clients.
type Customers struct {
	mu        sync.Mutex
	customers []customer
}

func (c *Customers) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()

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

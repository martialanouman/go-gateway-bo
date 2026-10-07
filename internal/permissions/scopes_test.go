package permissions

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Écrite à la main d'après le §6.10 et l'ADR-0019, jamais dérivée du code qu'elle juge.
var expectedScopesByRole = map[string][]string{
	"Propriétaire": {"admin:read", "admin:write", "audit:read", "cdr:export_bulk", "content:erase", "content:read", "gdpr:erase", "msisdn:reveal"},
	"Exploitation": {"admin:read", "admin:write", "audit:read", "cdr:export_bulk", "msisdn:reveal"},
	"Scripts":      {"admin:read", "admin:write"},
	"Support":      {"admin:read", "msisdn:reveal"},
	"Finance":      {"admin:read", "admin:write"},
	"Reporting":    {"admin:read"},
	"Clientèle":    {"admin:read", "admin:write"},
	"Conformité":   {"admin:read", "admin:write", "cdr:export_bulk", "content:erase", "gdpr:erase", "msisdn:reveal"},
	"Audit":        {"audit:read"},
}

func TestEveryDefaultRoleOpensExactlyItsGatewayScopes(t *testing.T) {
	roles := DefaultRoles()
	require.Len(t, expectedScopesByRole, len(roles))
	for _, role := range roles {
		held := make([]string, 0, len(role.Keys))
		for _, k := range role.Keys {
			held = append(held, string(k))
		}
		assert.Equal(t, expectedScopesByRole[role.Name], GatewayScopes(held), role.Name)
	}
}

func TestEveryCatalogKeyHasAGatewayClass(t *testing.T) {
	for _, entry := range All() {
		_, classified := gatewayAccess[entry.Key]
		assert.True(t, classified, "%s n'a pas de classe : elle n'ouvrirait rien à la passerelle sans que personne ne l'ait décidé", entry.Key)
	}
}

func TestNoClassNamesAKeyOutsideTheCatalog(t *testing.T) {
	catalogued := map[Key]bool{}
	for _, entry := range All() {
		catalogued[entry.Key] = true
	}
	for key := range gatewayAccess {
		assert.True(t, catalogued[key], "%s est classée mais absente du catalogue", key)
	}
	assert.Len(t, gatewayAccess, len(All()))
}

func TestLocalKeysOpenNothingAtTheGateway(t *testing.T) {
	assert.Nil(t, GatewayScopes([]string{string(AlertsRead), string(AlertsWrite), string(OperatorsManage), string(RolesManage)}))
}

func TestReadingUnmaskedNumbersMapsToMSISDNReveal(t *testing.T) {
	assert.Equal(t, []string{"msisdn:reveal"}, GatewayScopes([]string{string(CDRReadPII)}))
}

func TestAnUnknownKeyOpensNothing(t *testing.T) {
	assert.Nil(t, GatewayScopes([]string{"inexistante:clé"}))
}

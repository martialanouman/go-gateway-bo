package permissions

import "slices"

const (
	ScopeAdminRead     = "admin:read"
	ScopeAdminWrite    = "admin:write"
	ScopeContentRead   = "content:read"
	ScopeContentErase  = "content:erase"
	ScopeGDPRErase     = "gdpr:erase"
	ScopeCDRExportBulk = "cdr:export_bulk"
	ScopeAuditRead     = "audit:read"
	ScopeMSISDNReveal  = "msisdn:reveal"
)

// gatewayAccess dit ce que chaque clé ouvre à la passerelle (ADR-0019). Une clé propre au BFF
// n'ouvre rien : la traduire en admin:write donnerait l'écriture amont à qui gère les opérateurs.
// Les alertes (règles et notifications) vivent dans le BFF ; le flux amont billing-alerts est ouvert par l'identité système.
var gatewayAccess = map[Key]string{
	RoutesRead: ScopeAdminRead, RoutesWrite: ScopeAdminWrite, RoutesImport: ScopeAdminWrite,
	ScriptsRead: ScopeAdminRead, ScriptsWrite: ScopeAdminWrite, ScriptsPublish: ScopeAdminWrite,
	SenderRewriteRead: ScopeAdminRead, SenderRewriteWrite: ScopeAdminWrite,
	ConnectorsRead: ScopeAdminRead, ConnectorsWrite: ScopeAdminWrite, ConnectorsRebind: ScopeAdminWrite,
	TrafficRead: ScopeAdminRead, SessionsRead: ScopeAdminRead, SessionsDisconnect: ScopeAdminWrite,
	AntispamRead: ScopeAdminRead, AntispamWrite: ScopeAdminWrite,
	CustomersRead: ScopeAdminRead, CustomersWrite: ScopeAdminWrite,
	AccountsRead: ScopeAdminRead, AccountsWrite: ScopeAdminWrite,
	CredentialsRead: ScopeAdminRead, CredentialsWrite: ScopeAdminWrite, CredentialsRotate: ScopeAdminWrite,
	GroupsRead: ScopeAdminRead, GroupsWrite: ScopeAdminWrite,
	BillingRead: ScopeAdminRead, BillingWrite: ScopeAdminWrite, BillingTopup: ScopeAdminWrite,
	BillingProviderWrite: ScopeAdminWrite, BillingScopeChange: ScopeAdminWrite,
	ContentRead: ScopeContentRead, ContentErase: ScopeContentErase,
	CDRReadPII: ScopeMSISDNReveal, CDRExportBulk: ScopeCDRExportBulk,
	SuppressionsRead: ScopeAdminRead, SuppressionsWrite: ScopeAdminWrite, SuppressionsDelete: ScopeAdminWrite,
	InboundRead: ScopeAdminRead, InboundWrite: ScopeAdminWrite,
	GDPRErase:  ScopeGDPRErase,
	AuditRead:  ScopeAuditRead,
	AlertsRead: "", AlertsWrite: "",
	OperatorsManage: "", RolesManage: "", GatewayPersonalToken: "",
}

func GatewayScopes(held []string) []string {
	var scopes []string
	for _, key := range held {
		if scope := gatewayAccess[Key(key)]; scope != "" {
			scopes = append(scopes, scope)
		}
	}
	if len(scopes) == 0 {
		return nil
	}
	slices.Sort(scopes)
	return slices.Compact(scopes)
}

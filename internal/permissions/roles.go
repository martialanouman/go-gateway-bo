package permissions

import "slices"

// DefaultRole est un des neuf paquets nommés du §6.10 : ce qu'il accorde, et la phrase que l'écran
// de gestion des rôles affiche pour dire à quoi il sert.
//
// Ces neuf rôles sont **pré-remplis et non supprimables**. Un administrateur en compose d'autres à
// partir du même catalogue ; ceux-ci sont l'image de la spécification, et le seed les y ramène à
// chaque déploiement.
type DefaultRole struct {
	Name        string
	Description string
	Keys        []Key
}

// DefaultRoles rend les neuf rôles du §6.10, dans l'ordre du tableau de la spécification.
//
// La copie est profonde, et ce n'est pas une précaution de style : `defaultRoles` est un `var` de
// package, donc un appelant qui recevrait la tranche elle-même — ou la tranche de clés qu'elle
// contient — pourrait réécrire la politique d'autorisation pour tout le process, y compris pour les
// gardes qui s'en réclament.
func DefaultRoles() []DefaultRole {
	copied := slices.Clone(defaultRoles)
	for i := range copied {
		copied[i].Keys = slices.Clone(copied[i].Keys)
	}

	return copied
}

// defaultRoles est la politique elle-même.
//
// Elle est **écrite à la main d'après le §6.10**, et sa fidélité est tenue par
// `roles_test.go`, dont la table de vérité est transcrite depuis la spécification et non dérivée
// d'ici. Les exclusions portent le sens autant que les inclusions — `ops` sans `suppressions:delete`,
// `script_author` sans `scripts:publish`, `support_readonly` sans `content:read`, `account_manager`
// sans `billing:topup`, `auditor` sans `cdr:read_pii` — et une exclusion oubliée n'a aucun symptôme
// visible : elle accorde, en silence, exactement ce que le rôle existe pour interdire.
//
// Trois clés n'appartiennent à aucun rôle sauf `super_admin`, délibérément : `content:read`,
// `operators:manage` et `roles:manage`. Toute autre clé orpheline est un oubli, et le test le dit.
//
// Les arbitrages que la prose du §6.10 ne tranche pas mécaniquement — `sessions:disconnect` pour
// `ops`, `credentials:read` refusé à `support_readonly` — sont écrits dans DN-3 de
// `tasks/steps/step-020.md`, chacun avec la phrase de la spécification qui le décide.
var defaultRoles = []DefaultRole{
	{
		Name: "super_admin",
		Description: "Détient toutes les permissions, gestion des opérateurs et des rôles comprise — " +
			"c'est le rôle du propriétaire du produit",
		Keys: everyCatalogKey(),
	},
	{
		Name: "ops",
		Description: "Exploite le réseau : routage, scripts, réécriture de sender, connecteurs, " +
			"sessions, anti-spam, numéros entrants, désabonnements et alertes en écriture, MSISDN en " +
			"clair et export de masse compris ; lecture seule sur la facturation et l'audit. Ne peut " +
			"ni lever un désabonnement ni afficher le corps d'un message",
		Keys: []Key{
			RoutesRead, RoutesWrite, RoutesImport,
			ScriptsRead, ScriptsWrite, ScriptsPublish,
			SenderRewriteRead, SenderRewriteWrite,
			ConnectorsRead, ConnectorsWrite, ConnectorsRebind,
			SessionsRead, SessionsDisconnect,
			AntispamRead, AntispamWrite,
			InboundRead, InboundWrite,
			SuppressionsRead, SuppressionsWrite,
			AlertsRead, AlertsWrite,
			CDRReadPII, CDRExportBulk,
			BillingRead, AuditRead,
		},
	},
	{
		Name: "script_author",
		Description: "Écrit et modifie les scripts de routage sans pouvoir les mettre en " +
			"production — la publication passe par ops ou super_admin",
		Keys: []Key{
			ScriptsRead, ScriptsWrite,
		},
	},
	{
		Name: "support_readonly",
		Description: "Investigue en lecture seule — comptes, routage, connecteurs, sessions, CDR, " +
			"facturation et alertes, MSISDN en clair compris ; ne voit ni le code source d'un script, " +
			"ni les règles de réécriture, ni les identifiants, ni le corps d'un message",
		Keys: []Key{
			CustomersRead, AccountsRead, GroupsRead,
			RoutesRead, ConnectorsRead, SessionsRead,
			BillingRead, AlertsRead,
			CDRReadPII,
		},
	},
	{
		Name: "billing_admin",
		Description: "Tient la facturation de bout en bout, rechargements et fournisseurs compris, " +
			"et lit le reste sans voir les MSISDN en clair",
		Keys: []Key{
			BillingRead, BillingWrite, BillingTopup, BillingProviderWrite, BillingScopeChange,
			CustomersRead, AccountsRead, GroupsRead,
			RoutesRead, ConnectorsRead, SessionsRead,
			AlertsRead,
		},
	},
	{
		Name:        "billing_readonly",
		Description: "Consulte les soldes, le grand livre et les plans tarifaires, et rien d'autre",
		Keys: []Key{
			BillingRead,
		},
	},
	{
		Name: "account_manager",
		Description: "Ouvre et suit les clients — fiches, comptes SMPP, identifiants, groupes et " +
			"paramètres de facturation ; ne peut ni recharger un solde ni toucher au routage",
		Keys: []Key{
			CustomersRead, CustomersWrite,
			AccountsRead, AccountsWrite,
			CredentialsRead, CredentialsWrite, CredentialsRotate,
			GroupsRead, GroupsWrite,
			BillingRead, BillingWrite, BillingScopeChange,
		},
	},
	{
		Name: "compliance",
		Description: "Seul rôle par défaut habilité à lever un désabonnement et à exécuter un " +
			"effacement RGPD ; lit les comptes et les CDR, MSISDN en clair compris, sans afficher le " +
			"corps d'un message",
		Keys: []Key{
			SuppressionsRead, SuppressionsWrite, SuppressionsDelete,
			InboundRead,
			GDPRErase, ContentErase,
			CustomersRead, AccountsRead, GroupsRead,
			CDRReadPII, CDRExportBulk,
		},
	},
	{
		Name: "auditor",
		Description: "Consulte le journal d'audit, et rien d'autre — les MSISDN y restent masqués, " +
			"les corréler davantage relève d'une élévation explicite",
		Keys: []Key{
			AuditRead,
		},
	},
}

// everyCatalogKey rend les clés du catalogue, dans son ordre.
//
// `super_admin` est **dérivé** plutôt qu'écrit : le §6.10 dit « toutes les permissions », et une
// liste tenue en parallèle prendrait du retard à chaque clé ajoutée. Le propriétaire du produit
// perdrait alors l'accès à ce que la release ajoute, sans pouvoir se l'accorder lui-même —
// `roles:manage` étant précisément une de ces clés.
func everyCatalogKey() []Key {
	keys := make([]Key, 0, len(catalog))
	for _, entry := range catalog {
		keys = append(keys, entry.Key)
	}

	return keys
}

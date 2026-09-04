package permissions

// Les 44 clés, chacune déclarée **une seule fois**. Le catalogue plus bas les référence plutôt que
// de répéter leurs littéraux : il n'y a pas deux listes à tenir cohérentes, il y en a une.
//
// Ce que ces constantes achètent : `Key` a `string` pour sous-jacent, donc n'importe quelle chaîne
// s'y convertit — une garde mal orthographiée, `requires("routes:raed")`, compilerait et refuserait
// tout le monde en silence. Écrite `requires(permissions.RoutesRead)`, la faute de frappe ne compile
// plus.
const (
	// routing
	RoutesRead         Key = "routes:read"
	RoutesWrite        Key = "routes:write"
	RoutesImport       Key = "routes:import"
	ScriptsRead        Key = "scripts:read"
	ScriptsWrite       Key = "scripts:write"
	ScriptsPublish     Key = "scripts:publish"
	SenderRewriteRead  Key = "senderrewrite:read"
	SenderRewriteWrite Key = "senderrewrite:write"
	// connectors
	ConnectorsRead   Key = "connectors:read"
	ConnectorsWrite  Key = "connectors:write"
	ConnectorsRebind Key = "connectors:rebind"
	// sessions
	SessionsRead       Key = "sessions:read"
	SessionsDisconnect Key = "sessions:disconnect"
	// antispam
	AntispamRead  Key = "antispam:read"
	AntispamWrite Key = "antispam:write"
	// accounts
	CustomersRead     Key = "customers:read"
	CustomersWrite    Key = "customers:write"
	AccountsRead      Key = "accounts:read"
	AccountsWrite     Key = "accounts:write"
	CredentialsRead   Key = "credentials:read"
	CredentialsWrite  Key = "credentials:write"
	CredentialsRotate Key = "credentials:rotate"
	GroupsRead        Key = "groups:read"
	GroupsWrite       Key = "groups:write"
	// billing
	BillingRead          Key = "billing:read"
	BillingWrite         Key = "billing:write"
	BillingTopup         Key = "billing:topup"
	BillingProviderWrite Key = "billing:provider:write"
	BillingScopeChange   Key = "billing:scope_change"
	// content
	ContentRead   Key = "content:read"
	ContentErase  Key = "content:erase"
	CDRReadPII    Key = "cdr:read_pii"
	CDRExportBulk Key = "cdr:export_bulk"
	// compliance
	SuppressionsRead   Key = "suppressions:read"
	SuppressionsWrite  Key = "suppressions:write"
	SuppressionsDelete Key = "suppressions:delete"
	InboundRead        Key = "inbound:read"
	InboundWrite       Key = "inbound:write"
	GDPRErase          Key = "gdpr:erase"
	// alerts
	AlertsRead  Key = "alerts:read"
	AlertsWrite Key = "alerts:write"
	// audit
	AuditRead Key = "audit:read"
	// admin
	OperatorsManage Key = "operators:manage"
	RolesManage     Key = "roles:manage"
)

// catalog est le vocabulaire lui-même. L'ordre des catégories est celui où l'écran d'édition de
// rôle les présente, et celui des clés à l'intérieur d'une catégorie est conservé tel quel : la
// lecture du fichier et celle de l'écran coïncident.
//
// Motif à respecter en ajoutant une clé : **le verbe dangereux a la sienne**.
// `sessions:disconnect` n'est pas dans `sessions:write`, `credentials:rotate` n'est pas dans
// `credentials:write`, `scripts:publish` n'est pas dans `scripts:write`. C'est ce qui permet à un
// rôle de corriger une configuration sans pouvoir déclencher l'acte visible en production.
//
// **Aucun test n'affirme le nombre de clés**, et c'est délibéré : un `len(catalog) == 44` exigerait
// une seconde déclaration tenue à la main, dont l'incrément 44 → 45 ne porte aucune information
// relisible — on le met à jour sans le lire. Le golden existe déjà ailleurs : une clé disparue ici
// devient une **ligne supprimée nommée** dans le diff de `permissions.gen.ts`, que
// `check-generated` force à régénérer.
//
// Une version antérieure de ce commentaire disait « la perte accidentelle d'une clé n'est gardée
// par aucun test ». C'était **faux-pessimiste**, et un relecteur l'a mesuré : retirer `audit:read`,
// seule clé de sa famille, fait tomber `TestEveryCategoryAcceptedBySQLCarriesAtLeastOneKey` ; et
// **toute** clé retirée sans régénération fait tomber `TestTheCommittedFileIsWhatTheGeneratorProduces`,
// qui est précisément le golden que la phrase suivante invoquait. Ce qui n'est gardé par rien est
// plus étroit : une clé retirée **et** régénérée dans le même geste ne laisse qu'un diff à relire.
//
// **Le sens inverse est tenu depuis step-031** par `TestAucuneConstanteNeManqueAuCatalogue`, qui
// part de la portée du paquet et non de `All()` — une constante déclarée ci-dessous mais qu'aucune
// entrée ne référence. Jusque-là il n'était gardé par rien, mesuré le 02/08/2026 : un
// `const FooBar Key = "foo:bar"` ajouté ici **compilait**, laissait les deux suites vertes et
// n'apparaissait pas dans le TypeScript engendré — Go ne signale pas une constante exportée
// inutilisée. C'est la faille de DN-3 prise par l'autre bout : `requires(permissions.FooBar)`
// refusait alors tout le monde en silence, sans qu'aucune porte n'ait rien dit. La rédaction d'alors
// jugeait le remède plus lourd que ce qu'il protège ; il tient en une quarantaine de lignes.
var catalog = []Entry{
	// ─── routing ───
	{
		Key:         RoutesRead,
		Category:    "routing",
		Description: "Consulter les routes, leur ordre de priorité et la route de repli",
	},
	{
		Key:         RoutesWrite,
		Category:    "routing",
		Description: "Créer, modifier, réordonner et supprimer des routes",
	},
	{
		Key:         RoutesImport,
		Category:    "routing",
		Description: "Importer en masse des routes par numéro exact (portabilité MNP)",
	},
	{
		Key:         ScriptsRead,
		Category:    "routing",
		Description: "Lire le code source des scripts de routage et leurs versions",
	},
	{
		Key:         ScriptsWrite,
		Category:    "routing",
		Description: "Modifier un script de routage et enregistrer une nouvelle version, sans la publier",
	},
	{
		Key:         ScriptsPublish,
		Category:    "routing",
		Description: "Mettre une version de script en production ou revenir à la précédente — effet immédiat sur le routage",
	},
	{
		Key:         SenderRewriteRead,
		Category:    "routing",
		Description: "Consulter les règles de réécriture de sender ID",
	},
	{
		Key:         SenderRewriteWrite,
		Category:    "routing",
		Description: "Créer et modifier les règles de réécriture de sender ID",
	},
	// ─── connectors ───
	{
		Key:         ConnectorsRead,
		Category:    "connectors",
		Description: "Consulter les connecteurs, leur pool de binds, link_status et breaker_state",
	},
	{
		Key:         ConnectorsWrite,
		Category:    "connectors",
		Description: "Créer, modifier et supprimer un connecteur et la configuration de son pool de binds",
	},
	{
		Key:         ConnectorsRebind,
		Category:    "connectors",
		Description: "Forcer la reconnexion d’un bind — interrompt le trafic qu’il porte le temps du rétablissement",
	},
	// ─── sessions ───
	{
		Key:         SessionsRead,
		Category:    "sessions",
		Description: "Consulter les sessions SMPP actives et leurs binds",
	},
	{
		Key:         SessionsDisconnect,
		Category:    "sessions",
		Description: "Déconnecter de force une session SMPP — le client perd sa connexion sans préavis",
	},
	// ─── antispam ───
	{
		Key:         AntispamRead,
		Category:    "antispam",
		Description: "Consulter les règles anti-spam, la file de revue et la réputation des comptes",
	},
	{
		Key:         AntispamWrite,
		Category:    "antispam",
		Description: "Créer et modifier les règles anti-spam et traiter la file de revue",
	},
	// ─── accounts ───
	{
		Key:         CustomersRead,
		Category:    "accounts",
		Description: "Consulter la liste des clients et leur fiche",
	},
	{
		Key:         CustomersWrite,
		Category:    "accounts",
		Description: "Créer et modifier un client, le suspendre ou le réactiver en cascade",
	},
	{
		Key:         AccountsRead,
		Category:    "accounts",
		Description: "Consulter les comptes SMPP, leurs canaux, quotas et max_sessions",
	},
	{
		Key:         AccountsWrite,
		Category:    "accounts",
		Description: "Créer et modifier un compte SMPP, ses quotas, ses limites de débit et ses webhooks",
	},
	{
		Key:         CredentialsRead,
		Category:    "accounts",
		Description: "Voir la liste des identifiants d’un compte et leur état — jamais le secret, qui n’est plus réaffichable",
	},
	{
		Key:         CredentialsWrite,
		Category:    "accounts",
		Description: "Créer et révoquer un identifiant de bind — le secret n’est montré qu’à la création",
	},
	{
		Key:         CredentialsRotate,
		Category:    "accounts",
		Description: "Faire tourner un identifiant avec période de grâce — l’ancien secret cesse d’être accepté à son terme",
	},
	{
		Key:         GroupsRead,
		Category:    "accounts",
		Description: "Consulter les groupes de clients et leur composition",
	},
	{
		Key:         GroupsWrite,
		Category:    "accounts",
		Description: "Créer et modifier les groupes de clients et leurs membres",
	},
	// ─── billing ───
	{
		Key:         BillingRead,
		Category:    "billing",
		Description: "Consulter les soldes, le grand livre et les plans tarifaires",
	},
	{
		Key:         BillingWrite,
		Category:    "billing",
		Description: "Modifier les plans tarifaires et les paramètres de facturation d’un client",
	},
	{
		Key:         BillingTopup,
		Category:    "billing",
		Description: "Recharger un solde ou transférer du crédit entre comptes — mouvement d’argent réel",
	},
	{
		Key:         BillingProviderWrite,
		Category:    "billing",
		Description: "Configurer les fournisseurs de facturation et tester leur connexion",
	},
	{
		Key:         BillingScopeChange,
		Category:    "billing",
		Description: "Changer le balance_scope d’un client — modifie la façon dont ses comptes consomment leur solde",
	},
	// ─── content ───
	{
		Key:         ContentRead,
		Category:    "content",
		Description: "Afficher le corps d’un message — chaque lecture est journalisée nominativement et reste consultable",
	},
	{
		Key:         ContentErase,
		Category:    "content",
		Description: "Détruire la clé de chiffrement d’un contenu — corps illisible, métadonnées conservées, irréversible",
	},
	{
		Key:         CDRReadPII,
		Category:    "content",
		Description: "Voir les MSISDN en clair dans la recherche, la trace et les exports — sinon ils restent masqués",
	},
	{
		Key:         CDRExportBulk,
		Category:    "content",
		Description: "Lancer un export CSV de masse de CDR, dans la limite du plafond de lignes",
	},
	// ─── compliance ───
	{
		Key:         SuppressionsRead,
		Category:    "compliance",
		Description: "Consulter les listes de désabonnement par canal et l’origine de chaque entrée",
	},
	{
		Key:         SuppressionsWrite,
		Category:    "compliance",
		Description: "Ajouter des entrées de désabonnement, à l’unité ou par import en masse",
	},
	{
		Key:         SuppressionsDelete,
		Category:    "compliance",
		Description: "Lever un désabonnement — le destinataire redevient joignable, l’action est journalisée nominativement",
	},
	{
		Key:         InboundRead,
		Category:    "compliance",
		Description: "Consulter les numéros entrants, leurs affectations et leurs mots-clés",
	},
	{
		Key:         InboundWrite,
		Category:    "compliance",
		Description: "Créer et affecter des numéros entrants et leurs mots-clés",
	},
	{
		Key:         GDPRErase,
		Category:    "compliance",
		Description: "Lancer un effacement RGPD sur un client ou un MSISDN — irréversible, avec attestation à l’achèvement",
	},
	// ─── alerts ───
	{
		Key:         AlertsRead,
		Category:    "alerts",
		Description: "Consulter les règles d’alerte métier et les notifications déclenchées",
	},
	{
		Key:         AlertsWrite,
		Category:    "alerts",
		Description: "Créer et modifier les règles d’alerte métier et leurs canaux de notification",
	},
	// ─── audit ───
	{
		Key:         AuditRead,
		Category:    "audit",
		Description: "Consulter le journal d’audit : qui a fait quoi, quand, avec quel avant/après",
	},
	// ─── admin ───
	{
		Key:         OperatorsManage,
		Category:    "admin",
		Description: "Créer, désactiver des opérateurs et leur attribuer des rôles",
	},
	{
		Key:         RolesManage,
		Category:    "admin",
		Description: "Créer et modifier des rôles, c’est-à-dire redistribuer toutes les permissions",
	},
}

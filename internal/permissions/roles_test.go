package permissions_test

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// La table de vérité du §6.10, **transcrite à la main depuis la spécification** et non dérivée du
// code qu'elle garde. C'est la condition pour qu'elle voie une dérive : une porte dont les cas
// viennent de la donnée qu'elle contrôle ne dit jamais que cette donnée a bougé.
//
// Chaque ligne est une lecture littérale de la prose du §6.10, et les arbitrages qu'elle ne tranche
// pas mécaniquement sont écrits dans DN-3 de la fiche, avec la phrase qui les décide. Les relire
// avant de toucher à cette table : un rôle trop étroit produit une demande qu'on traite, un rôle
// trop large accorde en silence exactement ce qu'il existe pour interdire.
//
// `super_admin` n'y figure pas : le §6.10 dit « toutes les permissions », donc il se dérive du
// catalogue et se vérifie autrement — l'écrire ici demanderait de recopier les 44 clés, et cette
// copie-là ne dirait rien de plus que le catalogue.
var specRoles = map[string][]permissions.Key{
	// « Lecture/écriture routage (dont numéros exacts, routes:import), connecteurs (dont
	// connectors:rebind), sessions, anti-spam, scripts (dont scripts:publish), réécriture, numéros
	// entrants ; suppressions:read/write sans :delete ; alerts:read/write ; cdr:read_pii et
	// cdr:export_bulk ; lecture seule facturation/audit »
	"ops": {
		permissions.RoutesRead, permissions.RoutesWrite, permissions.RoutesImport,
		permissions.ScriptsRead, permissions.ScriptsWrite, permissions.ScriptsPublish,
		permissions.SenderRewriteRead, permissions.SenderRewriteWrite,
		permissions.ConnectorsRead, permissions.ConnectorsWrite, permissions.ConnectorsRebind,
		permissions.SessionsRead, permissions.SessionsDisconnect,
		permissions.AntispamRead, permissions.AntispamWrite,
		permissions.InboundRead, permissions.InboundWrite,
		permissions.SuppressionsRead, permissions.SuppressionsWrite,
		permissions.AlertsRead, permissions.AlertsWrite,
		permissions.CDRReadPII, permissions.CDRExportBulk,
		permissions.BillingRead, permissions.AuditRead,
	},

	// « scripts:read/write (pas publish — revue par ops/super_admin) »
	"script_author": {
		permissions.ScriptsRead, permissions.ScriptsWrite,
	},

	// « Lecture seule (comptes, routage, connecteurs, sessions, CDR/trace, facturation, alertes) +
	// cdr:read_pii — hors secrets d'identifiants, code source de script, réécriture, et corps des
	// messages (content:read jamais implicite) »
	"support_readonly": {
		permissions.CustomersRead, permissions.AccountsRead, permissions.GroupsRead,
		permissions.RoutesRead, permissions.ConnectorsRead, permissions.SessionsRead,
		permissions.BillingRead, permissions.AlertsRead,
		permissions.CDRReadPII,
	},

	// « Facturation complète (billing:read/write/topup/provider:write/scope_change), lecture seule
	// ailleurs (mêmes exclusions que support_readonly, et sans cdr:read_pii) »
	"billing_admin": {
		permissions.BillingRead, permissions.BillingWrite, permissions.BillingTopup,
		permissions.BillingProviderWrite, permissions.BillingScopeChange,
		permissions.CustomersRead, permissions.AccountsRead, permissions.GroupsRead,
		permissions.RoutesRead, permissions.ConnectorsRead, permissions.SessionsRead,
		permissions.AlertsRead,
	},

	// « billing:read uniquement »
	"billing_readonly": {
		permissions.BillingRead,
	},

	// « customers:read/write, accounts:read/write, credentials:read/write/rotate, groups:read/write,
	// billing:read/write/scope_change ; pas de routage/connecteur/fournisseur de facturation, pas de
	// billing:topup »
	"account_manager": {
		permissions.CustomersRead, permissions.CustomersWrite,
		permissions.AccountsRead, permissions.AccountsWrite,
		permissions.CredentialsRead, permissions.CredentialsWrite, permissions.CredentialsRotate,
		permissions.GroupsRead, permissions.GroupsWrite,
		permissions.BillingRead, permissions.BillingWrite, permissions.BillingScopeChange,
	},

	// « suppressions:read/write/delete, inbound:read, gdpr:erase, content:erase, lecture seule
	// comptes/CDR, cdr:read_pii, cdr:export_bulk. […] Pas de content:read par défaut »
	"compliance": {
		permissions.SuppressionsRead, permissions.SuppressionsWrite, permissions.SuppressionsDelete,
		permissions.InboundRead,
		permissions.GDPRErase, permissions.ContentErase,
		permissions.CustomersRead, permissions.AccountsRead, permissions.GroupsRead,
		permissions.CDRReadPII, permissions.CDRExportBulk,
	},

	// « audit:read uniquement — pas cdr:read_pii »
	"auditor": {
		permissions.AuditRead,
	},
}

// specRoleCount est le plancher de la table ci-dessus, `super_admin` compris. Il n'est pas
// décoratif : la même forme a déjà servi dans `internal/store/base_test.go`, où un inventaire vidé
// laissait son contrôle **vert** — il passait en n'ayant rien cherché.
const specRoleCount = 9

// deliberateOrphans sont les trois clés que le §6.10 laisse hors de tout rôle par défaut sauf
// `super_admin`, et il dit pourquoi : `content:read` n'est jamais implicite — elle s'accorde par un
// rôle taillé pour un opérateur nommé ; `operators:manage` et `roles:manage` parce que qui peut
// éditer les rôles peut s'accorder tout le reste.
//
// Elles sont énumérées ici en toutes lettres plutôt que calculées : toute **autre** clé orpheline
// est un oubli, et un oubli n'a aucun symptôme visible — la clé existe, l'écran l'affiche, et
// personne ne peut l'exercer.
var deliberateOrphans = []permissions.Key{
	permissions.ContentRead,
	permissions.OperatorsManage,
	permissions.RolesManage,
}

func TestChaqueRoleParDefautAccordeExactementCeQueLaSpecDit(t *testing.T) {
	t.Parallel()

	require.Len(t, specRoles, specRoleCount-1,
		"la table de vérité porte %d rôle(s) hors super_admin pour %d attendus : ce contrôle ne "+
			"regarde plus les rôles que le §6.10 décrit", len(specRoles), specRoleCount-1)

	granted := grantsByRole(t)

	for name, expected := range specRoles {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			actual, exists := granted[name]
			require.True(t, exists, "le rôle par défaut %q n'existe pas : le §6.10 le donne pour "+
				"pré-rempli et non supprimable", name)

			// Les deux sens, et deux messages distincts. Une comparaison qui ne tiendrait que
			// l'inclusion resterait verte sur une clé accordée en trop — or c'est ce sens-là qui
			// accorde en silence.
			assert.Empty(t, missing(expected, actual),
				"%s n'accorde pas ce que le §6.10 lui donne : %v", name, missing(expected, actual))
			assert.Empty(t, missing(actual, expected),
				"%s accorde ce que le §6.10 ne lui donne pas : %v", name, missing(actual, expected))
		})
	}
}

// Le §6.10 dit « toutes les permissions » : `super_admin` est donc dérivé du catalogue, et cette
// égalité est ce qui le tient. Une clé ajoutée au catalogue par une release future lui revient
// d'office — sans quoi le propriétaire du produit perdrait l'accès à ce que la release ajoute, et
// ne pourrait même pas se l'accorder, `roles:manage` étant une de ces clés.
func TestSuperAdminEstExactementLeCatalogue(t *testing.T) {
	t.Parallel()

	granted := grantsByRole(t)

	actual, exists := granted["super_admin"]
	require.True(t, exists, "le rôle super_admin n'existe pas")

	all := make([]permissions.Key, 0, len(permissions.All()))
	for _, entry := range permissions.All() {
		all = append(all, entry.Key)
	}

	assert.Empty(t, missing(all, actual), "super_admin n'a pas %v", missing(all, actual))
	assert.Empty(t, missing(actual, all), "super_admin accorde %v, hors catalogue", missing(actual, all))
}

func TestAucuneCleOrphelineHorsDesTroisDeliberees(t *testing.T) {
	t.Parallel()

	held := map[permissions.Key]bool{}

	for _, role := range permissions.DefaultRoles() {
		if role.Name == "super_admin" {
			continue
		}

		for _, key := range role.Keys {
			held[key] = true
		}
	}

	var orphans []permissions.Key

	for _, entry := range permissions.All() {
		if !held[entry.Key] {
			orphans = append(orphans, entry.Key)
		}
	}

	assert.ElementsMatch(t, deliberateOrphans, orphans,
		"les clés qu'aucun rôle par défaut ne détient hors super_admin ne sont plus les trois que le "+
			"§6.10 laisse orphelines délibérément : une clé orpheline par oubli est inaccessible à "+
			"tous, sans qu'aucun écran ne le dise")
}

// Le sens inverse du catalogue : `Key` a `string` pour sous-jacent, donc `Key("routes:raed")` écrit
// dans un rôle **compile**. La faute de frappe accorderait alors une permission que personne
// n'exige, et retirerait en silence celle qu'on croyait donner.
func TestAucunRoleNAccordeUneCleHorsCatalogue(t *testing.T) {
	t.Parallel()

	catalogued := map[permissions.Key]bool{}
	for _, entry := range permissions.All() {
		catalogued[entry.Key] = true
	}

	for _, role := range permissions.DefaultRoles() {
		for _, key := range role.Keys {
			assert.True(t, catalogued[key],
				"le rôle %s accorde %q, qui n'est pas au catalogue", role.Name, key)
		}
	}
}

func TestChaqueRoleParDefautPorteUneDescription(t *testing.T) {
	t.Parallel()

	require.Len(t, permissions.DefaultRoles(), specRoleCount)

	for _, role := range permissions.DefaultRoles() {
		assert.NotEmpty(t, role.Description,
			"le rôle %s n'a pas de description : l'écran de gestion des rôles n'aurait rien à "+
				"afficher pour expliquer ce qu'il fait", role.Name)
		assert.NotEmpty(t, role.Keys, "le rôle %s n'accorde rien", role.Name)
	}
}

// Même défaut que celui déjà mesuré sur `All()` : les rôles sont un `var` de package, donc un
// appelant qui recevrait la structure elle-même pourrait réécrire la politique d'autorisation pour
// tout le process — y compris pour les gardes. La tranche de clés est imbriquée : la cloner est ce
// qui distingue une copie profonde d'une copie qui n'en est pas une.
func TestDefaultRolesRendUneCopieEtNonLaPolitiqueElleMeme(t *testing.T) {
	t.Parallel()

	first := permissions.DefaultRoles()
	require.NotEmpty(t, first)
	require.NotEmpty(t, first[0].Keys)

	first[0].Name = "usurpé"
	first[0].Keys[0] = permissions.RolesManage

	second := permissions.DefaultRoles()

	assert.NotEqual(t, "usurpé", second[0].Name, "un appelant a renommé un rôle pour tout le process")
	assert.NotEqual(t, permissions.RolesManage, second[0].Keys[0],
		"un appelant a accordé roles:manage à un rôle pour tout le process")
}

// grantsByRole indexe les rôles par leur nom, en refusant un doublon : deux entrées du même nom
// laisseraient la table de vérité verte en ne contrôlant que la dernière, et le seed échouerait plus
// tard sur la contrainte d'unicité — loin d'ici.
func grantsByRole(t *testing.T) map[string][]permissions.Key {
	t.Helper()

	byName := make(map[string][]permissions.Key, len(permissions.DefaultRoles()))

	for _, role := range permissions.DefaultRoles() {
		_, duplicate := byName[role.Name]
		require.False(t, duplicate, "le rôle %q est déclaré deux fois", role.Name)

		byName[role.Name] = role.Keys
	}

	return byName
}

// missing rend ce que `expected` porte et que `actual` n'a pas.
func missing(expected, actual []permissions.Key) []permissions.Key {
	var absent []permissions.Key

	for _, key := range expected {
		if !slices.Contains(actual, key) {
			absent = append(absent, key)
		}
	}

	return absent
}

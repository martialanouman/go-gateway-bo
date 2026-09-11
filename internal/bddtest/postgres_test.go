package bddtest_test

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/bddtest"
)

// orphanPID désigne un processus que la machine ne porte pas : au-delà de toute valeur qu'un système
// attribue. Un numéro tiré au hasard dans la plage courante en désignerait parfois un vivant, et le
// cas basculerait selon l'ordonnanceur plutôt que selon ce qu'il décrit.
const orphanPID = 1 << 30

// `Discardable` décide de ce que le harnais **détruit**, et c'est la seule raison pour laquelle elle
// a un test à elle : le nettoyage d'ouverture jette des bases, et une porte trop large jette celles
// des autres.
//
// Elle est fermée par défaut depuis une revue, et non par construction. La version d'avant retenait
// ses candidates par `datname LIKE 'store_test_%'`, où `_` est un **joker** SQL, puis lisait le PID
// d'un nom dont rien ne garantissait la forme : un nom illisible rendait zéro, que nul processus ne
// porte, donc « fini », donc jetable. Mesuré plutôt que supposé — une base `storeXtestY_1` créée pour
// l'occasion a bien été supprimée.
func TestCeQueLeHarnaisSAutoriseAJeter(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		database string
		prefix   string
		want     bool
	}{
		"une base de cette suite, dont le processus est fini": {
			database: fmt.Sprintf("store_test_%d_7", orphanPID),
			prefix:   "store",
			want:     true,
		},
		"une base de cette suite, dont le processus vit encore": {
			database: fmt.Sprintf("store_test_%d_7", os.Getpid()),
			prefix:   "store",
			want:     false,
		},
		"une base étrangère que le joker `_` d'un LIKE retenait": {
			database: fmt.Sprintf("storeXtestY_%d_1", orphanPID),
			prefix:   "store",
			want:     false,
		},
		"une base d'une autre suite du module": {
			database: fmt.Sprintf("dashboard_test_%d_1", orphanPID),
			prefix:   "store",
			want:     false,
		},
		"la base d'administration elle-même": {
			database: "dashboard",
			prefix:   "dashboard",
			want:     false,
		},
		"un nom sans compteur, donc d'une forme que le harnais ne donne pas": {
			database: fmt.Sprintf("store_test_%d", orphanPID),
			prefix:   "store",
			want:     false,
		},
		"un nom dont le PID n'est pas un nombre": {
			database: "store_test_camille_1",
			prefix:   "store",
			want:     false,
		},
		"un PID nul, que nul processus ne porte": {
			database: "store_test_0_1",
			prefix:   "store",
			want:     false,
		},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			assert.Equal(t, testCase.want, bddtest.Discardable(testCase.database, testCase.prefix))
		})
	}
}

// Les deux fonctions ne se parlent que par la **forme du nom**, et rien d'autre ne les relie : changer
// celle que [bddtest.DatabaseName] distribue sans toucher à [bddtest.Discardable] rendrait le
// nettoyage silencieusement inopérant, sur une suite qui resterait verte.
func TestCeQueLeHarnaisNommeEstCeQuIlSaitReconnaitre(t *testing.T) {
	t.Parallel()

	mien := bddtest.DatabaseName("store")

	assert.False(t, bddtest.Discardable(mien, "store"),
		"le nettoyage jetterait la base du processus qui vient de la demander")

	orphelin := strings.Replace(mien, strconv.Itoa(os.Getpid()), strconv.Itoa(orphanPID), 1)
	require.NotEqual(t, mien, orphelin, "le nom distribué ne porte plus le PID qui l'a demandé")

	assert.True(t, bddtest.Discardable(orphelin, "store"),
		"le nettoyage ne reconnaît plus les noms que le harnais distribue")
}

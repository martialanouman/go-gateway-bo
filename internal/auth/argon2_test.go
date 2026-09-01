package auth_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
)

func TestUnHachageSeVerifieAvecLeSecretQuiLAProduit(t *testing.T) {
	t.Parallel()

	encoded, err := auth.Hash("un mot de passe d'opérateur")
	require.NoError(t, err)

	ok, err := auth.Verify(encoded, "un mot de passe d'opérateur")
	require.NoError(t, err)
	assert.True(t, ok, "le mot de passe qui a produit ce hachage ne le vérifie pas : personne ne peut plus entrer")
}

func TestUnSecretFauxNeVerifiePas(t *testing.T) {
	t.Parallel()

	encoded, err := auth.Hash("le bon")
	require.NoError(t, err)

	ok, err := auth.Verify(encoded, "le mauvais")
	require.NoError(t, err)
	assert.False(t, ok, "un mot de passe faux vérifie : le premier facteur n'en est plus un")
}

// Le sel est ce qui empêche deux opérateurs qui ont choisi le même mot de passe d'être visibles comme
// tels dans la base — et une table précalculée de les retrouver tous les deux d'un coup.
func TestDeuxHachagesDuMemeSecretDifferentParLeSel(t *testing.T) {
	t.Parallel()

	first, err := auth.Hash("le même")
	require.NoError(t, err)

	second, err := auth.Hash("le même")
	require.NoError(t, err)

	assert.NotEqual(t, first, second, "deux hachages du même secret sont identiques : le sel ne varie pas")
}

// C'est la propriété que l'encodage PHC existe pour porter : les paramètres voyagent avec le hachage,
// donc les relever n'invalide pas ce qui a été produit avant. Sans elle, un relèvement fermerait la
// porte à tous les opérateurs déjà inscrits.
func TestUnHachageProduitAvecDAnciensParametresResteVerifiableApresRelevement(t *testing.T) {
	t.Parallel()

	faibles := auth.Params{Memory: 8 * 1024, Time: 1, Parallelism: 1}
	require.NotEqual(t, auth.CurrentParams(), faibles, "ce test ne prouve rien si les deux jeux coïncident")

	ancien, err := auth.HashWith(faibles, "un mot de passe d'avant le relèvement")
	require.NoError(t, err)

	ok, err := auth.Verify(ancien, "un mot de passe d'avant le relèvement")
	require.NoError(t, err)
	assert.True(t, ok, "Verify a utilisé les paramètres courants au lieu de ceux de l'encodage : "+
		"tout relèvement fermerait la porte aux opérateurs déjà inscrits")
}

func TestUnEncodagePHCPorteLesParametresQuiLOntProduit(t *testing.T) {
	t.Parallel()

	params := auth.Params{Memory: 8 * 1024, Time: 2, Parallelism: 3}

	encoded, err := auth.HashWith(params, "peu importe")
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(encoded, "$argon2id$v=19$m=8192,t=2,p=3$"),
		"l'encodage ne porte pas ses paramètres en clair : %s", encoded)

	// Cinq champs après le `$` de tête : l'algorithme, la version, les paramètres, le sel, le hachage.
	assert.Len(t, strings.Split(encoded, "$"), 6, "la forme PHC n'a pas ses cinq champs : %s", encoded)
}

// Une chaîne illisible n'est pas « un mot de passe faux » : c'est une ligne de base abîmée, et la
// confondre avec un refus normal ferait qu'un `password_hash` tronqué se lirait comme une erreur de
// frappe de l'opérateur — qui retenterait indéfiniment pendant que personne ne regarde la base.
func TestUnEncodageIllisibleEstUneErreurEtNonUnRefus(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"une chaîne vide":                 "",
		"un encodage tronqué":             "$argon2id$v=19$m=65536,t=3,p=4$c2VsCg",
		"un algorithme inconnu":           "$argon2i$v=19$m=65536,t=3,p=4$c2VsCg$aGFjaGUK",
		"une version inconnue":            "$argon2id$v=16$m=65536,t=3,p=4$c2VsCg$aGFjaGUK",
		"des paramètres illisibles":       "$argon2id$v=19$m=beaucoup,t=3,p=4$c2VsCg$aGFjaGUK",
		"un sel qui n'est pas du base64":  "$argon2id$v=19$m=65536,t=3,p=4$pas du base64$aGFjaGUK",
		"un hachage qui n'est pas du b64": "$argon2id$v=19$m=65536,t=3,p=4$c2VsCg$pas du base64",
		"un mot de passe hérité en clair": "motdepasse",
	}

	for name, encoded := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			ok, err := auth.Verify(encoded, "peu importe")
			require.Error(t, err, "cet encodage est accepté comme lisible")
			assert.False(t, ok, "un encodage illisible ne doit jamais vérifier")
		})
	}
}

// `argon2.IDKey` ne rend jamais d'erreur sur des coûts aberrants, et il ne réagit pas de la même
// façon aux trois. `t=0` et `p=0` le font **paniquer** (x/crypto v0.54.0, `deriveKey` — « number of
// rounds too small », « parallelism degree too low ») : une ligne de base abîmée arriverait jusqu'au
// handler sous forme de panic, sur une route que n'importe qui peut appeler sans être authentifié.
// `m=0`, lui, est **écrêté** en silence, donc le hachage serait vérifié avec des paramètres qui ne
// sont pas les siens. Les trois se refusent avant l'appel, pour ces deux raisons distinctes.
//
// Les cas se fabriquent en abîmant un encodage **réel** plutôt qu'en en écrivant un à la main : un
// littéral inventé serait refusé pour une autre raison que celle qu'on croit tester, et le test
// resterait vert en ne prouvant rien.
func TestDesCoutsNulsSontRefusesPlutotQueDeFairePaniquer(t *testing.T) {
	t.Parallel()

	sain, err := auth.HashWith(auth.Params{Memory: 8 * 1024, Time: 2, Parallelism: 2}, "peu importe")
	require.NoError(t, err)

	cases := map[string]string{
		"aucune passe":   strings.Replace(sain, "t=2", "t=0", 1),
		"aucune voie":    strings.Replace(sain, "p=2", "p=0", 1),
		"aucune mémoire": strings.Replace(sain, "m=8192", "m=0", 1),
	}

	for name, encoded := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			require.NotEqual(t, sain, encoded, "la substitution n'a rien remplacé : ce cas ne teste rien")

			ok, err := auth.Verify(encoded, "peu importe")
			require.Error(t, err, "ces coûts sont acceptés : t=0 et p=0 feraient paniquer argon2.IDKey, et m=0 "+
				"ferait vérifier avec des paramètres écrêtés qui ne sont pas ceux du hachage")
			assert.False(t, ok)
		})
	}
}

// Le pendant en écriture : produire avec des coûts nuls doit être refusé aussi, sinon la panique
// arrive à la création du compte au lieu de la vérification.
func TestHacherAvecDesCoutsNulsEstRefuse(t *testing.T) {
	t.Parallel()

	_, err := auth.HashWith(auth.Params{Memory: 8 * 1024, Time: 0, Parallelism: 1}, "peu importe")
	require.Error(t, err)
}

// Le plancher, et non la mesure. La durée mesurée est **écrite** au-dessus de `currentParams`
// (critère 4) : un test qui l'affirmerait serait rouge un jour sur dix sur un runner partagé.
//
// Ce que ce test garde est le défaut qui arrive vraiment : quelqu'un abaisse les coûts pour faire
// passer une suite qu'il trouve lente, et personne ne le voit — un hachage moins cher n'a aucun
// symptôme, il est juste moins cher pour tout le monde, l'attaquant compris.
//
// **Le plancher est le profil retenu depuis step-031, plus celui d'OWASP.** Le second laissait
// descendre de 64 MiB / t=3 à 19 MiB / t=2 — de 26,3 ms à 16,8 ms au tableau qui surplombe
// `currentParams` — sans faire rougir quoi que ce soit : il bornait ce qu'argon2id doit rester, pas
// ce que ce déploiement a décidé. Ce qu'il garde désormais est la décision, et la changer demande
// une mesure neuve plutôt qu'un chiffre plus commode.
func TestLesParametresNeDescendentPasSousLePlancher(t *testing.T) {
	t.Parallel()

	params := auth.CurrentParams()

	assert.GreaterOrEqual(t, params.Memory, uint32(64*1024),
		"moins de 64 MiB : c'est la mémoire qui rend une carte graphique inintéressante, pas les "+
			"passes, et 64 est le profil que la mesure du 10/08/2026 a retenu")
	assert.GreaterOrEqual(t, params.Time, uint32(3), "moins de trois passes que le profil retenu")
	assert.GreaterOrEqual(t, params.Parallelism, uint8(4),
		"moins de quatre voies que le profil retenu ; en-dessous de une, argon2.IDKey paniquerait")
}

// VerifyDummy n'a aucun effet observable : ce qu'il achète est du **temps**, et c'est ce que ce test
// ne peut pas prouver. La mesure est **manuelle, contre le binaire**, et vit au-dessus de
// `VerifyDummy` dans `argon2.go` ; le constat est dans le tableau des mutations de la fiche, section
// « La route ». (`mesure_test.go` mesure `Verify`, jamais `VerifyDummy`.)
// Ce test-ci ne garde qu'une chose : qu'il existe et qu'il ne panique pas sur un secret quelconque.
func TestLeHachageFacticeSExecuteSurNImporteQuelSecret(t *testing.T) {
	t.Parallel()

	assert.NotPanics(t, func() { auth.VerifyDummy("") })
	assert.NotPanics(t, func() { auth.VerifyDummy("un mot de passe quelconque") })
}

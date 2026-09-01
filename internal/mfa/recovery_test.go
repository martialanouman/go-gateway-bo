package mfa_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/mfa"
)

// La forme affichée : deux groupes de cinq symboles de l'alphabet de Crockford. `I`, `L`, `O` et `U`
// en sont absents — les trois premiers parce qu'on les transcrit de travers, le quatrième parce que
// la spécification de Crockford l'écarte.
var recoveryCodeShape = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$`)

func TestDixCodesDeRecuperationSontRemisAlEnrolement(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	require.Len(t, enrollment.RecoveryCodes, mfa.RecoveryCodeCount)
	require.Len(t, enrollment.RecoveryCodeHashes, mfa.RecoveryCodeCount)

	distinct := make(map[string]struct{}, mfa.RecoveryCodeCount)

	for index, code := range enrollment.RecoveryCodes {
		assert.Regexp(t, recoveryCodeShape, code)
		distinct[code] = struct{}{}

		// Le hachage porte la valeur **normalisée**, pas la forme affichée : c'est ce qui permet à un
		// opérateur de recopier avec ou sans le tiret.
		ok, err := auth.Verify(enrollment.RecoveryCodeHashes[index], mfa.NormalizeRecoveryCode(code))
		require.NoError(t, err)
		assert.True(t, ok, "le hachage rangé ne correspond pas au code remis, au même index")
	}

	assert.Len(t, distinct, mfa.RecoveryCodeCount, "deux codes remis sont identiques")
}

// Ce qui va en base ne permet pas de reconstituer ce qui a été remis.
func TestUnHachageDeCodeNeContientPasLeCode(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	for index, hash := range enrollment.RecoveryCodeHashes {
		assert.NotContains(t, hash, enrollment.RecoveryCodes[index])
		assert.NotContains(t, hash, mfa.NormalizeRecoveryCode(enrollment.RecoveryCodes[index]))
	}
}

// Un opérateur recopie ce qu'il a sous les yeux, pas ce que le serveur a haché. Les six formes
// ci-dessous sont celles qu'on obtient en recopiant à la main.
func TestUnCodeEstAccepteQuelleQueSoitSaMiseEnForme(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	code := enrollment.RecoveryCodes[3]

	for name, presented := range map[string]string{
		"tel qu'affiché":      code,
		"sans le tiret":       strings.ReplaceAll(code, "-", ""),
		"en minuscules":       strings.ToLower(code),
		"avec des espaces":    " " + strings.ReplaceAll(code, "-", " ") + " ",
		"avec un autre trait": strings.ReplaceAll(code, "-", "_"),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			assert.Equal(t, 3, mfa.MatchRecoveryCode(enrollment.RecoveryCodeHashes, presented))
		})
	}
}

// Les trois confusions que l'alphabet existe pour absorber. Un opérateur qui lit `1` et tape `I` doit
// entrer : c'est exactement ce que l'exclusion de ces lettres rend possible sans ambiguïté.
func TestLesConfusionsDeCrockfordSontResolues(t *testing.T) {
	t.Parallel()

	for name, cas := range map[string]struct{ presented, expected string }{
		"I pour 1": {"IJKMN-PQRST", "1JKMNPQRST"},
		"L pour 1": {"LJKMN-PQRST", "1JKMNPQRST"},
		"O pour 0": {"0JKMN-PQRSO", "0JKMNPQRS0"},
	} {
		presented, expected := cas.presented, cas.expected

		t.Run(name, func(t *testing.T) {
			t.Parallel()

			// **La correspondance, et pas seulement l'absence.** Une version précédente n'exigeait que
			// « ni I, ni L, ni O » et une longueur de dix : mesuré le 12/08/2026, `I,L → 7` et `O → 9` la
			// laissaient verte. Or ce que ces lettres deviennent est tout l'objet — un opérateur qui lit
			// `1` et tape `I` doit entrer.
			assert.Equal(t, expected, mfa.NormalizeRecoveryCode(presented))
		})
	}
}

// La normalisation est **la même** à l'écriture et à la lecture. Deux normalisations distinctes
// feraient hacher une valeur et en chercher une autre, et le symptôme serait un code qui ne marche
// jamais.
func TestLaNormalisationEstIdempotente(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	for _, code := range enrollment.RecoveryCodes {
		once := mfa.NormalizeRecoveryCode(code)
		assert.Equal(t, once, mfa.NormalizeRecoveryCode(once))
	}
}

func TestUnCodeInconnuNeMatcheAucunHachage(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	for name, presented := range map[string]string{
		"un code jamais remis": "ZZZZZ-ZZZZZ",
		"vide":                 "",
		"la forme seule":       "-",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			assert.Equal(t, -1, mfa.MatchRecoveryCode(enrollment.RecoveryCodeHashes, presented))
		})
	}
}

// La boucle ne court-circuite pas, et ce test **observe l'effet** plutôt que la forme du code : toute
// sortie anticipée rend le **premier** rang qui colle, quand la boucle entière rend le **dernier**,
// puisqu'elle écrase `matched` jusqu'au bout. Ce qui est en jeu est la durée du verdict — vingt-six
// millisecondes par code restant, soit jusqu'à un quart de seconde d'écart entre le premier rang et
// le dixième, ce qui dit *lequel* a servi.
//
// **Une porte structurelle a été écrite d'abord, puis retirée** : elle cherchait l'absence de
// `return`, `break` et `goto` dans le corps de la première boucle, et trois réécritures mesurées le
// 01/09/2026 la laissaient verte — une boucle de pré-traitement placée avant elle, un `continue`
// gardé par `matched`, un `matched < 0` dans la condition du `for`. La propriété n'est pas une forme :
// c'est que `auth.Verify` soit payé autant de fois quel que soit le rang.
//
// Ce que ce test ne distingue pas, et c'est assumé : une réécriture qui garderait le coût entier mais
// rendrait le premier rang — `if matched < 0 { matched = index }`. Elle rougirait à tort. Aucune des
// réécritures observées ne prend cette forme.
func TestLaBoucleDesCodesDeRecuperationNeCourtCircuitePas(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	// Deux hachages du **même** code, aux deux bouts de la liste : deux sels, donc deux lignes
	// distinctes que `auth.Verify` accepte l'une comme l'autre.
	duplicate, err := auth.Hash(mfa.NormalizeRecoveryCode(enrollment.RecoveryCodes[0]))
	require.NoError(t, err)

	hashes := append(append([]string{}, enrollment.RecoveryCodeHashes...), duplicate)

	assert.Equal(t, len(hashes)-1, mfa.MatchRecoveryCode(hashes, enrollment.RecoveryCodes[0]),
		"la boucle rend le premier rang qui colle et non le dernier : elle s'arrête donc dès qu'elle "+
			"a trouvé, et la durée du verdict dit à quel rang le code présenté se trouvait")
}

// Une ligne abîmée ne fait pas échouer la confrontation des neuf autres : un opérateur dont un code
// est illisible en base doit pouvoir entrer avec les autres.
func TestUnHachageIllisibleNEmpechePasLesAutresDeMatcher(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	hashes := append([]string{"ceci n'est pas du PHC"}, enrollment.RecoveryCodeHashes...)

	assert.Equal(t, 1, mfa.MatchRecoveryCode(hashes, enrollment.RecoveryCodes[0]))
}

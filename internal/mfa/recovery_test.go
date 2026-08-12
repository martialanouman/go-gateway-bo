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

	for name, presented := range map[string]string{
		"I pour 1": "IJKMN-PQRST",
		"L pour 1": "LJKMN-PQRST",
		"O pour 0": "0JKMN-PQRSO",
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			normalized := mfa.NormalizeRecoveryCode(presented)

			assert.NotContains(t, normalized, "I")
			assert.NotContains(t, normalized, "L")
			assert.NotContains(t, normalized, "O")
			assert.Len(t, normalized, 10)
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

// Une ligne abîmée ne fait pas échouer la confrontation des neuf autres : un opérateur dont un code
// est illisible en base doit pouvoir entrer avec les autres.
func TestUnHachageIllisibleNEmpechePasLesAutresDeMatcher(t *testing.T) {
	t.Parallel()

	_, enrollment := testEnrollment(t)

	hashes := append([]string{"ceci n'est pas du PHC"}, enrollment.RecoveryCodeHashes...)

	assert.Equal(t, 1, mfa.MatchRecoveryCode(hashes, enrollment.RecoveryCodes[0]))
}

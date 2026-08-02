package bff_test

import (
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// buildFixture compile un paquet de `testdata/` et rend la sortie du compilateur. Ces paquets sont
// invisibles de la suite normale — mesuré : `go list ./...` ne les énumère pas et `go vet ./...` n'en
// signale rien — mais `go build` les compile dès qu'on lui en donne le chemin explicite. C'est ce qui
// permet à `divergent` d'être rouge en permanence sans balise de compilation ni skip, donc sans rien
// qui puisse passer pour vert.
func buildFixture(t *testing.T, name string) (string, error) {
	t.Helper()

	output, err := exec.CommandContext(t.Context(), "go", "build", "./testdata/"+name+"/").CombinedOutput()

	return string(output), err
}

// Un handler dont la signature diverge de l'interface engendrée ne compile pas. La porte asserte le
// **message** et non le seul code de sortie : mesuré pendant la conception, une première version du
// fixture échouait bel et bien — mais sur un `undefined: context`, un import oublié. Un test qui
// n'aurait regardé que l'échec l'aurait accepté et n'aurait plus rien gardé.
//
// Le témoin positif n'est pas décoratif : sans lui, un harnais cassé — mauvais chemin, `go`
// introuvable, `testdata/` déplacé — ferait échouer les deux fixtures et laisserait la porte verte.
func TestDivergentHandlerSignatureFailsToCompile(t *testing.T) {
	t.Parallel()

	t.Run("la signature divergente est refusée par le compilateur", func(t *testing.T) {
		t.Parallel()

		output, err := buildFixture(t, "divergent")

		require.Error(t, err, "le fixture divergent a compilé, la garantie du contrat ne tient plus")
		assert.Contains(t, output, "does not implement bff.StrictServerInterface")
		assert.Contains(t, output, "wrong type for method Health")
	})

	t.Run("le témoin conforme compile, preuve que le harnais mesure quelque chose", func(t *testing.T) {
		t.Parallel()

		output, err := buildFixture(t, "conforme")

		require.NoError(t, err, "le témoin positif ne compile pas : %s", output)
		assert.Empty(t, output)
	})
}

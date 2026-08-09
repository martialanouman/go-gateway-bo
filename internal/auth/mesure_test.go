package auth_test

import (
	"fmt"
	"testing"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
)

// Le protocole qui fonde `currentParams`, pour qu'un relecteur puisse le rejouer plutôt que de croire
// un chiffre :
//
//	go test ./internal/auth/ -run '^$' -bench BenchmarkVerification -benchtime 5x
//
// Un **benchmark** et non un test, et la distinction n'est pas cosmétique : un test qui mesure sans
// rien affirmer est vert quoi qu'il mesure, et un test qui affirme une durée est instable sur un
// runner partagé. `go test` ne lance pas les benchmarks, donc `make check` ne paie pas ces secondes
// et la CI ne rougit pas sur la charge d'une machine voisine.
//
// `-benchtime 5x` parce que la grandeur cherchée est de l'ordre de la centaine de millisecondes : le
// défaut d'une seconde ferait des dizaines de tours pour une précision dont on n'a que faire — on
// choisit entre 60 ms et 400 ms, pas entre 250 et 252.
//
// **Relevé du 09/08/2026**, machine de développement (Apple Silicon, Go 1.26.5), report dans DN-5 de
// la fiche step-021. Ce qui est retenu est le jeu le plus proche de 250 ms à 64 MiB.
func BenchmarkVerification(b *testing.B) {
	candidates := []auth.Params{
		{Memory: 19 * 1024, Time: 2, Parallelism: 1},
		{Memory: 64 * 1024, Time: 1, Parallelism: 4},
		{Memory: 64 * 1024, Time: 2, Parallelism: 4},
		{Memory: 64 * 1024, Time: 3, Parallelism: 4},
		{Memory: 64 * 1024, Time: 4, Parallelism: 4},
		{Memory: 128 * 1024, Time: 3, Parallelism: 4},
		{Memory: 256 * 1024, Time: 3, Parallelism: 4},
		{Memory: 256 * 1024, Time: 6, Parallelism: 4},
		{Memory: 512 * 1024, Time: 3, Parallelism: 4},
		{Memory: 64 * 1024, Time: 12, Parallelism: 4},
	}

	for _, params := range candidates {
		// La vérification et non le hachage : c'est elle que paie chaque tentative de connexion, donc
		// elle qui décide de ce que coûte une attaque. Le hachage, lui, n'a lieu qu'à la création.
		encoded, err := auth.HashWith(params, "un mot de passe d'opérateur")
		if err != nil {
			b.Fatal(err)
		}

		b.Run(fmt.Sprintf("m=%dMiB/t=%d/p=%d", params.Memory/1024, params.Time, params.Parallelism),
			func(b *testing.B) {
				for b.Loop() {
					if _, err := auth.Verify(encoded, "un mot de passe d'opérateur"); err != nil {
						b.Fatal(err)
					}
				}
			})
	}
}

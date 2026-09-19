package auth_test

import (
	"context"
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
// **Relevé du 10/08/2026**, machine de développement (Apple M4 Pro, Go 1.26.5), report dans **DN-4**
// de la fiche step-021. Les dix profils, tous, parce qu'un tableau qui choisit ses lignes n'étaye
// plus le choix qu'il justifie :
//
//	 64 MiB · t=1  · p=4     8,5 ms
//	 19 MiB · t=2  · p=1    16,8 ms
//	 64 MiB · t=2  · p=4    17,7 ms
//	 64 MiB · t=3  · p=4    26,3 ms   ← retenu, et c'est `currentParams`
//	 64 MiB · t=4  · p=4    35,4 ms
//	128 MiB · t=3  · p=4    57,9 ms
//	 64 MiB · t=12 · p=4   108,3 ms
//	256 MiB · t=3  · p=4   123,8 ms
//	256 MiB · t=6  · p=4   252,1 ms
//	512 MiB · t=3  · p=4   258,7 ms
//
// La cible de 250 ms à 64 MiB que visait la fiche a été **abandonnée** : les deux ne coexistent pas,
// et la colonne des passes le montre — à 64 MiB le temps est linéaire en `t`, 8,5 ms la passe, donc
// 250 ms demanderait une trentaine de passes, un profil que la RFC ne décrit nulle part. C'est la
// mémoire qui a été gardée, parce que c'est elle qui défend : une carte graphique aligne des milliers
// de cœurs mais pas des milliers de fois 64 MiB de mémoire rapide, là où des passes n'achètent qu'un
// facteur linéaire que le même matériel rattrape.
//
// Ce qui ferme les profils à 256 et 512 MiB n'est pas leur durée mais le serveur : argon2 alloue
// cette mémoire **par vérification en vol**, et le verrouillage ne protège pas du premier essai sur
// chaque adresse. Dix tentatives simultanées à 512 MiB réserveraient 5 GiB, et l'anti-brute-force
// deviendrait un déni de service contre le BFF ; à 64 MiB elles en réservent 640 MiB, qu'un
// conteneur encaisse.
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
					if _, err := auth.Verify(context.Background(), encoded, "un mot de passe d'opérateur"); err != nil {
						b.Fatal(err)
					}
				}
			})
	}
}

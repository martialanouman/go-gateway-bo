package bff_test

import (
	"go/ast"
	"go/types"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/tools/go/packages"
)

// responseWriterType est le type dont on suit les apparitions. Il est nommé par son chemin complet et
// comparé au type **statique** résolu par le type-checker, jamais cherché dans le texte.
const responseWriterType = "net/http.ResponseWriter"

// sanctionedWriter nomme la fonction qui a le droit d'écrire un corps. Sa **position** sert de
// définition au fichier exempté, comme celle de `StrictServerInterface` sert de définition au fichier
// engendré : déplacer `writeJSON` déplace l'exemption avec elle, là où un `respond.go` codé en dur
// laisserait l'exemption sur un fichier qui ne l'abrite plus.
const sanctionedWriter = "writeJSON"

// admittedSinks énumère ce qu'un `http.ResponseWriter` a le droit d'atteindre hors du fichier engendré
// et de celui qui abrite `writeJSON`, **avec la raison de chacun**.
//
// Une liste de puits et non une liste de fichiers : exempter `assets.go` en entier le laisserait
// écrire n'importe quoi, alors que ce qu'il fait de légitime tient en deux appels. C'est la forme de
// la table d'autorisation de `guard.go`, pour la même raison — une exemption sans motif écrit est le
// premier état d'une garde désactivée.
var admittedSinks = map[string]string{
	modulePath + "internal/bff." + sanctionedWriter: "l'écrivain sanctionné lui-même, dont ce qui " +
		"entre est déjà gardé par TestLeSecondCheminVersLeFilNeSerialiseQueDesDTODeclares",
	"(" + responseWriterType + ").Header": "un en-tête n'est pas un corps : `Content-Type`, " +
		"`Cache-Control` et `Vary` ne peuvent porter aucun objet de domaine",
	"net/http.SetCookie": "un en-tête lui aussi. Ce qu'il pose est le jeton scellé, dont la " +
		"composition est gardée par `internal/session`",
	"(net/http.Handler).ServeHTTP": "une délégation, pas une écriture : le writer traverse la chaîne " +
		"de middlewares et c'est le maillon suivant qui répondra",
	"net/http.NotFound": "la surface des assets, qui écrit une chaîne fixe de la bibliothèque " +
		"standard et ne reçoit rien du produit",
	"net/http.ServeFileFS": "la surface des assets : le contenu vient d'un `//go:embed` résolu à la " +
		"compilation, donc du bundle SPA et de rien d'autre. Aucun objet de domaine ne peut y entrer",
	modulePath + "internal/bff.StrictHandlerFunc": "la chaîne des middlewares stricts. `next(ctx, w, " +
		"r, request)` passe le writer au maillon suivant sans rien y écrire, et le dernier maillon est " +
		"le handler engendré. C'est la même délégation que `ServeHTTP`, sous la forme que le mode " +
		"strict lui donne — **et elle n'avait pas été prévue** : c'est le rouge d'abord qui l'a montrée",
}

// Un corps de réponse ne s'écrit qu'à deux endroits, et le compilateur ne l'impose pas.
//
// `writeJSON` **est** la seule surface de sérialisation non typée du paquet, mais rien ne l'obligeait
// à le rester : `json.NewEncoder(w).Encode(resolved)` écrit dans un middleware compile, ne passe par
// aucun `Visit…` engendré, échappe à la conformité au contrat que les scénarios exercent, et aucune
// des portes de step-026 ne le voit. La revue du 30/08/2026 a montré que l'affirmation de `respond.go`
// — « la seule surface » — était un constat et non une propriété.
//
// Ce contrôle en fait une propriété. Il suit le **type statique** de chaque expression et refuse qu'un
// `http.ResponseWriter` atteigne autre chose que les puits nommés ci-dessus : ni `w.Write`, ni
// `w.WriteHeader`, ni `json.NewEncoder(w)`, ni `fmt.Fprintf(w, …)`, ni `http.Error`.
//
// **Il ne porte pas sur `json`, et c'est mesuré.** La première rédaction envisagée refusait
// `json.Marshal` hors de `respond.go` : elle aurait eu deux faux positifs le jour de sa livraison —
// `webauthn.go` marshale l'attestation et l'assertion d'une **requête** vers le store, sans jamais
// toucher au writer. Une garde qui refuse du légitime finit retirée.
//
// Le paquet est chargé sans ses tests : un `httptest.ResponseRecorder` nourri à la main dans un
// `_test.go` est le harnais, pas le produit.
func TestUnCorpsDeReponseNeSEcritQuALEndroitPrevu(t *testing.T) {
	t.Parallel()

	pkg := loadBFF(t)

	found, seen := directWrites(pkg, exemptedFiles(t, pkg))

	require.Positive(t, seen,
		"aucun http.ResponseWriter atteint dans le paquet : le contrôle est inerte, pas vert")

	assert.Emptyf(t, found,
		"%d écriture(s) directe(s) sur le writer, hors des deux endroits prévus : ce qui part par là "+
			"n'est borné par aucun DTO et n'est confronté à aucun contrat", len(found))
}

// exemptedFiles rend les deux fichiers où un corps a le droit de s'écrire, repérés par la position
// d'une déclaration qu'ils abritent et jamais par leur nom.
func exemptedFiles(t *testing.T, pkg *packages.Package) map[string]bool {
	t.Helper()

	writer := pkg.Types.Scope().Lookup(sanctionedWriter)
	require.NotNilf(t, writer, "%s introuvable : l'exemption n'a plus de définition", sanctionedWriter)

	return map[string]bool{
		generatedFile(t, pkg):                    true,
		pkg.Fset.Position(writer.Pos()).Filename: true,
	}
}

// directWrites rend les puits interdits qu'un `http.ResponseWriter` atteint, et le nombre total de
// puits vus — le second sert de témoin anti-vide à l'appelant.
//
// Il est extrait parce que **deux tests l'exercent en sens contraire** : celui du paquet exige qu'il
// ne rende rien, celui du témoin exige qu'il rende quelque chose. Une porte dont on n'a pas vu le
// rouge ne prouve rien.
//
// Le writer est reconnu à deux places, et il faut les deux : en **récepteur** (`w.Write(…)`) et en
// **argument** (`json.NewEncoder(w)`). N'en prendre qu'une laisserait l'autre moitié passer, et c'est
// la moitié « argument » qui porte le défaut le plus naturel à écrire.
func directWrites(pkg *packages.Package, exempted map[string]bool) ([]string, int) {
	var found []string

	seen := 0

	for _, file := range pkg.Syntax {
		if exempted[pkg.Fset.Position(file.Pos()).Filename] {
			continue
		}

		ast.Inspect(file, func(node ast.Node) bool {
			call, isCall := node.(*ast.CallExpr)
			if !isCall || !touchesWriter(pkg, call) {
				return true
			}

			seen++

			sink := calledSink(pkg, call)
			if _, admitted := admittedSinks[sink]; !admitted {
				found = append(found, pkg.Fset.Position(call.Pos()).String()+" : "+sink)
			}

			return true
		})
	}

	return found, seen
}

// touchesWriter dit si un `http.ResponseWriter` est le récepteur de l'appel ou l'un de ses arguments.
func touchesWriter(pkg *packages.Package, call *ast.CallExpr) bool {
	if selector, isSelector := call.Fun.(*ast.SelectorExpr); isSelector {
		if isWriter(pkg, selector.X) {
			return true
		}
	}

	for _, argument := range call.Args {
		if isWriter(pkg, argument) {
			return true
		}
	}

	return false
}

func isWriter(pkg *packages.Package, expression ast.Expr) bool {
	carrier := pkg.TypesInfo.Types[expression].Type

	return carrier != nil && carrier.String() == responseWriterType
}

// calledSink nomme la fonction appelée par son récepteur, comme `qualified` de `guard_test.go` : sans
// le récepteur, un `Write` quelconque se confondrait avec celui du writer.
func calledSink(pkg *packages.Package, call *ast.CallExpr) string {
	var target *ast.Ident

	switch fun := call.Fun.(type) {
	case *ast.Ident:
		target = fun
	case *ast.SelectorExpr:
		target = fun.Sel
	default:
		return "un appel dont l'appelé ne se résout pas"
	}

	resolved, isFunc := pkg.TypesInfo.Uses[target].(*types.Func)
	if !isFunc {
		// Un appelé qui n'est pas une fonction déclarée est une **valeur** de type fonction : un
		// paramètre, une variable. Elle se nomme alors par son type, ce qui laisse admettre la chaîne
		// des middlewares stricts sans admettre n'importe quel `func(http.ResponseWriter)` du paquet.
		return pkg.TypesInfo.Types[call.Fun].Type.String()
	}

	receiver := resolved.Signature().Recv()
	if receiver == nil {
		return resolved.Pkg().Path() + "." + resolved.Name()
	}

	return "(" + receiver.Type().String() + ")." + resolved.Name()
}

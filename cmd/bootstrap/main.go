// Command bootstrap prépare une installation neuve : elle sème le catalogue des permissions et les
// neuf rôles par défaut du §6.10 sur la base dont le DSN est lu sur l'entrée standard.
//
// **Sur l'entrée standard, et non en argument** : `ps aux` affiche la ligne de commande de tout
// processus de la machine, `go run` la duplique dans le processus fils, et ce DSN porte le mot de
// passe de la base. Même raison que `cmd/migrate`, dont cette commande reprend la forme jusqu'au
// message d'usage.
//
// Elle est **rejouable** : un déploiement l'appelle à chaque fois, et une base déjà semée le reste à
// l'identique. Ce qu'elle change, elle le dit ; ce qu'elle ne comprend pas, elle le nomme sur la
// sortie d'erreur sans arrêter la livraison — le retrait d'une clé du catalogue est une migration,
// qui révoque d'abord.
//
// # Ce qu'elle ne fait pas encore
//
// La création du premier opérateur arrive en step-021. Une installation neuve a donc, à l'issue de
// cette commande, un vocabulaire complet et personne pour l'exercer.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const usage = "usage : printf '%s' \"$DASHBOARD_DATABASE_URL\" | bootstrap"

func main() {
	// os.Exit reste seul dans main : appelé depuis start, il court-circuiterait son `defer`.
	if err := start(os.Stdin, os.Stdout, os.Stderr, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func start(in io.Reader, out, errOut io.Writer, args []string) error {
	if len(args) > 0 {
		return errors.New("bootstrap ne prend aucun argument : un DSN passé en argument s'affiche " +
			"dans `ps aux`, avec le mot de passe de la base. Il se lit sur l'entrée standard.\n" + usage)
	}

	read, err := io.ReadAll(in)
	if err != nil {
		return fmt.Errorf("lire le DSN sur l'entrée standard : %w", err)
	}

	// Les espaces de bord tombent : un `echo` termine sa ligne, et un DSN n'en porte jamais.
	dsn := strings.TrimSpace(string(read))
	if dsn == "" {
		return errors.New("aucun DSN n'est arrivé sur l'entrée standard.\n" + usage)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Le schéma est contrôlé avant d'être écrit. Sans cela, une base qu'on a oublié de migrer
	// échouerait sur « relation "permissions" does not exist » — vrai, mais qui ne dit pas quoi faire.
	if err = store.VerifySchema(ctx, dsn); err != nil {
		return err
	}

	outcome, err := store.Seed(ctx, dsn)
	if err != nil {
		return fmt.Errorf("le seed a échoué : %w", err)
	}

	report(out, errOut, outcome)

	return nil
}

// report écrit ce que le seed vient de faire. Les comptes viennent du rapport, donc de ce que la
// base a réellement accepté — jamais de la taille du catalogue en mémoire, qui décrirait le code au
// lieu de décrire l'effet.
func report(out, errOut io.Writer, outcome store.SeedOutcome) {
	if !outcome.Changed() {
		printLine(out, "vocabulaire déjà à jour : rien à semer")
	}

	printCount(out, len(outcome.PermissionsInserted), "permission(s) posée(s)")
	// « entrée(s) » et non « description(s) » : la requête déclenche sur `(category, description)`,
	// donc une catégorie corrigée en Go compte ici aussi.
	printCount(out, len(outcome.PermissionsUpdated), "entrée(s) remise(s) à ce que le catalogue dit")
	printNames(out, outcome.RolesInserted, "rôle(s) par défaut posé(s)")
	printNames(out, outcome.RolesUpdated, "rôle(s) par défaut mis à jour")
	printCount(out, len(outcome.GrantsAdded), "attribution(s) accordée(s)")
	printCount(out, len(outcome.GrantsRevoked), "attribution(s) révoquée(s)")

	if outcome.Changed() {
		printLine(out, "la création du premier opérateur arrive en step-021 : "+
			"`make bootstrap` ne la fait pas encore")
	}

	warnAboutDivergence(errOut, outcome)
}

func warnAboutDivergence(errOut io.Writer, outcome store.SeedOutcome) {
	if !outcome.Diverges() {
		return
	}

	// Ce message est lu dans quatre situations — la clé n'est détenue par personne, par des rôles
	// par défaut seulement, par des rôles composés à l'écran seulement, ou par les deux — et il ne
	// dit donc que ce qui est vrai des quatre. Une première rédaction affirmait « la supprimer
	// échouerait tant qu'un rôle la détient » et « les rôles composés depuis l'écran la gardent » :
	// les deux sont fausses dès que personne ne la détient, c'est-à-dire dans le cas le plus courant.
	for _, key := range outcome.UnknownPermissions {
		printLine(errOut, "ATTENTION — la base porte la permission %q, que le catalogue ne déclare "+
			"plus.\n  La ligne est conservée : aucun rôle par défaut ne l'accorde plus, mais un rôle "+
			"composé\n  depuis l'écran peut la détenir, et la supprimer échouerait alors sur la "+
			"contrainte. La\n  retirer pour de bon est une migration, qui révoque d'abord ce qui "+
			"reste.", key)
	}

	for _, role := range outcome.UnknownRoles {
		printLine(errOut, "ATTENTION — la base porte le rôle par défaut %q, que le code ne décrit "+
			"plus.\n  Ni le rôle ni ses attributions ne sont touchés : le vider dépossèderait sans "+
			"rien dire les\n  opérateurs qui le détiennent. Le retirer est une migration, qui "+
			"détache ses opérateurs\n  d'abord.", role)
	}
}

func printCount(out io.Writer, count int, what string) {
	if count > 0 {
		printLine(out, "%d %s", count, what)
	}
}

func printNames(out io.Writer, names []string, what string) {
	if len(names) > 0 {
		printLine(out, "%d %s : %s", len(names), what, strings.Join(names, ", "))
	}
}

// printLine est le seul point d'écriture de ce compte rendu, et c'est là que l'erreur d'écriture est
// écartée — une fois, plutôt qu'à six endroits. Ce qui s'écrit ici est un compte rendu sur la sortie
// de la commande : un flux cassé emporterait de toute façon le message qui l'annoncerait, et le
// travail, lui, est déjà validé en base.
func printLine(w io.Writer, format string, args ...any) {
	_, _ = fmt.Fprintf(w, format+"\n", args...)
}

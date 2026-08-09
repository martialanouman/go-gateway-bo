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
// # Le compte propriétaire
//
// Elle crée aussi le premier opérateur — **s'il n'y en a aucun**, et elle le dit quand elle n'en crée
// pas. C'est la création du compte qui ne se rejoue pas, pas la commande : un déploiement l'appelle à
// chaque livraison, et une commande qui échouerait au second passage finirait retirée du déploiement,
// donc le catalogue ne serait plus jamais reprojeté.
//
// Les valeurs du compte se lisent dans l'**environnement** et non en argument, pour la raison qui fait
// déjà lire le DSN sur l'entrée standard : `ps aux` affiche la ligne de commande de tout processus de
// la machine. Elles ne sont exigées que lorsque la base ne porte aucun opérateur, c'est-à-dire au seul
// moment où elles servent.
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

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/config"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

const usage = "usage : printf '%s' \"$DASHBOARD_DATABASE_URL\" | bootstrap"

func main() {
	// os.Exit reste seul dans main : appelé depuis start, il court-circuiterait son `defer`.
	//nolint:forbidigo // La seconde et dernière lecture d'environnement du dépôt — une par
	// programme — et elle ne fait que la passer au chargeur de `internal/config`. L'exemption est
	// posée sur la ligne, pas sur le fichier : sinon toute lecture ajoutée plus tard passerait avec
	// elle.
	if err := start(os.Stdin, os.Stdout, os.Stderr, os.Args[1:], os.LookupEnv); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func start(in io.Reader, out, errOut io.Writer, args []string, lookup config.Lookup) error {
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

	owner, err := createOwner(ctx, dsn, lookup)
	if err != nil {
		return err
	}

	report(out, errOut, outcome, owner)

	return nil
}

// createOwner crée le compte propriétaire s'il n'y en a aucun.
//
// **L'ordre compte** : on regarde d'abord si un opérateur existe, et on n'exige les variables que
// dans le cas contraire. L'inverse — exiger puis regarder — ferait échouer la commande sur toute
// installation déjà faite, c'est-à-dire à chaque déploiement après le premier.
//
// Ce retour anticipé n'est **pas** la garde contre un second compte : c'est
// `store.CreateFirstOperator`, sous son verrou, qui la tient quand deux exécutions se croisent.
// Mesuré, retirer l'un des deux laisse la suite verte et il faut retirer les deux pour la faire
// rougir — le constat complet est au-dessus de `CreateFirstOperator`.
func createOwner(ctx context.Context, dsn string, lookup config.Lookup) (store.FirstOperatorOutcome, error) {
	populated, err := store.HasAnyOperator(ctx, dsn)
	if err != nil {
		return store.FirstOperatorOutcome{}, err
	}

	if populated {
		return store.FirstOperatorOutcome{}, nil
	}

	cfg, err := config.LoadBootstrap(lookup)
	if err != nil {
		return store.FirstOperatorOutcome{}, err
	}

	if !cfg.Complete() {
		return store.FirstOperatorOutcome{}, fmt.Errorf(
			"cette base ne porte aucun opérateur, et le compte propriétaire ne peut pas être créé : "+
				"%s manquent dans l'environnement.\n  Sans lui, l'installation a un vocabulaire complet "+
				"et personne pour l'exercer", strings.Join(cfg.MissingNames(), ", "))
	}

	hash, err := auth.Hash(cfg.OperatorPassword)
	if err != nil {
		// Le message n'enveloppe pas l'erreur d'origine : elle vient du tirage du sel, et rien de ce
		// qu'elle porte ne concerne l'exploitant.
		return store.FirstOperatorOutcome{}, errors.New("le hachage du mot de passe a échoué")
	}

	return store.CreateFirstOperator(ctx, dsn, cfg.OperatorEmail, cfg.OperatorName, hash)
}

// report écrit ce que le seed vient de faire. Les comptes viennent du rapport, donc de ce que la
// base a réellement accepté — jamais de la taille du catalogue en mémoire, qui décrirait le code au
// lieu de décrire l'effet.
func report(out, errOut io.Writer, outcome store.SeedOutcome, owner store.FirstOperatorOutcome) {
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

	reportOwner(out, owner)

	warnAboutDivergence(errOut, outcome)
}

// reportOwner dit ce qui est arrivé au compte propriétaire, **dans les deux cas**. Le silence sur
// « rien à faire » ferait douter l'exploitant de ce que la commande vient de garantir, et la ligne qui
// compte pour lui est justement celle-là : personne n'a été créé en douce.
func reportOwner(out io.Writer, owner store.FirstOperatorOutcome) {
	if owner.Created {
		// L'adresse est rendue, le mot de passe jamais — ni ici, ni ailleurs.
		printLine(out, "compte propriétaire créé pour %s, avec le rôle %s", owner.Email, owner.Role)

		return
	}

	printLine(out, "un opérateur existe déjà : aucun compte n'a été créé")
}

func warnAboutDivergence(errOut io.Writer, outcome store.SeedOutcome) {
	if !outcome.Diverges() {
		return
	}

	// Ce message est lu dans **cinq** situations, selon qui détient encore la clé : personne, un rôle
	// par défaut que le code décrit, un rôle composé à l'écran, un rôle marqué `is_default` que le
	// code ne décrit plus, ou plusieurs à la fois. Il ne dit donc que ce qui est vrai des cinq.
	//
	// Deux rédactions précédentes ne l'étaient pas : la première affirmait qu'un rôle détenait la clé
	// — faux dès que personne ne la détient — et la seconde que « aucun rôle par défaut ne l'accorde
	// plus », que le message voisin sur un rôle inconnu dément six lignes plus bas, puisque celui-là
	// conserve ses attributions. D'où « que ce code décrit », qui est la formulation exacte de la
	// garde de la révocation.
	for _, key := range outcome.UnknownPermissions {
		printLine(errOut, "ATTENTION — la base porte la permission %q, que le catalogue ne déclare "+
			"plus.\n  La ligne est conservée : aucun rôle par défaut que ce code décrit ne l'accorde "+
			"plus, mais\n  un autre rôle peut la détenir, et la supprimer échouerait alors sur la "+
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

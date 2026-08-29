package bff

import (
	"context"
	"net/http"
	"slices"

	"github.com/martialanouman/go-gateway-bo/internal/permissions"
)

// rule dit ce qu'une opération du contrat exige avant d'être servie.
//
// **Une seule table plutôt qu'une table de gardes et une liste d'exemptions**, parce que la question
// que la porte pose est « cette opération a-t-elle été décidée ? », et qu'avec deux structures une
// opération absente des deux est un trou qu'il faut penser à chercher. Ici, exiger et exempter sont
// deux réponses à la même question.
type rule struct {
	// permission est la clé exigée. Vide sur une exemption, et jamais autrement : `requires` est le
	// seul constructeur qui la pose.
	permission permissions.Key
	// exemption porte la raison, en toutes lettres. Une exemption sans raison écrite est refusée par
	// la porte — une liste qui s'allonge sans motif est le premier état d'une garde désactivée.
	exemption string
}

// requires exige une clé du catalogue, **et l'élévation avec elle**.
//
// Les deux ne se séparent pas : `plan.md` §6 pose qu'« une session non-MFA ne peut atteindre aucune
// écriture ni `content:read` », ce qui est exactement l'ensemble des opérations qui exigent une clé.
// Un constructeur « élévation sans clé » n'aurait aucun cas aujourd'hui, et s'ajoutera le jour où il
// en aura un.
func requires(key permissions.Key) rule {
	return rule{permission: key}
}

// exempt déclare qu'une opération répond d'elle-même de son autorisation, et dit pourquoi.
func exempt(reason string) rule {
	return rule{exemption: reason}
}

func (r rule) exempted() bool { return r.exemption != "" }

// authorization décide pour **les dix opérations du contrat**, pas seulement pour les mutations.
//
// **Le défaut est fermé** : une opération absente de cette table est refusée. C'est ce qui rend
// bruyant le piège des deux vocabulaires — la clé est le nom de méthode Go que le code engendré
// passe au middleware (`Login`, PascalCase), quand le YAML déclare `login`. Écrite en camelCase,
// l'entrée devient inatteignable ; refuser fait tomber le premier scénario de la route, là que
// laisser passer aurait ouvert la garde en silence. La porte d'énumération tient le même invariant
// par le type-checker, et les deux ensemble sont ce qui ferme le piège.
//
// **Aucune entrée n'exige de clé aujourd'hui, et c'est le sujet de la step.** Les **huit** mutations
// vivent sous `/auth/`, où l'autorisation est l'affaire de chaque route ; les deux autres opérations
// sont des lectures. Le premier `requires` arrive avec `POST /operators`, en step-029.
var authorization = map[string]rule{
	"Health": exempt("la sonde de l'orchestrateur, qui n'a pas de session et ne doit jamais " +
		"dépendre d'une autre brique pour répondre"),
	"Login": exempt("la porte d'entrée : exiger une session pour en ouvrir une n'a pas de sens. " +
		"Ce qui la garde est le verrou d'essais, sur deux dimensions"),
	"Me": exempt("une lecture, et celle qui dit à l'écran quoi afficher. L'exiger élevée ferait " +
		"boucler le remède : l'écran qui conduit au second facteur ne saurait plus quoi montrer"),
	"Logout": exempt("fermer sa propre session. Exiger quoi que ce soit ici laisserait une session " +
		"ouverte à qui veut la fermer"),
	"EnrollTotp": exempt("self-service sur son propre compte, et le chemin d'amorçage : aucune clé " +
		"du catalogue ne désigne « poser son propre second facteur ». La garde est l'élévation dès " +
		"qu'un facteur existe, plus le compteur d'appels de la migration 00009"),
	"VerifyMfa": exempt("franchir son propre second facteur, c'est-à-dire le geste qui **produit** " +
		"l'élévation. L'exiger ici la rendrait inatteignable"),
	"BeginWebauthnRegistration": exempt("ouvre une cérémonie sur son propre compte, sans effet " +
		"durable. Même garde qu'`EnrollTotp`, pour la même raison"),
	"FinishWebauthnRegistration": exempt("pose une passkey sur son propre compte. Exempté de garde " +
		"mais **pas d'audit** : ajouter un second facteur est ce qu'une enquête sur compte compromis " +
		"cherche en premier"),
	"BeginWebauthnAssertion": exempt("ouvre une cérémonie sur son propre compte, sans effet durable"),
	"DeleteWebauthnPasskey": exempt("retirer sa propre clé d'accès est du self-service, pas un acte " +
		"sur autrui : aucune clé du catalogue n'y correspond, et en créer une qu'il faudrait donner " +
		"aux neuf rôles n'exclurait personne. L'élévation la garde, le journal en garde la trace, et " +
		"c'est `operators:manage` qui gardera le retrait sur autrui (step-029)"),
}

// grantsOf rend l'union des permissions d'un opérateur.
//
// Le type existe pour que la garde soit **exerçable** : `internal/bff` ne monte aucune base, et sans
// cette couture la branche « la clé manque » n'aurait aucun test avant step-029 — donc la mutation
// qui retire la comparaison resterait verte, ce que la DoD de la step refuse.
//
// Le prix de toute couture est qu'un test peut vérifier un mécanisme que la production ne câble pas :
// c'est le défaut que step-021 a payé. Il est fermé ici par `TestLaGardeEstCablee`, qui exige que
// `newContractHandler` atteigne `(*session.Manager).Grants` — la vraie source, pas n'importe quelle
// fonction du bon type.
type grantsOf func(ctx context.Context, operatorID string) ([]string, error)

// requirePermission garde chaque opération selon la table.
//
// **Un middleware strict et non chi**, pour la raison mesurée en step-021 : le statut part dans
// `Visit…Response(w)`, à l'intérieur du handler engendré, et un middleware chi ne reprendrait la main
// qu'après, sur une réponse déjà écrite.
//
// **Le refus s'écrit ici, sur `w`, et le middleware rend ensuite `(nil, nil)`.** Lu dans le code
// engendré (`bff.gen.go:1360-1368`), les trois branches du wrapper sont alors fausses — l'erreur est
// nulle, l'assertion de type échoue sur `nil`, et `response != nil` est faux — donc rien n'est
// réécrit par-dessus. Rendre `(nil, nil)` **sans** écrire laisserait `net/http` servir un 200 vide :
// c'est l'écriture qui est le refus, pas le retour.
//
// L'alternative — rendre l'objet de réponse typé de l'opération — exigerait une seconde table
// `operationID → constructeur du 403 de cette opération-là`, et son défaut retomberait sur
// `unexpected response type`, donc **500 au lieu de 403** : une garde qui se trompe en panne.
func requirePermission(rules map[string]rule, grants grantsOf) StrictMiddlewareFunc {
	return func(next StrictHandlerFunc, operationID string) StrictHandlerFunc {
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
			required, declared := rules[operationID]
			if !declared {
				writeJSON(w, http.StatusForbidden, undecidedOperation())

				return nil, nil
			}

			if required.exempted() {
				return next(ctx, w, r, request)
			}

			resolved, alive, err := sessionFrom(ctx)
			if err != nil {
				// La panne remonte plutôt qu'elle ne se déguise en refus : une base injoignable lue
				// comme « vous n'avez pas le droit » ferait chercher un problème de rôle pendant que
				// la panne est ailleurs. Même arbitrage qu'au premier facteur.
				return nil, err
			}

			if !alive {
				writeJSON(w, http.StatusUnauthorized, notAuthenticated())

				return nil, nil
			}

			if !resolved.Elevated {
				writeJSON(w, http.StatusForbidden, secondFactorRequired())

				return nil, nil
			}

			// Après l'élévation et jamais avant : c'est une requête SQL par requête gardée, et la
			// refuser plus tôt coûte moins que de la lire pour rien.
			held, err := grants(ctx, resolved.OperatorID)
			if err != nil {
				return nil, err
			}

			if !slices.Contains(held, string(required.permission)) {
				writeJSON(w, http.StatusForbidden, permissionMissing(required.permission))

				return nil, nil
			}

			return next(ctx, w, r, request)
		}
	}
}

// undecidedOperation refuse une opération que la table ne décide pas. Elle ne devrait jamais être
// servie — la porte d'énumération exige une entrée pour chacune — et c'est justement pourquoi le
// message dit à l'opérateur que ce n'est pas lui qui a mal fait.
func undecidedOperation() errorResponse {
	return errorResponse{
		Code: "forbidden",
		Message: "Cette action est refusée : le serveur ne sait pas quelle permission elle demande, " +
			"et refuse plutôt que de laisser passer. Ce n'est pas un manque de droits mais une " +
			"anomalie du serveur — signalez-la.",
	}
}

// secondFactorRequired distingue « la session n'a pas le niveau » de « la session est fermée ».
//
// **403 et non 401** : `notAuthenticated()` dirait « reconnectez-vous », ce qui est faux d'une session
// vivante et dont le remède **boucle** — se reconnecter rend précisément une session de premier
// facteur. Et **403 et non 409**, contrairement aux quatre refus de `/auth/mfa/*` : là-bas le 409 dit
// « un facteur existe déjà, franchissez-le pour en ajouter un autre », un conflit d'état dont le
// remède est nommé ; ici c'est une interdiction pure.
func secondFactorRequired() errorResponse {
	return errorResponse{
		Code: "mfa_required",
		Message: "Cette action demande d'avoir franchi votre second facteur dans cette session. " +
			"Votre session reste ouverte : validez votre second facteur, puis recommencez.",
	}
}

// permissionMissing nomme la clé qui manque, délibérément.
//
// La charte exige qu'un contrôle interdit soit expliqué et non masqué, et c'est la clé — pas une
// périphrase — qu'un administrateur cherchera dans l'éditeur de rôle. Elle ne révèle rien : le
// catalogue entier est rendu au client par `permissions.gen.ts`.
func permissionMissing(key permissions.Key) errorResponse {
	return errorResponse{
		Code: "permission_denied",
		Message: "Votre compte ne détient pas la permission « " + string(key) + " », que cette " +
			"action demande. La consultation reste ouverte ; un administrateur peut vous l'accorder.",
	}
}

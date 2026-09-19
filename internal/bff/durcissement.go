package bff

import (
	"context"
	"mime"
	"net/http"
	"time"
)

// Les trois en-têtes que toute réponse porte, quelle que soit la surface — la coquille, un fichier
// haché, une réponse d'API. Aucun ne dépend d'un nonce : la CSP, qui en dépend, arrive en step-186.
//
// `nosniff` : sans lui, un navigateur devine le type d'un corps dont le `Content-Type` ne le
// convainc pas, et sert en script ce que le serveur annonçait autrement.
// `DENY` : le tableau de bord n'est jamais encadré, donc aucun clic ne peut y être détourné. C'est
// la seule barrière contre l'encadrement hors CSP, et les navigateurs qui ignorent `frame-ancestors`
// la lisent encore.
// `same-origin` : une URL du tableau de bord porte des identifiants de client et de compte. Elle ne
// part pas dans le `Referer` d'un site tiers.
var hardeningHeaders = map[string]string{
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options":        "DENY",
	"Referrer-Policy":        "same-origin",
}

// withHardeningHeaders pose ces en-têtes **avant** d'appeler la suite : après, le statut est parti et
// les en-têtes avec lui.
//
// Monté à la racine et non sur `/api` : un fichier haché servi sans `nosniff` est exactement le
// vecteur que `nosniff` ferme, et la coquille est ce qu'on encadre.
func withHardeningHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for name, value := range hardeningHeaders {
			w.Header().Set(name, value)
		}

		next.ServeHTTP(w, r)
	})
}

// requireSameOrigin refuse une mutation qui ne vient pas du tableau de bord lui-même.
//
// Ce qu'elle referme : `SameSite=Lax` raisonne par **site** et non par origine, si bien qu'un
// sous-domaine voisin compromis — même site — peut envoyer un `POST` que le navigateur accompagne du
// cookie de session. Le contrôle d'origine, lui, raisonne par origine.
//
// L'origine de référence est celle de la configuration, jamais l'en-tête `Host` : le lire dans la
// requête reviendrait à laisser l'appelant déclarer d'où il vient.
//
// L'origine reçue est **déjà canonique** : `config.webauthnOrigin` la rend en schéma et hôte
// minuscules, sans chemin. C'est ce qui permet la comparaison exacte ci-dessous plutôt qu'un
// `EqualFold`, dont le repliement Unicode fait correspondre `daſhboard` à `dashboard`.
func requireSameOrigin(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isSafeMethod(r.Method) {
				next.ServeHTTP(w, r)

				return
			}

			// L'origine vide ferme au lieu d'ouvrir. Elle est inatteignable depuis le binaire — la
			// configuration l'exige avant la liaison du port — mais la valeur zéro de `Dependencies`
			// est une chaîne vide, et `"" == ""` aurait servi toute mutation d'un client muet.
			if origin == "" || !comesFromDashboard(r, origin) {
				writeJSON(w, http.StatusForbidden, Error{
					Code: "forbidden_origin",
					Message: "Cette requête a été refusée : elle n'a pas été envoyée depuis le " +
						"tableau de bord. Une modification n'est acceptée que depuis l'application " +
						"elle-même — recharger l'onglet du tableau de bord, puis réessayer.",
				})

				return
			}

			if !announcesJSON(r) {
				writeJSON(w, http.StatusUnsupportedMediaType, Error{
					Code: "unsupported_media_type",
					Message: "Cette requête a été refusée : un corps de modification doit être " +
						"annoncé en application/json, le seul type que ces routes acceptent.",
				})

				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// isSafeMethod énumère les méthodes qui ne modifient rien. Les contrôler serait refuser la navigation
// elle-même : un onglet ouvert depuis un lien extérieur est légitime.
func isSafeMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

// comesFromDashboard tranche sur les deux en-têtes qu'un navigateur écrit lui-même et qu'une page ne
// peut pas falsifier.
//
// `Sec-Fetch-Site` est lu en premier parce qu'il répond à la question directement, et qu'il
// distingue `same-site` de `same-origin` — c'est-à-dire le sous-domaine voisin de l'application. Son
// absence désigne un client qui n'est pas un navigateur, ou un navigateur trop ancien pour les
// métadonnées de fetch : `Origin` est alors la seule chose à lire, et son absence un refus.
func comesFromDashboard(r *http.Request, origin string) bool {
	switch r.Header.Get("Sec-Fetch-Site") {
	case "same-origin":
		return true
	case "":
		return r.Header.Get("Origin") == origin
	default:
		// `cross-site` est l'attaque, `same-site` le voisin qui la porte, `none` une navigation
		// directe — qu'aucune mutation n'emprunte.
		return false
	}
}

// announcesJSON referme l'autre moitié de la faille : un formulaire inter-site n'annonce que
// `text/plain`, `application/x-www-form-urlencoded` ou `multipart/form-data`, et aucun de ces trois
// ne déclenche le pré-vol qui aurait arrêté la requête. Exiger `application/json` les exclut tous.
//
// Un corps absent n'annonce rien et n'a rien à annoncer : **quatre** des huit opérations mutantes du
// contrat sont dans ce cas — la déconnexion, les deux débuts de cérémonie, et le retrait d'une clé
// d'accès, dont ce qu'il désigne est dans son chemin.
//
// Un corps annoncé **sans** type est refusé. Ce que ça coûte : un appelant qui envoie un
// `ArrayBuffer` ou un `Blob` sans type, à qui `fetch` n'en pose aucun, est refusé — aucun client du
// dépôt n'en émet, et le formulaire inter-site qu'on ferme ici en pose toujours un.
func announcesJSON(r *http.Request) bool {
	declared := r.Header.Get("Content-Type")
	if declared == "" {
		return r.ContentLength == 0
	}

	mediaType, _, err := mime.ParseMediaType(declared)

	return err == nil && mediaType == "application/json"
}

// apiBodyDeadline borne le temps qu'un corps de requête met à arriver. Les corps du contrat se
// comptent en kilooctets : cinq secondes en laissent mille fois trop, et ferment le corps envoyé à un
// octet par minute, qui retient sinon une goroutine et un descripteur aussi longtemps que le client
// le décide.
//
// Aussi courte parce qu'elle ne couvre pas le traitement : `startBackgroundRead`
// (`$GOROOT/src/net/http/server.go`) **efface** l'échéance dès l'EOF du corps, donc les 3,16 s
// d'argon2id ne courent jamais contre elle.
//
// Ce qu'elle couvre est l'entrée de ce middleware jusqu'à cet EOF, et non « cinq secondes de corps » :
// l'aller-retour en base de `withSession` s'y trouve et rogne le budget. Sur une base très lente, une
// requête légitime se verrait donc refuser en 400.
const apiBodyDeadline = 5 * time.Second

// apiRequestDeadline borne la requête entière. Ce qu'elle couvre que l'échéance de lecture ne couvre
// pas : l'acquisition d'une connexion au pool, qui n'a **aucune borne propre** — `pgxpool` v5.10.0
// n'a ni `AcquireTimeout` ni paramètre équivalent (`internal/store/pool.go`), si bien qu'un pool
// saturé suspend la requête indéfiniment.
//
// Trente secondes, parce que ce qu'elle attrape est une suspension et non une lenteur.
//
// **Aucun test ne rougit si elle disparaît, et c'est mesuré** : le 19/09/2026, `context.WithTimeout`
// remplacé par `context.WithCancel`, les 95 scénarios restent verts. L'observer demanderait un pool
// saturé sous scénario, dont la durée dépasserait la porte qu'il garde. Elle reste parce que la
// suspension qu'elle ferme est réelle, pas parce qu'elle est prouvée.
const apiRequestDeadline = 30 * time.Second

// withAPIDeadlines borne une requête `/api`, et elle seule : montée dans le groupe `/api`, elle
// n'atteint pas `/ws`, dont c'est le métier de rester ouverte.
//
// **Ce montage n'est gardé par rien** : posée à la racine — donc sur `/ws` — le 19/09/2026, les 95
// scénarios restent verts, et la raison n'est pas le handler mais qu'**aucun scénario ne demande
// `/ws`**. Le contrôle d'origine ci-dessus manque à `/ws` pour la même raison de montage, sans
// conséquence tant qu'elle refuse tout en 501. step-043 ouvrira une route qui porte le cookie de
// session : elle doit y monter les deux, et porter le test.
//
// **Ni `ReadTimeout` ni `http.TimeoutHandler`** : le premier vaut pour toute connexion du serveur,
// WebSocket comprise ; le second met la réponse entière en mémoire tampon avant de l'écrire.
func withAPIDeadlines(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Deux sources possibles : un `ResponseWriter` qui ne sait pas poser d'échéance, et une
		// connexion déjà fermée — `(*response).SetReadDeadline` transmet à la `net.Conn` brute, qui
		// rend alors une erreur. Aucune des deux ne mérite un 500 : la seconde décrit un client
		// parti. Elle est écartée plutôt que journalisée parce qu'aucun journal n'atteint ce paquet
		// (voir `newContractHandler`).
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(apiBodyDeadline))

		ctx, cancel := context.WithTimeout(r.Context(), apiRequestDeadline)
		defer cancel()

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

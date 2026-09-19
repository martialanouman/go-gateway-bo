package bff

import (
	"context"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/mfa"
	"github.com/martialanouman/go-gateway-bo/internal/session"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// API implémente l'interface **stricte** qu'engendre `api/openapi-bff.yaml` : elle retire le
// `http.ResponseWriter` de la signature du handler, qui rend une valeur là où l'interface simple lui
// tendait un writer nu.
//
// **Cela ne tient pas le DTO de sortie pour autant** : les méthodes `Visit…Response` prennent
// elles-mêmes un writer nu, si bien qu'un type de réponse écrit à la main y écrirait ce qu'il veut.
// Ce qui le tient est `TestResponseTypesDeclareTheirFields`, qui exige que tout type implémentant une
// interface `…ResponseObject` — **et toute méthode posée sur un tel type** — soit déclaré dans le
// fichier engendré.
//
// Elle n'embarque **pas** `Unimplemented`, et pas pour la raison qu'on croit : celui-ci ne porte que
// des méthodes de l'interface simple, donc une opération déclarée et non écrite rompt de toute façon
// la compilation. Ce que l'embarquer coûterait est une promesse trompeuse dans le type — un repli en
// 501 que le langage n'honorera jamais ici, et sur lequel un lecteur pressé compterait.
// `TestTheMountedImplementationDoesNotEmbedUnimplemented` garde cette absence.
type API struct {
	// Authenticator porte le premier facteur.
	Authenticator *auth.Authenticator
	// Sessions ouvre, résout et ferme les sessions. Le premier facteur et la session sont deux
	// collaborateurs distincts : c'est ici qu'ils se composent, et nulle part plus bas.
	Sessions *session.Manager
	// SecondFactor enrôle et vérifie le second facteur, et c'est le troisième collaborateur distinct.
	// Ni `auth` ni `session` ne le connaissent : le premier n'a rien à voir avec lui, et le second
	// n'apprend que le geste d'élévation, qui lui appartient.
	SecondFactor *mfa.Manager
	// Passkeys mène les cérémonies WebAuthn. Distinct de `SecondFactor` : les deux facteurs ne
	// partagent que le verrou d'essais et l'élévation, et les réunir ferait d'un manager la somme de
	// deux protocoles qui n'ont ni la même forme ni le même nombre d'allers-retours.
	Passkeys *mfa.PasskeyManager
	// Audit écrit le journal. Cinquième collaborateur, et le seul dont **toutes** les routes de
	// mutation dépendent : c'est la moitié « et l'audit avec elle » de l'invariant (c).
	Audit *store.Audit
}

// Health ne touche ni la base ni la passerelle : c'est une sonde de **vivacité**, qui répond « le
// process est en vie », pas « le service est disponible ». Y brancher une dépendance ferait
// redémarrer un serveur sain parce qu'une autre brique est tombée.
func (API) Health(_ context.Context, _ HealthRequestObject) (HealthResponseObject, error) {
	return Health200JSONResponse{Status: HealthStatusOk}, nil
}

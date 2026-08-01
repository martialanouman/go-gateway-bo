// Package gateway porte le client sortant vers l'API Admin de la passerelle : l'obtention et le
// renouvellement du jeton machine OAuth2, le transport mTLS, et la traduction des erreurs de la
// passerelle en erreurs que le BFF sait rendre à l'écran.
//
// Il vit sous `internal/` parce que la frontière doit être tenue par le compilateur et non par une
// règle de lint : un package `internal/` n'est importable que depuis ce module, donc le jeton
// machine, la clé du certificat client et l'URL de l'API Admin n'ont aucun chemin vers le bundle
// servi au navigateur. C'est l'invariant (d) — le navigateur ne joint jamais l'API Admin — obtenu
// comme une propriété du langage plutôt que comme une consigne.
//
// Le contrat de cette API n'appartient pas à ce dépôt : il est consommé depuis le paquet
// `@martialanouman/gateway-api-contracts` et n'y est jamais recopié. `contrat_test.go` en fait une
// porte.
package gateway

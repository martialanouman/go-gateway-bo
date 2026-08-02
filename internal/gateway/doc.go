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
//
// # Le piège du client engendré : idempotency_key
//
// Le contrat 2.5.0 rend `idempotency_key` **obligatoire** sur les deux opérations de crédits —
// `topup-balance` et `transfer-balance` (openapi-admin.yaml:1221-1222 et 1236-1237). oapi-codegen
// engendre donc le champ non-pointeur et sans `omitempty` : `TopupBalanceJSONBody.IdempotencyKey` et
// `TransferBalanceJSONBody.IdempotencyKey`, tous deux `openapi_types.UUID` (client.gen.go:3827 et
// 3839). Un appelant qui l'oublie **compile**, et envoie `00000000-0000-0000-0000-000000000000` sur
// une recharge de crédits : un UUID qui a l'air valide, et le même à chaque appel — c'est-à-dire
// l'inverse exact de ce que la clé sert à garantir. Elle se remplit explicitement, à chaque appel.
package gateway

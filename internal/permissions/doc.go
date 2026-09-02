// Package permissions porte le vocabulaire de l'autorisation : les clés qu'un rôle peut accorder,
// la famille dont chacune relève, et la phrase française que l'écran d'édition de rôle affiche
// telle quelle.
//
// Il est **figé et versionné avec les livraisons** (§3.1) : jamais éditable depuis l'interface. Un
// administrateur compose des rôles à partir de ces clés, il n'en invente pas.
//
// Le package porte aussi les **neuf rôles par défaut** du §6.10 (`roles.go`) : les paquets de clés
// que le §3.1 donne pour pré-remplis et non supprimables. Ils vivent ici et non dans
// `internal/store` parce que la règle que la spécification exige — toute clé hors des trois
// délibérées appartient à au moins un rôle — est une propriété du vocabulaire et de la politique,
// pas de la base. Le seed n'en est que la projection.
//
// Le package ne porte **aucune garde et aucun middleware** : la garde vit dans `internal/bff`
// (`guard.go`, montée en `router.go`) depuis step-025, et c'est là qu'on l'exerce. Le TypeScript que
// consomme le client est **engendré** depuis ici : la garde serveur est ce qui protège réellement, le
// rendu conditionnel du client n'est qu'un confort (invariant c), donc la source vit du côté qui
// décide.
//
// # Ajouter une clé, c'est trois endroits dans la même PR
//
// Le catalogue ici, la garde serveur qui l'exige, et le tableau des rôles par défaut. Une clé sans
// garde est une permission qui ne garde rien ; une garde sans clé au catalogue refuse tout le
// monde ; une clé qu'aucun rôle ne détient est inaccessible à tous sauf `super_admin`. Les trois
// erreurs sont silencieuses.
package permissions

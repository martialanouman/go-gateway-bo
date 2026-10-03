# 065 — La suspension d'un client promet de rouvrir ses comptes fermés, ce que la passerelle ne fait plus

> **Porteur :** step-065

## Ce qu'elle coûte si elle dure

La modale « Suspendre <client> ? » (`web/src/routes/_shell.customers_.$customerId.tsx`,
`suspensionConsequence`) annonce qu'« un compte fermé repassera suspendu, et pourra donc être
réactivé ». Depuis `go-gateway` #245 (`a18f96e`, 03/10/2026, contrat 6.10.1), c'est faux : la
cascade laisse un compte fermé fermé, et un trigger (`control_plane.closed_is_final()`) refuse toute
sortie de `closed`. L'opérateur lit une promesse que le produit ne tient pas. C'est la forme de
défaut que vise le critère 2.

Relevé le 03/10/2026, pendant step-064. La 6.10.1 était alors retenue par la quarantaine pnpm
(`minimumReleaseAge: 1440`), et le diff de son YAML ne touche que des `description`.

Le remède : retirer la phrase et sa branche dans `suspensionConsequence`, ainsi que l'assertion qui
la tient dans `_shell.customers_.$customerId.test.tsx`. Il faut aussi relire `closedAccounts` dans
la suspension. step-065 relèvera le contrat en ouvrant : la 6.10.1 sera hors quarantaine, et c'est
elle qui porte la règle.

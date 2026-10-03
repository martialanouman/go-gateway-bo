# 063 — Un BFF injoignable s'affiche « Failed to fetch », brut et en anglais

> **Porteur :** step-063

## Ce qu'elle coûte si elle dure

`orRefusal` (`web/src/lib/administration.tsx`) ne traduit que les réponses du BFF. Quand la requête
n'aboutit pas — BFF arrêté, coupure réseau, instance qui redémarre —, `fetch` lève une `TypeError`
dont le message passe tel quel dans l'état d'erreur ou dans le refus d'une modale : « Failed to
fetch » sous Chromium, un autre texte anglais sous Firefox. L'opérateur lit une phrase qui ne dit ni
la conséquence ni quoi faire, en violation de la copie produit (français, conséquence d'abord) et
de l'état « erreur » de `tasks/plan.md` §1.9.

Mesuré le 02/10/2026 avec agent-browser contre le binaire, requête interrompue par
`agent-browser network route "**/api/customers" --abort` : la liste des clients affiche « Les
clients n'ont pas pu être chargés / Failed to fetch » ; même rendu dans la confirmation de
suspension de la fiche client. Le défaut est transverse : 33 appels à `orRefusal` sur sept écrans.

step-063 le porte parce qu'elle ajoute le prochain écran bâti sur `orRefusal` ; la correction vit
dans `orRefusal`, pas écran par écran, avec un test qui fait échouer `fetch` lui-même.

# 062 — La liste des groupes n'affiche pas le nombre de clients membres

> **Porteur :** step-062

## Ce qu'elle coûte si elle dure

La spec §6.15 demande la colonne ; le contrat 6.9.0 n'expose aucun compteur sur `CustomerGroup`, et
`list-group-customers` est paginé sans total. Compter côté BFF coûterait un appel par page et par
groupe à chaque affichage, sans borne (invariant e) — écarté le 28/09/2026. Tant qu'elle dure,
l'opérateur ne voit pas qu'un groupe est vide avant de le supprimer, et la confirmation ne chiffre
pas les clients détachés. `member_count` est entré au contrat 6.10.0 (`go-gateway` #237), publié le
29/09/2026 à 22:35 UTC ; la quarantaine pnpm le refuse jusqu'au 30/09 à 22:35 UTC, d'où le report de
step-061 à step-062, qui relève le contrat en ouvrant et ajoute la colonne.

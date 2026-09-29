# 062 — La liste des groupes n'affiche pas le nombre de clients membres

> **Porteur :** step-061

## Ce qu'elle coûte si elle dure

La spec §6.15 demande la colonne ; le contrat 6.9.0 n'expose aucun compteur sur `CustomerGroup`, et
`list-group-customers` est paginé sans total. Compter côté BFF coûterait un appel par page et par
groupe à chaque affichage, sans borne (invariant e) — écarté le 28/09/2026. Tant qu'elle dure,
l'opérateur ne voit pas qu'un groupe est vide avant de le supprimer, et la confirmation ne chiffre
pas les clients détachés. Le compteur entre au contrat par une PR de `go-gateway` (contrat, comptage
et handler ensemble, bump mineur), hors de ce dépôt ; step-061 relève le contrat en ouvrant, ajoute
la colonne si `member_count` y est entré, et sinon reporte la dette en nommant l'état de cette PR.

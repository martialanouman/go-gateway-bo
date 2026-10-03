# 064 — Un nom d'expéditeur qui a déjà envoyé un SMS se supprime quand même

> **Porteur :** step-067

## Ce qu'elle coûte si elle dure

La règle métier, donnée par l'utilisateur le 03/10/2026 : un nom d'expéditeur qui a servi à envoyer
au moins un SMS ne peut plus être supprimé — seulement désactivé. Aucune des deux moitiés ne la tient
aujourd'hui. La passerelle supprime sans condition (`go-gateway`,
`internal/storage/postgres/queries/sender_ids.sql`, `DeleteSenderID`) et ne retient aucun usage sur
`control_plane.sender_ids` ; le tableau de bord ne peut pas le déduire, puisque `search-messages`
(contrat 6.10.0) ne filtre pas sur l'expéditeur et exige une fenêtre de dates. Tant qu'elle dure,
« Supprimer » efface un expéditeur dont les CDR existent encore, et le rattachement de ces messages à
un expéditeur enregistré se perd.

Le remède vit dans `go-gateway` : retenir l'usage (première émission) et répondre 409 à
`delete-sender-id` quand il existe, au contrat. Ici ensuite : rédiger ce 409 (« Ce nom a déjà servi à
envoyer : désactivez-le plutôt. ») et désactiver « Supprimer » quand le contrat expose l'usage.
step-067 relève le contrat pour les noms d'expéditeur (catégorie, débit) : elle porte celle-ci avec.

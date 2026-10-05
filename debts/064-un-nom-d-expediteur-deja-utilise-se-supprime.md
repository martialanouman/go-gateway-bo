# 064 — Un nom d'expéditeur qui a déjà envoyé un SMS se supprime quand même, côté tableau de bord

> **Porteur :** step-067

## Ce qu'elle coûte si elle dure

La règle métier, donnée par l'utilisateur le 03/10/2026 : un nom d'expéditeur qui a servi à envoyer
au moins un SMS ne peut plus être supprimé, seulement désactivé. **La passerelle la tient depuis le
contrat 6.11.0** (installé en 6.13.0 le 04/10/2026, step-066). Elle expose `first_used_at` sur
`SenderId` et répond 409 à `delete-sender-id` quand il est posé.

Le tableau de bord, lui, ne la tient pas encore. Le BFF ne traduit pas ce 409 (`DeleteSenderId`,
`internal/bff/sender_ids.go`, ne connaît que 404, 422 et 503) : l'opérateur reçoit une erreur
générique au lieu de « Ce nom a déjà servi à envoyer : désactivez-le plutôt. ». Et « Supprimer » reste
proposé alors que le contrat dit déjà s'il réussira. Le remède : rédiger ce 409, porter
`first_used_at` dans le DTO, et désactiver « Supprimer » en l'expliquant quand il est posé.

# 045 — Le sort de `GET /permissions`, déclarée au §5.1 et sans appelant, n'est pas tranché

> **Porteur :** step-029

## Ce qu'elle coûte si elle dure

Une opération au contrat que personne n'appelle : la trancher, et écrire la raison.

**Elles sont deux, et non une.** `DELETE /auth/mfa/webauthn/passkeys/{passkeyId}` est dans le même
cas : aucun appelant, aucune step qui la revendique — vérifié par un grep de `tasks/` le 21/09/2026,
en ouvrant step-028. La dette 042 en dépend, son porteur ayant été renvoyé ici pour cette raison.

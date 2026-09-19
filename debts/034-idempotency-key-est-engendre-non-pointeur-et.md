# 034 — `idempotency_key` est engendré non-pointeur et sans `omitempty`

> **Porteur :** step-160

## Ce qu'elle coûte si elle dure

« L'oublier compile et envoie l'UUID zéro, **qui a l'air valide** » — la passerelle le prendrait pour une clé. Renvoi de step-003 : « la step qui les appellera ».

# 016 — `oauth2.reuseTokenSource` : l'attente est bornée mais **pas annulable**

> **Porteur :** step-060

## Ce qu'elle coûte si elle dure

Un `tokenUrl` en trou noir sérialise les appels concurrents jusqu'au plafond.

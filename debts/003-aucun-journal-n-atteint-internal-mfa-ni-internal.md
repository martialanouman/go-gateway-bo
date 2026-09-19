# 003 — Aucun journal n'atteint `internal/mfa` ni `internal/auth`

> **Porteur :** step-060

## Ce qu'elle coûte si elle dure

Un secret illisible et un hachage de code abîmé sont **silencieux** ; le symptôme est un code de récupération légitime qui échoue. La tranche 403 de step-029 s'en exclut nommément.

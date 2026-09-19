# 001 — Un refus de permission (403) ne laisse **aucune trace** côté serveur

> **Porteur :** step-029

## Ce qu'elle coûte si elle dure

`internal/bff` ne reçoit aucun `*slog.Logger`, et le journal d'audit ne porte que les succès. Une enquête qui demande « qui a tenté ce qu'il ne pouvait pas faire » n'a pas la donnée, et elle ne se reconstruit pas.

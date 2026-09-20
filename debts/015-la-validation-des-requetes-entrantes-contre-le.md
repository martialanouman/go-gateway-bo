# 015 — La validation des **requêtes** entrantes contre le schéma n'est pas faite à l'exécution

> **Porteur :** step-060

## Ce qu'elle coûte si elle dure

Le contrat borne les réponses, pas ce qui entre.

**`step-049` ne l'a pas payée, et ne pouvait pas.** Elle engendre bien les bornes du contrat en Zod
(`cmd/zodgen`), mais côté **client** : c'est un confort de saisie, que n'importe quel appelant
contourne. L'invariant (c) exige la garde côté serveur, et `internal/bff/auth.go` continue de
retaper ses deux maxima à la main — sans aucun plancher, d'ailleurs : un mot de passe vide n'y est
pas refusé en 400, il part à `Authenticator.Login` et revient en 401. Mesuré le 20/09/2026.

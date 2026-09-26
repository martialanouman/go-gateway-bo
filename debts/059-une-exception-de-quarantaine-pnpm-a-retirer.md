# 059 — Une exception de quarantaine pnpm à retirer

> **Porteur :** step-045

## Ce qu'elle coûte si elle dure

`web/pnpm-workspace.yaml` exclut `@martialanouman/gateway-api-contracts@6.9.0` de
`minimumReleaseAge`. Posée le 26/09/2026 pour la 6.8.0 sur décision de l'utilisateur, auteur du
paquet, puis reportée sur la 6.9.0 dans une PR soumise à son accord. Elle ne couvre plus rien à partir du 27/09/2026 21:37 UTC, quand la 6.9.0 atteint ses 24 h.
Laissée en place, elle apprend que la liste peut s'allonger. La prochaine entrée, elle, n'aurait pas
d'auteur pour s'en porter garant.

# 054 — Un 500 ne laisse aucune trace côté serveur

> **Porteur :** step-060

## Ce qu'elle coûte si elle dure

`reportFailedResponse` (`internal/bff/router.go`) rend le 500 et écarte l'erreur : aucun
`*slog.Logger` n'atteint `internal/bff`. Une panne réelle est donc invisible pour qui exploite le
binaire, et l'opérateur à qui le message dit de « prévenir un administrateur » ne lui apporte rien que
le journal puisse confirmer.

Constaté le 24/09/2026 : lancé avec une `DASHBOARD_TOTP_ENCRYPTION_KEY` différente de celle qui avait
chiffré la graine, `POST /auth/mfa/verify` a rendu cinq 500 d'affilée, et le journal du binaire n'a
porté que « le serveur écoute ». Le commentaire de `newContractHandler` désigne déjà step-060, premier
appel réel à la passerelle, pour apporter le journal.

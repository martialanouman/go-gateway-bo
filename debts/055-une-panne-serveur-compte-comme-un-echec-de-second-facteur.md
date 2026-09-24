# 055 — Une panne serveur compte comme un échec de second facteur

> **Porteur :** step-039

## Ce qu'elle coûte si elle dure

`VerifyMfa` (`internal/bff/mfa.go`) réserve l'essai (`SecondFactor.Reserve`, qui incrémente
`login_attempt_counters`) **avant** de vérifier, et ne le rend qu'au succès. Une vérification qui
échoue sur une erreur interne — graine indéchiffrable, base qui tombe — reste comptée : l'opérateur
qui réessaie, comme le message du 500 l'y invite, bloque son propre second facteur pour quinze
minutes sans avoir jamais présenté un code faux.

Mesuré le 24/09/2026 sur une base de test : cinq codes TOTP valides, cinq 500 (clé de chiffrement
changée), compteur `mfa` à 5, puis 429 `too_many_attempts` sur le code suivant. Rendre l'essai sur une
erreur qui n'est pas un refus du code ne rouvre pas la recherche exhaustive : une erreur interne ne
dit rien du code essayé.

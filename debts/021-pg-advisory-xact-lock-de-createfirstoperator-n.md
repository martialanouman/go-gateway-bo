# 021 — `pg_advisory_xact_lock` de `CreateFirstOperator` n'est exercé par aucun test

> **Porteur :** **sans porteur** — step-021 n'en nomme aucun, et le premier déploiement à plusieurs instances est le seul lieu où la course devient observable.

## Ce qu'elle coûte si elle dure

« Deux exécutions concurrentes se croisent trop rarement pour qu'un test qui les lance prouve quoi que ce soit. » Ce n'est donc pas une mutation verte mesurée, c'est une absence de preuve possible.

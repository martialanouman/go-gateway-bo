# 015 — La validation des **requêtes** entrantes contre le schéma n'est pas faite à l'exécution

> **Porteur :** step-060

## Ce qu'elle coûte si elle dure

Le contrat borne les réponses, pas ce qui entre.

**L'asymétrie, nommée.** Les réponses ont un juge machine : `cmd/dashboard/main_test.go` rejoue
chacune à travers `openapi3filter.ValidateResponse`, et tient un registre qui rougit si une route
répond sans que sa réponse ait été confrontée au contrat. Le validateur symétrique du même paquet —
`ValidateRequest` — n'est appelé nulle part, ni en test ni en production.

## Ce que personne n'applique — mesuré le 21/09/2026

Sonde jetable dans `internal/bff`, décodant trois corps dans les types engendrés :

    corps {}                               -> err=<nil>, email="", password=""
    {"email":…,"password":…,"admin":true}  -> err=<nil>  (champ inconnu absorbé)
    {"challenge":"court","method":"carte"} -> err=<nil>, Valid()=false

- **`required` n'est appliqué nulle part.** `encoding/json` laisse la valeur zéro, donc `{}` traverse
  les gardes de longueur — qui ne comparent que des `>` — et atteint `Authenticator.Login`.
- **`additionalProperties: false` n'est appliqué nulle part** : aucun `DisallowUnknownFields` dans le
  dépôt.
- **Aucun `minLength` n'est appliqué.** Un `challenge` de cinq caractères passe, quand le contrat en
  exige 43.
- **Les `enum` sont engendrés mais branchés à la main.** `Valid()` existe pour les cinq enums du
  contrat et rend bien `false` ; seul un appel explicite du handler en fait un refus. `mfa.go:430` le
  fait ; une opération future qui l'oublie ne fera rougir personne.

Ce qui garde réellement une requête aujourd'hui : `middleware.RequestSize` à 8 Kio, le type de
contenu, le décodage JSON — qui voit un type faux, jamais une borne —, quatre maxima écrits à la
main (`email` 320, `password` 4096, `code` 64, `challenge` 64) et la garde de permission. Aucun
minimum. Le `challenge` est l'illustration la plus nette : le contrat pose un minimum de 43, le
serveur un maximum de 64 qu'il a inventé, et les deux bornes ne se connaissent pas.

## Pourquoi elle n'est pas urgente

Le coût d'aujourd'hui est **déjà amorti par le limiteur**. `Authenticator.Login` pose le verrou de
source puis le quota de l'adresse **avant** tout hachage : un corps `{}` consomme exactement ce que
consomme un mot de passe faux, sous le même `MaxFailures` dans la même `LockWindow`. Envoyer un
corps vide ne rapporte donc rien à un attaquant.

## Ce qu'il faudra reprendre à neuf le jour venu

Le remède propre est `openapi3filter.ValidateRequest` en middleware, qui exige le contrat **à
l'exécution**, donc `embedded-spec: true`. L'option est aujourd'hui refusée dans
`api/oapi-codegen-bff.yaml`, au motif qu'elle « figerait une copie du contrat dans le binaire ».
Ce motif est plus faible qu'il n'en a l'air : `internal/bff/bff.gen.go` **est déjà** une dérivation
figée du même contrat, et `check-generated` interdit qu'elle dérive. La décision mérite d'être
reprise plutôt qu'héritée.

Et le validateur n'arrive pas seul : un refus champ par champ sans `errors[]` au DTO d'erreur rend un
400 générique, **moins bon** que les refus écrits à la main aujourd'hui. C'est pourquoi step-060 les
porte tous les deux.

**`step-049` ne l'a pas payée, et ne pouvait pas.** Elle engendre bien les bornes du contrat en Zod
(`cmd/zodgen`), mais côté **client** : c'est un confort de saisie, que n'importe quel appelant
contourne. L'invariant (c) exige la garde côté serveur, et `internal/bff/auth.go` continue de
retaper ses deux maxima à la main — sans aucun plancher, d'ailleurs : un mot de passe vide n'y est
pas refusé en 400, il part à `Authenticator.Login` et revient en 401. Mesuré le 20/09/2026.

# step-004 — Contrat BFF : un OpenAPI, deux bouts typés

> **Jalon :** M0 (§4.1, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-000, step-003 · **Bloque :** toute route du BFF

## But
Établir `api/openapi-bff.yaml` comme **la** frontière entre les deux moitiés, et en générer les types
serveur Go **et** les types client TypeScript. C'est ce que §4.1 appelle la sécurité de type de bout
en bout — et c'est le mécanisme, pas l'intention, qui compte : la formulation précédente de la spec
décrivait un RPC typé que le code n'a jamais implémenté.

## Périmètre (ce que fait CETTE PR)
- `api/openapi-bff.yaml`, initialement réduit à `GET /api/health` — la surface s'étend step par step.
- Génération **serveur** : `oapi-codegen` en mode `chi-server` → interfaces de handler et types de
  requête/réponse sous `internal/bff/`.
- Génération **client** : `openapi-typescript` → types consommés par `openapi-fetch` dans `web/src/`.
- `make generate` enchaîne les deux ; la CI échoue si un fichier généré n'est pas à jour.
- La convention **DTO de sortie déclaré** (§1.11) est posée ici : le type de réponse d'un handler est
  celui qu'engendre le contrat, jamais une `map` ni un type de domaine.

## Points d'implémentation clés
- **Le contrat est écrit à la main, les deux côtés en dérivent.** L'inverse — dériver le contrat du
  code Go — ferait du serveur la source de vérité et rendrait toute rupture invisible au client
  jusqu'à l'exécution.
- **Ce contrat n'est pas celui de la passerelle.** Il en reprend le vocabulaire (`link_status`,
  `breaker_state`, §1.5) mais sa forme est celle dont l'écran a besoin : le BFF compose, filtre et
  masque. Là où les deux formes divergent, le YAML le commente.
- Un handler qui n'implémente pas l'interface générée **ne compile pas**. C'est ce qui rend la
  frontière tenable sur 133 opérations sans discipline.
- Le test de DTO (§1.11) vit ici : il refuse `map[string]any` et l'embedding de struct dans un type de
  réponse. Il ne trouvera rien aujourd'hui — c'est un filet posé avant qu'il y ait de quoi tomber.

## Tests (écrits dans la même PR)
- **Scénario** : *Quand* `/api/health` est appelé, *Alors* la réponse valide le schéma du contrat.
- Un handler dont la signature diverge de l'interface générée **ne compile pas** — vérifié par un cas
  de compilation négatif, pas par une affirmation.
- Le test de DTO refuse un type de réponse contenant `map[string]any`.
- La CI échoue si `make generate` produit un diff.

## Definition of Done
- [ ] `make check` vert · `make generate` idempotent
- [ ] les types client et serveur viennent du **même** fichier, et rien ne les recopie à la main
- [ ] la mutation « introduire une `map[string]any` dans un DTO de réponse » fait rougir le test

## Hors périmètre
Les routes métier — chacune arrive avec sa step. L'authentification → M1.

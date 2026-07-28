# step-183 — Réconciliation Alertmanager  ⚠️ BLOQUÉE

> **Jalon :** M9 (§6.8) · **Statut :** **BLOQUÉE — dépend d'une PR contrat côté `go-gateway`**
> **Dépend de :** step-180, **+ une surface Alertmanager dans `api/openapi-admin.yaml`** · **Bloque :** —

## But
Vérifier que les règles déclarées avec `evaluation_owner = alertmanager` **existent réellement** dans
Alertmanager, et remonter toute dérive — une règle qu'on croit active et qui n'existe pas est pire
que pas de règle du tout.

## ⚠️ Blocage à lever avant de commencer
Le §6.8 prévoit que créer ou éditer une règle infra « écrit aussi la config Alertmanager via l'API
Admin ». Or `openapi-admin.yaml` **1.0.0** (134 opérations) n'expose **aucune** surface Alertmanager :
ni écriture de règle, ni lecture des règles actives.

**Ni le write-through ni la réconciliation ne sont implémentables en l'état.** Avant d'ouvrir cette
step :
1. Ouvrir une PR dans `go-gateway/api/` ajoutant les opérations nécessaires (au minimum une lecture
   des règles Alertmanager actives, idéalement l'écriture).
2. Bumper `api/package.json` (mineur : nouvelles opérations) et laisser `make contracts` valider.
3. Mettre à jour la dépendance ici, puis dérouler le périmètre ci-dessous.

**Ne pas contourner** en interrogeant Alertmanager directement depuis le BFF : le §3.2 réserve cet
accès à Alertmanager lui-même et interdit au tableau de bord de parler à la pile de métriques.

## Périmètre (une fois le blocage levé)
- Write-through : créer/éditer une règle `evaluation_owner = alertmanager` écrit aussi la config
  Alertmanager via l'API Admin.
- **Job périodique de réconciliation** : comparer les règles déclarées et les règles réellement
  actives ; remonter la dérive comme notification et sur l'écran des alertes.
- Badge « non confirmée dans Alertmanager » sur toute règle infra non réconciliée.

## Points d'implémentation clés
- Une dérive doit être **visible sur la règle elle-même**, pas seulement dans une notification qu'on
  peut manquer.
- La réconciliation est en lecture seule : elle signale, elle ne corrige pas silencieusement.
- Tant que le blocage n'est pas levé, l'écran de step-180 affiche l'avertissement que la déclaration
  Alertmanager est manuelle.

## Tests (une fois le blocage levé)
- Règle déclarée mais absente d'Alertmanager → dérive remontée et badge affiché.
- Règle présente des deux côtés → aucune dérive.

## Definition of Done
- [ ] blocage levé : opérations présentes au contrat et version bumpée
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] dérive visible sur la règle · aucun accès direct à Alertmanager depuis le BFF

## Hors périmètre
L'évaluation des métriques métier → step-182.

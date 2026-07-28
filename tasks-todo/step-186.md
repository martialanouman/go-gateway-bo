# step-186 — Déploiement HA (≥2 instances, affinité WS) + durcissement production

> **Jalon :** M9 (§1.2, §1.3, §4.1) · **Statut :** À FAIRE
> **Dépend de :** step-044, step-185 · **Bloque :** —

## But
Livrer la topologie qui rend la cible de 99,9 % atteignable, et fermer les portes avant l'exposition.

## Périmètre (ce que fait CETTE PR)
- Image de production (Node, multi-étapes, utilisateur non root) et manifeste de déploiement à
  **≥2 instances** derrière un load balancer avec **affinité WebSocket**.
- Sondes de vivacité et de disponibilité distinguant « le process tourne » de « les dépendances
  répondent » (Postgres, Redis, API Admin).
- Arrêt propre : drainage des sockets, libération du bail de consommation amont (step-044),
  **déploiement sans coupure** vérifié.
- Durcissement : en-têtes de sécurité et CSP, limitation de débit sur les routes d'authentification,
  cookies stricts, secrets par l'environnement, `pnpm audit` en CI.
- Runbook de mise en production : variables requises, ordre de démarrage, rollback, quoi surveiller.

## Points d'implémentation clés
- **Invariant (e)** : une panne du tableau de bord ne dégrade que la visualisation. Le runbook doit
  l'affirmer et rappeler que l'alerting infra continue via Alertmanager (§1.2).
- L'affinité WS est une exigence du load balancer, pas de l'application : la documenter explicitement,
  sinon un déploiement standard cassera les sockets à chaque requête.
- La CSP doit être compatible avec **Monaco** (step-124) : c'est le point de friction classique — le
  vérifier plutôt que de le découvrir en production.
- Un déploiement roulant ne doit déconnecter aucun opérateur (sessions partagées, step-022) : le tester,
  pas le supposer.

## Tests (écrits dans la même PR)
- Déploiement roulant à deux instances : aucune session perdue, reprise WS transparente.
- Sondes : une dépendance indisponible sort l'instance du service sans tuer le process.
- CSP active et Monaco fonctionnel ; en-têtes de sécurité vérifiés par test.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm e2e` verts
- [ ] déploiement sans coupure vérifié · runbook complet · aucun secret dans l'image

## Hors périmètre
L'observabilité applicative détaillée (métriques du BFF lui-même), à traiter séparément si le besoin
apparaît en exploitation.

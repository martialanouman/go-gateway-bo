# step-045 — Client WS React : abonnement par sujet, reconnexion, remise en état

> **Jalon :** M2 (§4.2, §5.2) · **Statut :** À FAIRE
> **Dépend de :** step-043 · **Bloque :** step-046, step-081, step-085

## But
Donner aux écrans une façon unique et sûre de consommer le temps réel : un hook par sujet, une seule
socket, et un comportement honnête quand la connexion tombe.

## Périmètre (ce que fait CETTE PR)
- Fournisseur de socket unique pour l'application ; `useTopic(topic)` gère l'abonnement au montage et
  le désabonnement au démontage (compteur de références : deux widgets, un seul abonnement).
- Reconnexion avec repli exponentiel et gigue, reprise des abonnements après reconnexion.
- **Instantané REST au chargement puis flux** : le hook expose `data`, `updatedAt`, `isLive`,
  `isStale` pour que l'écran puisse le dire.
- Intégration TanStack Query : le message WS met à jour le cache, il ne crée pas un second état.

## Points d'implémentation clés
- La fraîcheur visée est de **2–5 s** (§1.2) : au-delà, l'UI doit basculer en « données périmées »,
  jamais laisser croire au direct.
- Le point pulsant ne s'affiche que si `isLive` ; un instantané REST n'est pas du direct (charte).
- Onglet en arrière-plan : réduire ou suspendre les abonnements pour ne pas payer 300 opérateurs
  × N widgets inutilement (§2).
- Aucun état global maison en doublon de TanStack Query.

## Tests (écrits dans la même PR)
- Deux composants sur le même sujet → un seul abonnement ; démontage de l'un ne coupe pas l'autre.
- Coupure : passage en `isStale`, reconnexion, reprise des abonnements, retour en `isLive`.
- Un message WS met à jour le cache Query sans re-render superflu.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] fraîcheur et état de connexion exposés et affichables

## Hors périmètre
Les widgets de trafic → step-080 et step-081.

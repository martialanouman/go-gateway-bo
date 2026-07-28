# step-181 — Webhook Alertmanager entrant + distribution des notifications

> **Jalon :** M9 (§6.8, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-180, step-046 · **Bloque :** —

## But
Recevoir ce qu'Alertmanager a détecté et le distribuer, sans jamais prétendre que le tableau de bord
est la source de la détection.

## Périmètre (ce que fait CETTE PR)
- `POST /internal/alertmanager-webhook` : endpoint **serveur à serveur**, authentifié par **mTLS ou
  secret partagé** (§5.1), hors session opérateur.
- Insertion dans `notifications` avec `source = alertmanager`.
- **Distribution** sur les canaux configurés (email / webhook / slack) avec **dédoublonnage** :
  notification sur transition, plus rappel périodique pour la sévérité `critical`.
- Rendu en direct via le sujet WS `notifications` (step-046).

## Points d'implémentation clés
- **Affichage, pas détection** (§6.8) : Alertmanager peut paginer directement ; ce webhook alimente le
  centre de notification. Si l'insertion échoue, l'alerte n'est pas perdue pour autant — mais l'échec
  doit être journalisé bruyamment.
- L'endpoint est le seul du BFF sans session opérateur : il doit être isolé, limité en débit, et
  rejeter tout appel non authentifié sans divulguer d'information.
- Le dédoublonnage se fait sur la **transition d'état**, pas sur le message : Alertmanager renvoie le
  même groupe plusieurs fois.
- Idempotence : deux livraisons du même événement ne créent pas deux notifications.

## Tests (écrits dans la même PR)
- Appel non authentifié rejeté ; appel authentifié crée une notification.
- Double livraison du même événement → une seule notification (idempotence).
- Rappel périodique déclenché pour `critical`, pas pour `info`.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] endpoint isolé et authentifié · idempotence testée

## Hors périmètre
L'évaluation des métriques métier → step-182.

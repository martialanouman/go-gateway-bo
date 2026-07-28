# step-046 — Centre de notifications

> **Jalon :** M2 (§3.1, §6.8) · **Statut :** À FAIRE
> **Dépend de :** step-002, step-045, step-042 · **Bloque :** step-181

## But
Donner un endroit unique où atterrissent les alertes, avec la mention de **qui les a détectées** —
Alertmanager ou le BFF — parce que ça change ce qu'on peut en conclure.

## Périmètre (ce que fait CETTE PR)
- Table `notifications` (§3.1) : `source` (`alertmanager` | `bff_evaluator` | `billing_alert_stream`),
  `severity`, `message`, `read_by_operators`.
- `GET /notifications` (pagination, filtre lu/non lu, sévérité) et `POST /notifications/{id}/read`.
- Panneau dans la barre supérieure : compteur de non-lus, liste, marquage lu, lien vers la ressource
  concernée.
- Toast en direct sur réception via le sujet WS `notifications`, barre latérale colorée par sévérité.
- Distinction visuelle de la source (bleu `alertmanager`, violet `bff`) comme le prévoit la charte.

## Points d'implémentation clés
- L'affichage n'est **jamais** la détection (§6.8, invariant e) : une notification manquée à l'écran
  ne doit pas signifier une alerte perdue — la persistance en base fait foi, le WS n'est qu'un
  raccourci d'affichage.
- `read_by_operators` est par opérateur : marquer lu ne masque pas la notification aux autres.
- Rétention et purge des notifications anciennes définies ici, pas laissées à croître.

## Tests (écrits dans la même PR)
- Une notification poussée en WS apparaît en toast et dans la liste ; l'état lu est par opérateur.
- Un opérateur déconnecté au moment de l'alerte la retrouve à sa reconnexion (persistance).
- La source est rendue distinctement.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] persistance vérifiée hors WS · rétention définie

## Hors périmètre
Le webhook Alertmanager entrant → step-181. L'évaluateur BFF → step-182. Les règles → step-180.

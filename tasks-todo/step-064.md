# step-064 — Fiche compte : canaux, politique de sender ID, bascules SMPP, webhooks

> **Jalon :** M3 (§1.1, §6.14) · **Statut :** À FAIRE
> **Dépend de :** step-063 · **Bloque :** step-065, step-066

## But
Rassembler sur une page tout ce qui définit le comportement d'un compte, hors quotas et identifiants.

## Périmètre (ce que fait CETTE PR)
- Onglet **Canaux** : `set-account-channels` (SMPP / REST).
- Onglet **Politique de sender ID** : `set-account-sender-id-policy`.
- Bascules **`query_sm` / `cancel_sm`** : `set-account-smpp-ops`.
- Onglet **Webhooks MO/DLR** : `list-webhooks`, `create-webhook`, `update-webhook`, `delete-webhook`.
- Mise à jour générale du compte : `update-smpp-account`.

## Points d'implémentation clés
- Les identifiants techniques restent **verbatim et en mono** : `query_sm`, `cancel_sm` ne se
  traduisent pas — un opérateur les cherche dans les logs.
- Chaque bascule énonce sa conséquence côté client (ce que le compte pourra ou ne pourra plus faire),
  pas seulement son nom.
- Webhooks : afficher l'URL, l'état, la dernière remise ; **jamais** le secret de signature en clair
  (invariant b).
- Couper un canal actif est une action à conséquence : confirmation avec impact chiffré si des binds
  sont vivants.

## Tests (écrits dans la même PR)
- Chaque réglage se sauvegarde et se relit ; refusé sans `accounts:write`.
- Le secret d'un webhook n'apparaît jamais dans une réponse ni dans le DOM.
- Couper un canal avec binds vivants demande confirmation et affiche l'impact.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] invariant (b) tenu sur les webhooks · conséquences énoncées

## Hors périmètre
Quotas et `max_sessions` → step-065. Identifiants → step-066.

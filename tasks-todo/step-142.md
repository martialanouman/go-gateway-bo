# step-142 — Outil « pourquoi ce message a-t-il été bloqué ? » + avertissement structurel

> **Jalon :** M7 (§6.16) · **Statut :** À FAIRE
> **Dépend de :** step-140 · **Bloque :** —

## But
Répondre en une requête à la question de support la plus fréquente sur l'opt-out : bloqué ou non, et
**par quelle portée**.

## Périmètre (ce que fait CETTE PR)
- Outil de vérification (`check-suppression`) : destinataire + expéditeur + compte → **bloqué ou non**,
  et **par quelle portée** (canal, client, plateforme).
- Résultat copiable pour un ticket, sans exposer plus que nécessaire.
- **Avertissement structurel** : signaler les comptes n'envoyant que depuis des expéditeurs
  **alphanumériques sans numéro entrant** — ils n'ont aucun moyen de recevoir un désabonnement.

## Points d'implémentation clés
- Le §6.16 veut la portée **décideuse**, pas un simple booléen : « bloqué » sans « par quoi » ne
  résout aucun ticket.
- L'avertissement structurel est une analyse croisée (sender IDs du client × numéros entrants du
  compte) : la calculer côté BFF et énoncer la conséquence, pas seulement le symptôme.
- Cet outil est en lecture seule et ne doit jamais proposer la levée en un clic : c'est un acte
  séparé (step-143).
- Aucune donnée de contenu n'entre dans cette vérification (invariant a).

## Tests (écrits dans la même PR)
- Un MSISDN bloqué au niveau canal renvoie la portée canal ; bloqué au niveau plateforme, la portée
  plateforme.
- Un non-bloqué renvoie un « non bloqué » explicite, pas un vide.
- L'avertissement structurel apparaît exactement pour un compte alphanumérique sans numéro entrant.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] portée décideuse toujours affichée · aucun raccourci vers la levée

## Hors périmètre
La levée → step-143.

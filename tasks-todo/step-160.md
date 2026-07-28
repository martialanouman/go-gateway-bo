# step-160 — Facturation : proxy fin + dégradation « module désactivé »

> **Jalon :** M8 (§1.3, §6.11) · **Statut :** À FAIRE
> **Dépend de :** step-062, step-042 · **Bloque :** step-161, step-162, step-163

## But
Brancher la section Facturation en proxy sans état — et traiter le cas où le module est éteint côté
passerelle comme une dégradation propre, jamais comme une panne.

## Périmètre (ce que fait CETTE PR)
- Section Facturation visible aux détenteurs d'une permission `billing:*`, uniquement quand le module
  est activé.
- Détection de l'état du module et rendu de l'état **`ModuleDisabled`** : « Module désactivé sur la
  passerelle. Dégradation propre — jamais une erreur. »
- Squelette des écrans et routage ; `get-customer-billing`, `update-customer-billing`.
- Aucune donnée financière copiée côté BFF (§1.3, §7).

## Points d'implémentation clés
- Le §1.3 est net : l'UI de facturation est un **proxy fin**, sans donnée propre. Aucune table, aucun
  cache persistant de solde — le coût est un aller-retour par chargement, assumé au §7.
- « Module désactivé » n'est **pas** une erreur : ni toast rouge, ni bouton Réessayer. C'est un état
  distinct des cinq (step-042).
- Ne pas masquer entièrement la section quand le module est éteint : expliquer, c'est plus utile
  qu'un menu qui change de forme selon l'environnement.
- Chaque nombre affiché est un **compteur entier de crédits**, jamais une devise formatée.

## Tests (écrits dans la même PR)
- Module désactivé → `ModuleDisabled`, aucune requête d'erreur, aucun toast.
- Sans permission `billing:*`, la section est inaccessible.
- Aucun état de solde persisté côté BFF (test de non-régression).

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] dégradation propre testée · aucune donnée financière stockée

## Hors périmètre
Les soldes → step-161. Les mouvements → step-162.

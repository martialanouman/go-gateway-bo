# step-162 — Recharge, transfert, changement de `balance_scope`

> **Jalon :** M8 (§6.11) · **Statut :** À FAIRE
> **Dépend de :** step-161 · **Bloque :** —

## But
Livrer les mouvements de crédits, y compris le changement de portée — un bouton visible mais inerte
tant que ses conditions ne sont pas réunies.

## Périmètre (ce que fait CETTE PR)
- **Recharge** (`topup-balance`, `billing:topup`) : entier non négatif, **par direction**
  (`mt` | `mo`), avec `accountId` optionnel.
- **Transfert** (`transfer-balance`, `billing:write`).
- **Changement de `balance_scope`** (`change-balance-scope`, permission **`billing:scope_change`**) :
  bouton **visible mais inerte** tant qu'un solde n'est pas à zéro, avec l'explication en ligne.
- Confirmations à conséquence pour chaque mouvement.

## Points d'implémentation clés
- Le bouton de changement de portée est **visible et inerte**, pas masqué (§6.11) : l'opérateur doit
  comprendre la condition (« tous les soldes doivent être à zéro »), pas chercher une fonctionnalité
  absente.
- La recharge est **par direction** : recharger un compteur MO n'a pas le même sens qu'un solde MT —
  l'UI doit refuser ou expliquer selon ce que le contrat autorise.
- Entiers non négatifs uniquement : validation côté serveur, pas seulement côté champ.
- `account_manager` n'a **pas** `billing:topup` (§6.10) : vérifier ce refus explicitement.

## Tests (écrits dans la même PR)
- Recharge MT valide ; valeur négative ou non entière refusée côté serveur.
- Changement de portée inerte quand un solde est non nul, avec explication ; actif à zéro.
- `account_manager` ne peut pas recharger.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] bouton inerte plutôt que masqué · mouvements audités

## Hors périmètre
Plans tarifaires et fournisseurs → step-163.

# step-161 — Solde MT vs compteur MO, `balance_scope`, grand livre

> **Jalon :** M8 (§6.11, §7) · **Statut :** À FAIRE
> **Dépend de :** step-160 · **Bloque :** step-162

## But
Empêcher le malentendu central de la facturation : le MT est un solde qui bloque, le MO est un
compteur qui monte et ne bloque rien.

## Périmètre (ce que fait CETTE PR)
- **Deux cartes distinctes** (`get-customer-balances`) :
  - **Solde MT** — un vrai solde (« 12 450 SMS restants »), bloque à zéro en prépayé sans découvert.
  - **Compteur MO** — usage postpayé (« MO consommé : 3 120 crédits », qui monte), avec le plancher
    `mo_billing_floor`.
- Texte explicite du §6.11 : « le MO est toujours remis, un dépassement MO ne bloque jamais vos
  envois MT. »
- **`balance_scope` affiché en permanence** : en pool partagé, ventilation de la consommation par
  compte ; en par-compte, une carte MT + MO par compte.
- **Grand livre** paginé (`get-billing-ledger`, `?direction=&accountId=`), filtrable par direction et
  par compte.

## Points d'implémentation clés
- Le §7 en fait un compromis explicite : « présentés comme deux objets différents ». Une seule carte
  avec deux lignes raterait le point de la step.
- Le grand livre porte `owner_*`, `customer_id` et `account_id` : la ventilation en pool partagé s'en
  déduit, elle ne s'invente pas côté client.
- Tous les nombres sont des entiers de crédits, en mono.
- La pagination du grand livre suit la même discipline que le CDR : serveur, stable.

## Tests (écrits dans la même PR)
- Les deux cartes rendent des sémantiques distinctes ; le texte « ne bloque jamais vos envois MT » est
  présent.
- `balance_scope = shared` → ventilation par compte ; `per_account` → une paire de cartes par compte.
- Le grand livre filtre par direction et par compte.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] deux cartes distinctes testées · `balance_scope` toujours visible

## Hors périmètre
Recharge et changement de portée → step-162.

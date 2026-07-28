# step-140 — Suppressions : liste scopée par canal + origine

> **Jalon :** M7 (§6.16) · **Statut :** À FAIRE
> **Dépend de :** step-041, step-025 · **Bloque :** step-141, step-142, step-143

## But
Rendre un désabonnement lisible tel qu'il existe vraiment : **le canal est l'unité**, pas le client
ni la plateforme.

## Périmètre (ce que fait CETTE PR)
- Écran Désabonnements (`suppressions:read`) : `list-suppressions` (`?scope=&scopeId=&msisdn=`).
- Formulation d'une ligne comme le prescrit le §6.16 : « +225… s'est désabonné du 36000
  (canal *Alertes Banque X*) », avec l'**origine** (`mo_stop` / `admin` / `import` / `regulator`).
- Portées plus larges (client, plateforme) affichées **comme telles**, sans être confondues avec un
  canal.
- Filtres par portée, par MSISDN et par origine ; pagination serveur.

## Points d'implémentation clés
- Une liste de MSISDN nus raterait le point de l'écran : sans le canal et l'origine, un opérateur ne
  peut pas juger si le blocage est légitime.
- Le MSISDN est une valeur machine : mono, jamais tronqué silencieusement dans une copie.
- Aucune action destructrice ici : la levée est un écran et une permission à part (step-143).
- Les cinq états de contenu s'appliquent, « aucun résultat » étant très fréquent sur cet écran.

## Tests (écrits dans la même PR)
- La ligne rend canal + origine ; une portée large est rendue distinctement d'un canal.
- Filtres par portée et par MSISDN.
- Sans `suppressions:read`, l'écran est inaccessible.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] canal et origine visibles sur chaque ligne

## Hors périmètre
Création, import, mots-clés → step-141. Levée → step-143.

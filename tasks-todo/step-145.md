# step-145 — File « MO non routés » + création de règle à la volée

> **Jalon :** M7 (§6.7) · **Statut :** À FAIRE
> **Dépend de :** step-144 · **Bloque :** —

## But
Transformer une anomalie en correction : voir les MO que personne n'a réclamés, et créer la règle
manquante sans changer d'écran.

## Périmètre (ce que fait CETTE PR)
- File **MO non routés** (`list-unrouted-mo`) : numéro entrant, expéditeur, mot-clé détecté,
  horodatage, volume.
- Regroupement par cause probable (numéro non affecté, mot-clé inconnu) plutôt qu'un flux brut.
- **Création de règle à la volée** : depuis une ligne, pré-remplir l'affectation ou le mot-clé
  manquant, puis créer (step-144).
- Filtres et plage temporelle.

## Points d'implémentation clés
- **Le corps du MO n'est jamais affiché ici** (invariant a) : seuls le mot-clé détecté et les
  métadonnées. Si l'amont renvoie plus, le BFF filtre.
- Regrouper par cause est ce qui rend la file exploitable : 500 lignes identiques venant d'un même
  numéro non affecté sont un seul problème.
- Après création de la règle, indiquer clairement que les MO **déjà** non routés ne sont pas rejoués —
  ne pas laisser croire à une reprise automatique.
- Volume et tendance aident à prioriser : les afficher.

## Tests (écrits dans la même PR)
- Le regroupement par cause fonctionne ; les compteurs sont exacts.
- La création à la volée pré-remplit et crée la règle attendue.
- Aucun corps de MO n'est présent dans la réponse ni dans le DOM (invariant a).

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] **invariant (a)** testé sur un payload piégé · copie « pas de rejeu » présente

## Hors périmètre
L'anti-spam → step-146.

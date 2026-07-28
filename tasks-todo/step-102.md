# step-102 — Visualiseur de trace (cascade de spans)

> **Jalon :** M5 (§6.12) · **Statut :** À FAIRE
> **Dépend de :** step-101 · **Bloque :** —

## But
Rendre lisible le chemin complet d'un message dans le pipeline, étape par étape, pour répondre à
« pourquoi ce message a fait ça » sans lire un log.

## Périmètre (ce que fait CETTE PR)
- Cascade de spans (`get-message-trace`) par étape : ingestion, autorisation sender ID, opt-out,
  anti-spam, routage, débit, facturation, envoi, DLR, remise.
- Par span : durée, statut, attributs (route / script / connecteur, résultat de facturation, codes
  d'erreur).
- Mise en évidence des étapes **en échec ou lentes**.
- Lien direct partageable vers la trace.

## Points d'implémentation clés
- **Le corps n'apparaît jamais dans la trace** (§6.12, invariant a). Un attribut inattendu venant de
  l'amont doit être filtré côté BFF, pas affiché « parce qu'il était là ».
- L'ordre des étapes est celui du pipeline : ne pas réordonner par durée, sous peine de faire mentir
  la lecture causale.
- Une étape absente (par exemple facturation désactivée) se rend comme **non applicable**, pas comme
  un échec.
- La cascade doit rester lisible sur un message segmenté (plusieurs segments) sans devenir un mur.

## Tests (écrits dans la même PR)
- Rendu de la cascade complète ; étapes en échec signalées.
- Aucun attribut contenant un corps n'est rendu, même si l'amont en renvoie un (cas fabriqué).
- Étape non applicable distincte d'une étape en échec.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] **invariant (a)** couvert par un test sur un payload piégé

## Hors périmètre
L'affichage du corps → step-103.

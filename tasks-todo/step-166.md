# step-166 — Effacement RGPD (client / MSISDN) + suivi de job + attestation

> **Jalon :** M8 (§6.18, §7) · **Statut :** À FAIRE
> **Dépend de :** step-165 · **Bloque :** —

## But
Rendre le droit à l'oubli **exécutable et prouvable**, avec le choix de cible — plutôt qu'un bouton
unique et trompeur.

## Périmètre (ce que fait CETTE PR)
- Action `gdpr-erase` (permission **`gdpr:erase`**) avec **choix de cible** :
  - **client** : crypto-shred + purge, **avertit si le grand livre doit être conservé** pour
    obligation fiscale ;
  - **personne / MSISDN** : suppression ciblée à travers les clients, job asynchrone, **opt-out
    conservé**.
- Suivi de job (`get-gdpr-erase-job`) : états, progression, échecs.
- **Attestation** téléchargeable à l'issue du job.

## Points d'implémentation clés
- Le §7 l'exige : exposer **les deux cibles et leurs conséquences**, pas un bouton unique. Le choix de
  cible est la fonctionnalité.
- **L'opt-out est conservé** après effacement d'une personne : c'est contre-intuitif et juridiquement
  nécessaire — l'écran doit l'expliquer, sinon un opérateur croira l'action incomplète.
- L'avertissement sur le grand livre (rétention fiscale) doit apparaître **avant** lancement, pas dans
  le compte-rendu.
- Le job est asynchrone et long : suivi honnête, aucun « terminé » optimiste, et attestation seulement
  quand le job est réellement fini.
- `compliance` est le seul rôle par défaut habilité (§6.10) : le vérifier.

## Tests (écrits dans la même PR)
- Les deux cibles produisent des conséquences et des avertissements distincts.
- Cible MSISDN : l'opt-out subsiste après effacement (vérifié).
- L'attestation n'est disponible qu'après achèvement réel du job.
- Refusé sans `gdpr:erase`.

## Definition of Done
- [ ] `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` verts
- [ ] conservation de l'opt-out testée · attestation liée à l'achèvement réel

## Hors périmètre
Le journal des accès au contenu → step-103.

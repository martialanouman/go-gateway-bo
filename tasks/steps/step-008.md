# step-008 — Charte portée : tokens, `/_design`, contraste vérifié

> **Jalon :** M0 (§1.7 de la charte) · **Statut :** À FAIRE
> **Dépend de :** step-001, step-007 · **Bloque :** step-041, step-042, step-040

## But
Rendre la charte utilisable : les tokens portés sous `web/src/styles/`, la page de référence
`/_design` qui les montre tous, et un contrôle de contraste qui échoue au lieu de se croire vert.

## Périmètre (ce que fait CETTE PR)
- Portage des ~2 200 lignes de tokens de la v1.0 : couleurs, typographie, espacement, rayons,
  élévations, états de focus.
- Polices **auto-hébergées**, chargées depuis le binaire — aucune requête vers un tiers, y compris en
  développement.
- Page `/_design` : la charte complète sur une route, avec les tokens rendus tels qu'ils s'appliquent.
- Contrôle de contraste **automatisé** sur les paires effectivement utilisées.

## Points d'implémentation clés
- **Le contraste se vérifie sur ce qui est rendu, pas sur la liste des tokens.** Un token conforme
  appliqué sur le mauvais fond produit une paire non conforme ; c'est la paire qui se teste.
- **`/_design` s'adresse à qui écrit un écran**, pas à un opérateur : elle vit hors de la coquille et
  n'a pas de garde de session. Elle n'affiche aucune donnée réelle.
- La v1.0 a livré un bandeau de refus **sans bordure faute d'un token qui n'existait pas** — et
  `pnpm check` était vert. Un token absent doit donc casser la compilation ou le build CSS, jamais
  retomber silencieusement sur une valeur par défaut du navigateur.
- Les tokens sont portés **tels quels**. Cette step ne redessine rien : la charte n'a pas changé, seule
  la pile qui la sert a changé.

## Tests (écrits dans la même PR)
- **Contraste** : chaque paire texte/fond utilisée par `/_design` atteint AA. Le test échoue si une
  paire descend sous le seuil — vérifié en abaissant délibérément une couleur.
- **Token manquant** : référencer un token inexistant fait échouer le build, il ne rend pas une valeur
  vide. C'est la mutation qui reproduit le défaut réel de la v1.0.
- `/_design` rend sans erreur de console et sans requête réseau sortante vers un tiers.

## Definition of Done
- [ ] `make check` vert
- [ ] `/_design` montre la charte complète et sert de référence aux steps d'interface
- [ ] aucune police ni feuille de style chargée depuis un domaine tiers, **vérifié sur le binaire**
- [ ] les deux mutations ci-dessus ont été jouées

## Hors périmètre
Les primitives habillées → step-041 et step-042. La coquille → step-040. L'audit d'accessibilité
complet → step-185.

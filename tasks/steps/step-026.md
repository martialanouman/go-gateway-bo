# step-026 — Le DTO de sortie tient sur des routes qui portent enfin des secrets *(invariant a, moitié structurelle)*

> **Jalon :** M1 (§1.11) · **Statut :** À FAIRE
> **Dépend de :** step-022, step-025 · **Bloque :** step-029, step-066, step-103

## But
Fermer ce que la porte de step-004 laisse passer, maintenant que le BFF manipule des secrets. Jusqu'à
M1 elle gardait une sonde de vivacité : rien qu'elle refusait n'aurait fui quoi que ce soit. À partir
d'ici, un champ de trop est un hachage de mot de passe, un secret TOTP ou une clé de session.

## Périmètre (ce que fait CETTE PR)
- **Fermer le trou nommé** par `internal/bff/api.go` : un `Visit…Response` écrit à la main sérialise
  ce qu'il veut, et la porte structurelle reste verte — mesuré le 02/08/2026, sur un type de réponse
  **sans champ**.
- Une porte qui refuse qu'un **type de domaine** (l'opérateur du store, la session, un
  authentificateur) soit atteignable depuis un type de réponse, à quelque profondeur que ce soit.
- Une porte nommant les champs qu'aucune réponse ne doit porter : `password_hash`,
  `mfa_totp_secret`, `mfa_webauthn_credentials`, secret de session, code de récupération.
- La règle inscrite là où elle se lit — dans le paquet qui écrit les DTO, pas seulement dans un test.

## Points d'implémentation clés
- **Ne pas réécrire ce qui existe.** `TestResponseTypesDeclareTheirFields` (step-004) refuse déjà les
  `map` et les `any` à toute profondeur et l'embarquement d'un type que le générateur n'a pas écrit ;
  elle recharge le paquet par le type-checker, donc elle voit **les types que les steps futures
  ajoutent** sans qu'on la touche. Cette step attaque ce qu'elle ne voit pas, et `api.go` le nomme
  déjà en toutes lettres.
- **Une liste de champs interdits vieillit mal** : elle ne connaît que les secrets d'aujourd'hui. Elle
  se double donc d'une règle de **forme** — aucun type déclaré hors du contrat ne traverse une
  réponse —, faute de quoi le prochain secret ne sera simplement pas dans la liste.
- **Le mode strict retire le `ResponseWriter` du handler, pas du type de réponse** (§1.11, amendement
  du 02/08/2026). C'est la phrase exacte du trou : ce qui reste à garder est la **méthode de
  sérialisation**, pas la signature du handler.
- Ce que cette step **ne** couvre pas, et qui appartient à M5 : le scan transversal — logs, URL,
  exports, cache persisté, attributs de trace. L'invariant (a) a deux moitiés (`plan.md` §17.4) ;
  celle-ci est la structurelle.

## Tests (écrits dans la même PR)
- Un type de réponse dont le `Visit…` écrit un champ absent de sa déclaration est **détecté**.
- Un type de réponse qui embarque ou référence un type du store est détecté.
- Aucun type de réponse n'expose un des champs nommés, à aucune profondeur.
- Les portes restent **mordantes** : chacune est vue tomber sur une sonde jetable, et le constat écrit
  — une porte qu'on n'a pas vue rougir ne prouve rien.

## Definition of Done
- [ ] `make check` vert
- [ ] la mutation « ajouter `PasswordHash` au DTO de `/auth/me` » fait rougir
- [ ] la mutation « écrire un `Visit…` à la main qui ajoute un champ » fait rougir — c'est la raison
      d'être de cette step, et elle était **verte** avant
- [ ] la mutation « embarquer le type de domaine de l'opérateur dans une réponse » fait rougir
- [ ] ce qui reste hors de portée est écrit là où il vit, pas seulement dans cette fiche

## Hors périmètre
Le scan transversal de l'invariant (a) — logs, URL, export, cache, trace → step-103. Le corps de
message et sa garde → step-103. Les secrets d'identifiants de bind → step-066 (invariant b).

# step-049 — Socle de formulaires : React Hook Form, Zod engendré, `Field` en adaptateur

> **Jalon :** M2 (§4.1, §1.4) · **Statut :** À FAIRE
> **Dépend de :** step-041 (le primitif `Field`), step-027 (les deux formulaires qui servent de
> preuve) · **Bloque :** step-028, step-029
>
> *Elle se lit **avant** les deux écrans de formulaire qui restent à M1. Sans elle, step-028 et
> step-029 écrivent le cousu main de step-027 une deuxième et une troisième fois — et la migration
> coûte alors trois écrans au lieu de deux.*

## But
Donner aux formulaires un mécanisme, là où il n'y en a aucun. Et fermer un trou qu'on n'avait pas
nommé : **les bornes du contrat n'atteignent pas le client**.

## Le constat qui décide

`openapi-typescript` engendre la forme et **jette les contraintes** :

```ts
LoginRequest: { email: string; password: string }   // web/src/lib/api.gen.ts
```

Le contrat, lui, déclare `email.maxLength: 320`, `password.minLength: 1`, `password.maxLength: 4096`.
Côté serveur, `internal/bff/auth.go` les redit à la main **avec sa justification écrite** — « rien
dans ce dépôt ne valide une requête à l'exécution contre le YAML ». Côté client, personne ne les
connaît : le contrôle de format d'e-mail livré par step-027 a **inventé** sa règle sans regarder le
contrat.

## Ce qui est en place aujourd'hui
Aucun mécanisme. Deux écrans, deux copies : un `useState` par champ, un objet `missing`, les
contrôles en ligne dans `onSubmit`, un effacement manuel dans chaque `onChange`, et `noValidate` pour
faire taire le navigateur.

## Ce que les écrans à venir demandent
La spécification ne promet pas des formulaires à trois champs :

| Écran | Ce qu'il exige | §  |
|---|---|---|
| Connecteur SMSC | **divulgation progressive** — requis d'abord, « Avancé » pour l'ensemble SMPP ; un formulaire plat « serait accablant » | 6.5 |
| Éditeur de route | la **forme dépend d'un champ** : poids pour `weighted`, ordre pour `failover_priority` | 6.1 |
| Numéros entrants, cibles, imports | des **lignes répétables** | 6.1, 6.4 |

Base UI n'a rien pour les lignes répétables ni pour la re-déclaration dynamique de champs.
`useFieldArray` et les unions discriminées de Zod adressent exactement ces trois lignes.

## Périmètre (ce que fait CETTE PR)
- **Trois dépendances** : `react-hook-form`, `zod`, `@hookform/resolvers`. Relevées au 20/09/2026 en
  7.88.0, 4.6.5 et 5.9.1 — **à relever de nouveau au début de la step**, la quarantaine de 24 h
  (`minimumReleaseAge`, `minimumReleaseAgeStrict`) décidant de ce qui s'installe.
- **Un générateur de schémas Zod depuis `api/openapi-bff.yaml`**, monté dans `make generate` et gardé
  par `check-generated`, à côté d'`api.gen.ts` et de `permissions.gen.ts`. C'est lui qui porte les
  bornes ; **aucune n'est retapée à la main**.
- **`Field` devient l'adaptateur qu'il est déjà à moitié.** Il consomme un `error` de l'extérieur et
  force `match` — dont la documentation de Base UI dit qu'il « lets external libraries control the
  visibility ». Le rendu, les libellés, `aria-invalid` et `role="alert"` ne bougent pas.
- **`/login` et `/mfa` migrent, et c'est la preuve** : deux formulaires déjà tenus par les tests de
  step-027, donc une migration qui se **mesure** au lieu de s'espérer.

## Points d'implémentation clés
- **Zod engendré, jamais écrit — pour ce que le contrat déclare.** Une troisième rédaction des mêmes
  bornes dériverait, et ce dépôt en a déjà payé le prix ailleurs. Ce qui ne décrit aucun contrat —
  « les deux mots de passe concordent », « au moins une cible » — reste écrit à la main, et c'est
  légitime.
- **Une contrainte resserrée au contrat doit rougir ici.** C'est tout l'intérêt d'engendrer : un
  `maxLength` abaissé dans le YAML change le schéma, donc le test. `tasks/plan.md` §1.12 dit que la
  compilation n'est pas le filet qu'on croit.
- **Quatre couches, aucune qui marche sur les pieds d'une autre** : RHF tient l'état du formulaire,
  Zod la forme, Base UI le rendu, TanStack Query l'état serveur et le refus global. Ne **pas**
  brancher le moteur de validité de Base UI en parallèle de RHF — deux systèmes de validation dans
  le même champ, c'est la garde qui en masque une autre.
- **La couture pour `errors[]` se pose, sans consommateur.** Le `errors` de Base UI comme le
  `setError` de RHF s'indexent par nom de champ ; le contrat ne porte `errors[]` qu'à partir de
  step-060. Poser le nom de champ maintenant coûte une prop ; le rétro-ajouter coûtera chaque écran.
- **Le refus global n'est pas un refus de champ.** Le 401 de `/auth/login` ne nomme jamais lequel des
  deux a manqué — délibérément. Il reste hors du schéma, dans le bandeau, et la règle « un refus qui
  survit à ce qu'il reproche fait douter de tous les autres » vaut pour lui.

## Mesures à faire dans la step, pas avant
- **Le coût réel sur le bundle.** Les tailles non compressées du registre (1,5 Mo / 6,1 Mo / 1,2 Mo)
  recouvrent plusieurs cibles de build et ne disent rien de ce qui part sur le fil. `index.js` pèse
  199 603 octets au 20/09/2026 — c'est ce chiffre-là qu'on compare.
- **Les avis de sécurité des trois paquets**, avant adoption et non après. `react-hook-form` et `zod`
  n'annoncent aucune dépendance transitive ; `@hookform/resolvers` en a une.

## Tests (écrits dans la même PR)
- **Le générateur** : une contrainte resserrée dans le YAML change la sortie engendrée. Mesuré en
  abaissant un `maxLength`, pas en lisant le générateur.
- **Les bornes atteignent l'écran** : un mot de passe de 4 097 caractères est refusé **par le schéma
  engendré**, et le refus nomme la borne. La mutation qui retire la contrainte du schéma rougit.
- **La migration ne perd rien** : les tests de step-027 passent sans être réécrits pour l'occasion.
  Un test qu'il faut retoucher pour rester vert est un test qui décrivait l'implémentation.
- **Les quatre couches ne se doublent pas** : un seul message par champ en refus, et non deux — celui
  de RHF et celui de Base UI.

## Definition of Done
- [ ] `make check` vert et `make e2e` vert
- [ ] les trois versions et leurs avis de sécurité sont **relevés dans la PR**, pas supposés
- [ ] le coût sur le bundle est chiffré, avant et après, et assumé par écrit
- [ ] la mutation « retirer une borne du schéma engendré » fait rougir
- [ ] la mutation « resserrer une contrainte du YAML sans régénérer » fait rougir `check-generated`
- [ ] aucun test de step-027 n'a été réécrit pour faire passer la migration

## Hors périmètre
Les écrans qui n'existent pas — step-028 et step-029 consommeront le socle, elles ne le livrent pas.
L'éditeur Monaco → M6. Le `errors[]` du serveur → step-060, dont cette step ne pose que la couture.
La migration de formulaires hors `web/src/routes/` : il n'y en a aucun.

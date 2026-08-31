# step-032 — Le harnais de test : conteneur, délai godog, authentificateur épinglé

> **Jalon :** M1 (§17.4, `plan.md`) · **Statut :** À FAIRE
> **Dépend de :** step-007 · **Bloque :** — (mais elle allège toutes les suivantes)
>
> *Elle se lit **avant** M2, et c'est le seul argument qui compte : un harnais qui casse sous la charge
> coûte davantage à chaque step ajoutée, et il a déjà coûté huit jours.*

## But
Réparer les trois défauts du harnais que personne ne possède. Aucune step ne touche
`internal/bddtest` ni les dépendances de test depuis step-007, livrée — et `plan.md` §2.1 dit
pourtant que **les six blocages de la première tentative venaient tous de l'outillage**, aucun du code
métier.

Cette step-ci n'est pas une prévention : elle paie un coût **déjà encaissé**.

## Périmètre (ce que fait CETTE PR)
- **Le conteneur PostgreSQL des scénarios ne doit plus mourir sous la charge.**
- **Rendre au délai godog un filet de performance**, que le passage de 2 s à 15 s a supprimé.
- **Décider du sort de `descope/virtualwebauthn`**, épinglée sur `go-webauthn v0.16.5`.
- **La borne de démarrage du binaire**, passée de 5 s à 30 s, et l'**amortissement de testcontainers**
  entre paquets.

### Cinq dettes que cette step hérite

*Écrites ici et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est ouverte par
personne. Les trois figurent au registre de `todo.md`.*

- **Le conteneur PostgreSQL meurt sous la charge, et c'est la seule dette du projet dont le coût est
  chiffré.** `done/step-023.md`, mesuré le 27/08/2026 : « c'est lui qui a fait rougir "Tests Go" sur
  la CI […] Cet échec a **bloqué un bump de `kin-openapi` pendant huit jours** en faisant croire à une
  rupture de la bibliothèque. Le coût n'est donc pas l'inconfort d'une suite rouge : c'est une
  dépendance qu'on n'ose plus bumper. »

  C'est le mode d'échec le plus cher qu'un harnais puisse avoir — il ne fait pas perdre du temps, il
  fait **prendre la mauvaise décision** sur une dépendance de sécurité.

- **Le filet de performance n'existe à aucune valeur du délai godog**, passé de 2 s à 15 s pour
  absorber ce même conteneur. `done/step-023.md`, en entier parce que la fin change le sens : « une
  régression qui rendrait une route dix fois plus lente ne rougirait plus ici. Rien ne la garderait
  par ailleurs, **et c'était déjà vrai à deux secondes**. » Le passage à 15 s n'a donc **rien créé** —
  il a rendu visible ce qui manquait déjà, et le délai reste ce que step-023 dit qu'il est : une borne
  anti-suspension, pas une assertion de performance. Le rendre à sa valeur courte prouve que le
  conteneur est réglé ; le filet, lui, est à construire.

- **`descope/virtualwebauthn` est épinglée sur `go-webauthn v0.16.5`.** `done/step-024.md` : « un
  durcissement futur […] le symptôme serait une suite rouge sans cause lisible dans le produit ». Le
  repli est déjà chiffré par DN-12 : **un authentificateur à la main, ~150 lignes**.

- **La borne de démarrage du binaire est passée de 5 s à 30 s**, et c'est la jumelle exacte de la
  précédente : step-007, DN-9, écrit « **aucun test ne rougit si la valeur revient à 5 s**, vérifié
  plutôt que supposé ». Deux bornes élargies pour absorber la même lenteur, ni l'une ni l'autre gardée.

- **L'amortissement de testcontainers entre paquets n'est pas fait.** step-007 l'a laissé ouvert avec
  son déclencheur écrit — « le jour où un second paquet a besoin de PostgreSQL » —, et ce jour est
  passé depuis longtemps : `internal/store`, `cmd/dashboard`, `cmd/bootstrap` et `cmd/migrate` en
  montent chacun un. C'est probablement le remède au premier point plutôt qu'une dette à part.

## Points d'implémentation clés
- **Mesurer avant de choisir.** Le premier point admet plusieurs remèdes — ressources du conteneur,
  amortissement entre paquets, parallélisme des scénarios — et rien ne dit lequel mord. Le dépôt a
  déjà payé une décision prise sur un proxy plutôt que sur la cause ; ici la cause s'observe.
- **`WithReuse` a été écarté nommément en step-007**, et cette step n'a pas à défaire cet arbitrage
  sans mesure neuve. Ce que step-007 laissait ouvert est l'**amortissement entre paquets**, avec son
  déclencheur écrit : « le jour où un second paquet a besoin de PostgreSQL ». Ce jour est passé —
  `internal/store`, `cmd/dashboard`, `cmd/bootstrap` et `cmd/migrate` en montent chacun un.
- **Le délai godog rendu à 2 s est la preuve, pas l'objectif.** Le remettre sans avoir réglé le
  conteneur rend la suite instable, ce qui est pire que l'absence de filet : une suite qui rougit au
  hasard cesse d'être lue.
- **Le remède au troisième point n'est pas forcément de dépingler.** Écrire l'authentificateur à la
  main retire une dépendance de test d'un chemin de sécurité, au prix de ~150 lignes qu'il faut alors
  garder. Les deux se défendent ; ce qui ne se défend pas est de ne pas trancher.
- **Ce genre de défaut ne s'observe pas en local.** `plan.md` §2.1 : « trois des six défauts n'étaient
  observables que dans un run de CI. Pousser la branche tôt et laisser la CI arbitrer coûte une
  commande ; le découvrir en revue coûte une passe. »

## Tests (écrits dans la même PR)
- **La suite complète, lancée plusieurs fois d'affilée, ne rougit pas** — c'est le seul critère qui
  décrit le défaut réel. Un test qui passe une fois ne dit rien d'un conteneur qui meurt sous la
  charge.
- **Le délai godog rendu à sa valeur courte tient**, et sa valeur est écrite là où elle vit.
- Pour le troisième point : ce que la forme retenue permet, et le constat écrit si elle ne permet
  rien.

## Definition of Done
- [ ] `make check` vert, **et la suite Go lancée trois fois de suite sans rougir**
- [ ] la CI est verte sur trois exécutions consécutives, pas une seule — le défaut ne s'observe que là
- [ ] le délai godog est revenu à sa valeur courte, ou la raison de ne pas le faire est écrite
- [ ] le sort de `virtualwebauthn` est tranché, et la raison écrite dans la fiche
- [ ] `pnpm audit` et les alertes de dépendances sont relues : la dette de départ est qu'on n'osait
      plus bumper

## Hors périmètre
Les cinq parcours Playwright → step-185. L'image de production et les sondes → step-186. Le
durcissement du code de M1 → step-031.

# Les dettes du dépôt

**Une dette, un fichier.** Un défaut connu qu'on choisit de ne pas payer tout de suite s'écrit ici,
et nulle part ailleurs — pas dans un commentaire, pas dans une fiche archivée, pas dans un tableau.
Le dépôt écrit lui-même pourquoi : *« une fiche archivée n'est ouverte par personne »*.

`internal/bddtest/porteurs_test.go` tient ce dossier. Il est **fermé par défaut** : un fichier sans
porteur fait rougir la suite en le nommant.

## La forme

    # NNN — <ce qui ne va pas, en une phrase>

    > **Porteur :** step-187

    ## Ce qu'elle coûte si elle dure

    <la conséquence, puis la mesure qui l'étaye — avec sa date et, si elle existe,
    la commande qui la rejoue>

`NNN` est le prochain numéro libre. Il ne se réutilise pas : un numéro qui désigne deux dettes au
cours de la vie du dépôt rend illisible tout renvoi fait entre les deux.

## Le porteur

Une step — `step-187` — ou, quand personne ne la portera :

    > **Porteur :** **sans porteur** — <la raison, mesurée>

La raison est **obligatoire** et la forme est exacte : « à désigner » est un porteur qui n'existe
pas, et une mention vide ne se distingue pas d'un oubli. Une non-attribution est une décision, pas
une case qu'on laisse blanche — elle s'écrit avec ce qui la justifie, et le plus souvent avec un
déclencheur : *ce qui devra être vrai pour qu'on la rouvre*.

Le nombre de dettes sans porteur est **borné** (`maxUnattributed`), et la borne est pleine
aujourd'hui. C'est délibéré : la prochaine se discute au lieu de s'ajouter.

## Payer une dette

**Le fichier se supprime**, dans la PR qui paie la dette, et le commit dit ce qui l'a payée. Git
porte l'histoire ; un dossier où 40 % des fichiers seraient des archives ne se lit plus.

Une dette dont le porteur est **déjà coché** dans `tasks/todo.md` fait rougir la suite : ou bien elle
a survécu à la step censée la payer — et le registre affirmait encore que quelqu'un s'en occupait —,
ou bien elle a été payée et ce fichier aurait dû partir avec.

## Ce qui n'est pas une dette

- **Un arbitrage consigné** — « on a choisi A plutôt que B, voici la mesure ». Ça vit dans la fiche
  qui l'a tranché, ou dans un commentaire là où le code ne peut pas parler.
- **Un travail planifié** — ça vit dans `tasks/todo.md` et dans sa fiche.
- **Un constat « aucun test ne rougit si cette ligne disparaît »** — la Definition of Done demande de
  l'écrire **là où il vit**, c'est-à-dire dans le code. Il ne devient une dette que si quelqu'un doit
  agir.

## Les dettes payées

Elles ne sont pas ici. La section « Dettes payées » de `tasks/todo.md` garde celles d'avant ce
dossier ; les suivantes vivent dans l'historique git et dans le commit qui les a soldées.

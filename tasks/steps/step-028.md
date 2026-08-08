# step-028 — Écran d'enrôlement du second facteur

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-023, step-024, step-027 · **Bloque :** step-029

## But
Le premier administrateur doit pouvoir **entrer** : installer, se connecter, enrôler un second
facteur, arriver dans la console — sans impasse. Cet écran existe avant celui des opérateurs pour
cette seule raison ; la v1.0 avait rendu le second facteur obligatoire sans qu'aucun écran ne
permette de l'enrôler.

## Périmètre (ce que fait CETTE PR)
- Enrôlement TOTP : **QR code** dessiné depuis l'URI `otpauth://` que rend le serveur (step-023),
  secret copiable pour la saisie manuelle, vérification du premier code.
- Enregistrement d'une **passkey** quand le navigateur le supporte, TOTP toujours proposé.
- **Codes de récupération** montrés une seule fois, copiables et téléchargeables, avec le rappel écrit
  **avant** que l'opérateur quitte l'écran.
- Le chemin de sortie : l'écran conduit à la console, et il est atteignable depuis le login d'un
  opérateur sans facteur (step-027).

## Points d'implémentation clés
- **Le QR de la v1.0 était un carré noir de 176 pixels**, et le parcours qui l'assertait « visible »
  restait vert. La règle CSS avait été écrite sans lire ce que la bibliothèque émet. Ici : lire la
  sortie de la bibliothèque **avant** d'écrire le style (critère 2 de la DoD), et asserter autre chose
  que la présence — ce qui se vérifie est ce qui est rendu, pas ce qui est monté.
- **Un `toBeVisible()` sur un QR ne prouve rien.** La preuve porte sur la sortie : dimensions,
  contraste des modules, et le fait que ce qui est encodé soit l'URI attendue.
- **Le secret et les codes ne se réaffichent jamais.** L'écran le dit avant de laisser partir ; après,
  la seule sortie est un réenrôlement (step-029). Aucune action « révéler » n'existe.
- **Passkey d'abord quand l'appareil suit, TOTP toujours disponible** : un poste sans authentificateur
  de plateforme doit pouvoir entrer, et la détection de support ne doit jamais retirer la seule
  option restante.
- La bibliothèque de QR n'est pas encore installée : sa version se relève **à l'ajout** via `ctx7`,
  jamais devinée, et son poids se pèse contre le fait qu'elle ne sert qu'un écran.

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : les états de l'écran, le clavier, la copie, le rappel avant sortie.
- Le QR rendu porte bien l'URI du serveur, et ses dimensions ne sont pas celles du défaut de la
  bibliothèque — le test qui aurait attrapé le carré noir.
- Les codes de récupération n'apparaissent plus après un rechargement.
- **Parcours (Playwright)**, en étendant celui de step-027 : installation neuve → login → enrôlement →
  console, sans impasse.

## Definition of Done
- [ ] `make check` vert et `make e2e` vert
- [ ] le parcours du premier administrateur va jusqu'à la console **contre le binaire**
- [ ] la mutation « rendre le QR à sa taille par défaut » fait rougir — la mutation qui rejoue le
      défaut réel de la v1.0
- [ ] la mutation « réafficher les codes de récupération après rechargement » fait rougir
- [ ] la sortie de la bibliothèque de QR a été **lue** avant que le style soit écrit, et le constat
      figure dans la PR

## Hors périmètre
La vérification serveur des deux facteurs → step-023 et step-024. La réinitialisation du facteur d'un
autre opérateur → step-029. L'audit d'accessibilité complet → step-185.

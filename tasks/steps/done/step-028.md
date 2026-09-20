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
- **Les trois causes du 409 de `POST /auth/mfa/totp/enroll` se distinguent au `code`, pas au statut**
  (step-035). `mfa_already_enrolled` dit qu'aucune preuve n'accompagnait la demande, et
  `mfa_elevation_required` qu'il faut d'abord franchir la clé en place : ces deux-là valent pour
  l'écran entier, et le serveur les rédige lui-même — l'écran rend sa phrase, sans en écrire une
  seconde qui périmerait. **`mfa_replacement_refused` ne peut pas arriver ici**, et la mesure le
  dit : `internal/bff/mfa.go` ne l'atteint que sous `state.Enrolled && request.Body.Code != nil`, or
  cet écran poste `{}` et n'enrôle que le **premier** facteur — sa garde renvoie au second facteur
  dès qu'un facteur est en place. Le champ où poser cette erreur n'existe donc pas non plus : il
  naîtra avec le formulaire de remplacement, en step-029. Arbitré le 20/09/2026.

### Deux dettes héritées, et une contractée

*Écrite ici et non seulement dans `steps/done/step-024.md` : une fiche archivée n'est ouverte par
personne.*

- **Aucune passkey ne porte de nom** — et ce n'est **pas** cette step qui l'écrira. Arbitré le
  20/09/2026 : un nom ne sert qu'où on l'affiche et où on s'en sert pour retirer, or `DELETE
  /auth/mfa/webauthn/passkeys/{passkeyId}` n'a aucun consommateur ni aucune step, et le périmètre
  ci-dessus ne porte ni inventaire ni retrait. La dette 042 passe à step-029, qui tranchera dans le
  même mouvement que la dette 045. Poser la colonne ici livrerait une donnée sans consommateur.
- Le serveur accepte TOTP et passkey **à parité** (step-024) : laquelle proposer en premier est une
  décision d'écran, et **la spec la tranche** — §6.9, « WebAuthn/passkey privilégié quand l'appareil
  le supporte ». Dette 043 payée : elle était réputée « écrite nulle part », elle l'était.
- **Dette 052 contractée** : le **succès** d'une cérémonie WebAuthn n'est exercé nulle part, ni ici
  ni sur `/mfa`. jsdom n'expose pas `navigator.credentials`, et le parcours Playwright passe par
  TOTP. Les refus, eux, sont tenus des deux côtés. Portée par step-029, qui touche les passkeys pour
  elles-mêmes et paiera la mesure d'un coup — un authentificateur virtuel posé par CDP.

### Trois arbitrages tranchés pendant l'écriture

- **L'écran enrôle, il ne vérifie pas.** Ni `POST /auth/mfa/totp/enroll` ni
  `POST /auth/mfa/webauthn/register/finish` n'élèvent la session : seule `POST /auth/mfa/verify` le
  fait (`internal/bff/mfa.go`, `Sessions.Elevate`). `/mfa` sait déjà présenter les deux méthodes et
  rédiger leurs refus — l'indice de dérive d'horloge compris ; `/enroll` y conduit plutôt que d'en
  écrire une seconde copie. Le périmètre de la step est tenu : le premier code est bien saisi dans
  le parcours qu'elle livre.
- **`/enroll` exige le challenge, comme `/mfa`.** Sans lui la vérification qui suit serait refusée,
  et l'écran aurait montré dix codes irrécupérables avant un cul-de-sac.
- **Un pas sépare les codes de la sortie** — « J'ai enregistré ces codes ». La vérification les
  emporte sans retour ; sans ce pas, le bouton qui conduit à la suite est sous les codes dès qu'ils
  paraissent, et le réflexe l'atteint avant l'œil.

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
- **La bibliothèque de QR est déjà installée** — `qrcode.react` 4.2.0, présente et sans aucun usage
  dans `web/src`. La fiche la disait absente ; vérifié le 20/09/2026.

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : les états de l'écran, le clavier, la copie, le rappel avant sortie.
- Le QR rendu porte bien l'URI du serveur, et ses dimensions ne sont pas celles du défaut de la
  bibliothèque — le test qui aurait attrapé le carré noir.
- Les codes de récupération n'apparaissent plus après un rechargement.
- **Parcours (Playwright)**, en étendant celui de step-027 : installation neuve → login → enrôlement →
  console, sans impasse.

## Definition of Done
- [x] `make check` vert et `make e2e` vert
- [x] le parcours du premier administrateur va jusqu'à la console **contre le binaire** — il enrôle
      par l'écran, et lit la clé à l'écran : le décor d'API de step-027 a disparu
- [x] la mutation « rendre le QR à sa taille par défaut » fait rougir. Et la mutation qui rejoue le
      **défaut réel** de la v1.0 — une règle `.auth__qr path { fill: … }` qui prend les deux
      chemins — fait rougir le parcours Playwright, seul endroit où le CSS est appliqué
- [x] la mutation « réafficher les codes de récupération après rechargement » fait rougir
- [x] la sortie de la bibliothèque de QR a été **lue** avant que le style soit écrit, et le constat
      figure dans la PR

## Hors périmètre
La vérification serveur des deux facteurs → step-023 et step-024. La réinitialisation du facteur d'un
autre opérateur → step-029. L'audit d'accessibilité complet → step-185.

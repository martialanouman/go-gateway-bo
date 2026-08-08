# step-023 — MFA TOTP : enrôlement, vérification, codes de récupération

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-022 · **Bloque :** step-025, step-028

## But
Le second facteur qui marche partout, y compris sur un poste sans authentificateur de plateforme :
une application TOTP, des codes de récupération pour le jour où le téléphone est perdu, et un secret
qui ne se réaffiche jamais.

## Périmètre (ce que fait CETTE PR)
- `pquerna/otp` : génération du secret, URI `otpauth://`, vérification avec fenêtre de dérive
  **écrite et justifiée**.
- `POST /auth/mfa/enroll` (variante TOTP) et `POST /auth/mfa/verify` : le second facteur élève la
  session de step-022.
- Secret **chiffré au repos** (AES-GCM, `DASHBOARD_TOTP_ENCRYPTION_KEY`) dans
  `operators.mfa_totp_secret`.
- **Anti-rejeu** : le dernier pas consommé est mémorisé par opérateur, un code déjà servi est refusé.
- Dix **codes de récupération**, hachés comme un mot de passe (step-021), montrés une seule fois, à
  usage unique, avec le compte des codes restants.
- La migration qu'exigent l'anti-rejeu et les codes de récupération : le §3.1 ne les déclare pas, et
  step-005 a renvoyé ce qu'elle ne savait pas encore décrire « à la step qui le spécifiera ».

## Points d'implémentation clés
- **L'anti-rejeu n'est pas optionnel.** TOTP accepte une fenêtre de dérive, donc un code intercepté
  reste valable plusieurs dizaines de secondes : sans mémoire du dernier pas consommé, il se rejoue.
  C'est le mécanisme que la spec nomme (§6.9, « anti-rejeu ») et le seul de cette step qu'un test
  vert peut sembler couvrir sans le couvrir.
- **La fenêtre se décide, elle ne se subit pas** : ±1 pas est le compromis habituel entre horloges
  désynchronisées et durée d'exposition. La valeur par défaut de la bibliothèque se relève et
  s'écrit ; elle ne se suppose pas (`pkg.go.dev`, jamais de signature inventée).
- **Le serveur rend l'URI, pas une image.** Le QR est dessiné par step-028 — et c'est là qu'il a
  échoué en v1.0. Ce partage évite de faire dépendre le serveur d'une bibliothèque de rendu.
- **Un secret montré une fois** : à l'enrôlement, et jamais ensuite. Aucune action « révéler »
  n'existe (invariant b, dans son esprit — il porte sur les identifiants de bind, la règle vaut ici).
- **Perdre `DASHBOARD_TOTP_ENCRYPTION_KEY` rend illisibles tous les seconds facteurs**, codes de
  récupération compris. Le README l'annonce déjà ; cette step vérifie que c'est vrai du code livré, et
  écrit le chemin de sortie (réenrôlement par un `operators:manage`, step-029).
- **Un code de récupération consommé est détruit, pas marqué.** Il n'y a rien à réafficher, donc rien
  à fuir.
- L'enrôlement exige une session de premier facteur : anonyme, il permettrait d'attacher un
  authentificateur à un compte qu'on ne détient pas.

## Tests (écrits dans la même PR)
- **Scénario** `mfa-totp.feature` : enrôlement, premier code accepté, session élevée ; code faux
  refusé ; code de récupération accepté une fois, refusé la seconde.
- Le même code présenté deux fois est refusé la seconde — le test central de cette step.
- Un code du pas voisin est accepté, un code à deux pas est refusé.
- La colonne `mfa_totp_secret` lue en base **n'est pas** un secret utilisable : elle est chiffrée.
- Le secret n'est rendu par aucune réponse après l'enrôlement.

## Definition of Done
- [ ] `make check` vert
- [ ] la fenêtre de dérive et le format de chiffrement sont écrits avec leur raison
- [ ] la mutation « retirer l'anti-rejeu » fait rougir
- [ ] la mutation « élargir la fenêtre à ±10 pas » fait rougir
- [ ] la mutation « stocker le secret en clair » fait rougir la lecture de colonne
- [ ] la mutation « ne pas détruire un code de récupération consommé » fait rougir

## Hors périmètre
WebAuthn → step-024. L'exigence de second facteur sur les écritures → step-025. L'écran d'enrôlement,
le QR et le téléchargement des codes → step-028. La réinitialisation du second facteur d'un autre
opérateur → step-029.

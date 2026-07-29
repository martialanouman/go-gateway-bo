# step-024 — MFA WebAuthn / passkey

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-023 · **Bloque :** step-025

## But
Offrir le facteur recommandé quand l'appareil le supporte : une passkey, résistante au hameçonnage,
sans code à recopier.

## Périmètre (ce que fait CETTE PR)
- Cérémonies d'enregistrement et d'authentification (`@simplewebauthn/server` + `/browser`),
  stockées dans `mfa_webauthn_credentials` (§3.1).
- Gestion multi-authentificateurs : nommer, lister, révoquer une passkey ; interdiction de supprimer
  le dernier facteur si le rôle exige le MFA.
- Détection de capacité côté client : proposer la passkey en premier, TOTP en repli (§6.9).

## Points d'implémentation clés
- `rpID` et `origin` viennent de la configuration et sont **vérifiés côté serveur** : une valeur
  permissive annule la résistance au hameçonnage.
- Vérification du **compteur de signature** et rejet du rejeu ; challenge à usage unique et à durée
  de vie courte, stocké côté serveur.
- Vérifier version et API de `@simplewebauthn/*` via **`ctx7`** — l'API a changé entre majeures.
- Le e2e Playwright utilise l'authentificateur virtuel du navigateur, pas un vrai appareil.

## Tests (écrits dans la même PR)
- Enregistrement puis authentification par passkey (authentificateur virtuel).
- Challenge rejoué refusé ; `origin` non conforme refusé.
- Supprimer le dernier facteur d'un rôle privilégié est refusé avec un message explicite.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build) · `pnpm e2e` vert
- [ ] `rpID`/`origin` vérifiés côté serveur · challenge à usage unique

## Hors périmètre
L'obligation de MFA selon le rôle → step-025.

## Reste à faire — le bout en bout

L'implémentation serveur est livrée et revue ; **la Definition of Done n'est pas atteinte** : il manque
le parcours Playwright avec l'authentificateur virtuel du navigateur.

Ce n'est pas un oubli mais une dépendance d'infrastructure. Le serveur e2e
(`playwright.config.ts`) démarre aujourd'hui sans `DATABASE_URL` ni secret d'authentification : aucune
route d'auth ne peut y répondre. Le parcours exige donc, ensemble :

- une base PostgreSQL pour la durée du run e2e, migrée, avec un opérateur amorcé à mot de passe connu ;
- `AUTH_SESSION_SECRET`, `AUTH_THROTTLE_SECRET`, `AUTH_MFA_SECRET`, `AUTH_WEBAUTHN_RP_ID` et
  `AUTH_WEBAUTHN_ORIGIN` dans l'environnement du `webServer` ;
- une URL de base en `localhost` et non `127.0.0.1` — une adresse IP n'est pas un `rpID` valide, ce que
  `readWebAuthnConfig` refuse désormais explicitement ;
- un service PostgreSQL dans le job « Bout en bout » de la CI.

**La step-026 a besoin exactement de la même infrastructure** (sa DoD demande un parcours
login → MFA → console), et elle apportera en plus les écrans que ce parcours doit traverser. Le faire
ici signifierait la construire deux fois, ou l'écrire contre une interface qui n'existe pas.

Ce qui remplace ce parcours en attendant, et qui n'est pas rien : un **authentificateur logiciel aux
signatures réelles** (`src/test/webauthn-authenticator.ts`) — vraies clés ECDSA P-256, vrai CBOR/COSE,
vraie signature DER vérifiée par la bibliothèque. Les tests signent pour `hameconnage.test`, rejouent un
défi, font stagner le compteur, et constatent le refus. Ce qu'il ne couvre pas : que le *navigateur* soit
d'accord — ce qu'aucun code Node ne peut établir.

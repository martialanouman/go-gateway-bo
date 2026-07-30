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


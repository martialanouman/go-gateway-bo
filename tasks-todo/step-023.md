# step-023 — MFA TOTP : enrôlement et vérification

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-022 · **Bloque :** step-025

## But
Ajouter le premier facteur d'authentification forte, disponible sur tout appareil : une application
authenticator.

## Périmètre (ce que fait CETTE PR)
- `POST /auth/mfa/enroll` (variante TOTP) : génération du secret, QR code `otpauth://`, confirmation
  par un premier code valide avant activation.
- `POST /auth/mfa/verify` : vérification du code, fenêtre de dérive d'horloge bornée, **anti-rejeu**
  (un code consommé n'est plus acceptable).
- Codes de récupération à usage unique, affichés **une seule fois**, stockés hachés.
- `mfa_totp_secret` chiffré au repos ; jamais renvoyé par une API après l'enrôlement.

## Points d'implémentation clés
- La limitation de débit s'applique aussi à la vérification MFA : un code à 6 chiffres se force
  brutalement sans elle. Le plafond court de la session partielle (step-022) borne déjà la fenêtre à
  quelques minutes — il rend la force brute plus étroite, il ne la remplace pas.
- La vérification promeut la session par `completeMfa()`, qui déplace la fin de validité du plafond
  court au plafond absolu. C'est le seul endroit qui a le droit de le faire.
- L'anti-rejeu doit tenir en **multi-instance** (marqueur partagé du dernier pas de temps consommé).
- Les codes de récupération suivent la même règle que les secrets d'identifiants (**invariant b**) :
  montrés une fois, jamais réaffichés.
- Bibliothèque TOTP : vérifier version et API via **`ctx7`** avant intégration.

## Tests (écrits dans la même PR)
- Enrôlement complet, puis vérification d'un code valide ; code hors fenêtre refusé.
- Rejeu du même code refusé, y compris depuis une autre instance.
- Un code de récupération fonctionne une fois et une seule.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] secret chiffré au repos · anti-rejeu vérifié · codes de récupération jamais réaffichés

## Hors périmètre
WebAuthn → step-024. L'obligation de MFA par rôle → step-025.

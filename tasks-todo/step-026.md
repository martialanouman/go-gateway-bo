# step-026 — Rendu UI par permission + écrans Login & MFA

> **Jalon :** M1 (§6.9, §6.10, §4.2) · **Statut :** À FAIRE
> **Dépend de :** step-025, step-041, step-042 · **Bloque :** tous les écrans

## But
Rendre les permissions visibles et compréhensibles dans l'interface, et livrer la porte d'entrée du
produit conformément à la charte.

## Périmètre (ce que fait CETTE PR)
- Hook `usePermission(key)` alimenté par `/auth/me` ; composant `PermissionGate`.
- **Règle de la charte** : un contrôle interdit est **désactivé et expliqué**, jamais silencieusement
  masqué (« Nécessite la permission `suppressions:delete` »).
- Écran de login (email + mot de passe) puis écran de challenge MFA (passkey d'abord, TOTP en repli),
  d'après `LoginScreen.jsx` du kit UI.
- États d'erreur d'authentification explicites : identifiants invalides, compte verrouillé (avec
  durée), MFA requis, facteur indisponible.

## Points d'implémentation clés
- Le rendu conditionnel est un **confort**, jamais une garde (invariant c) : un contrôle masqué dont
  la route n'est pas gardée reste une faille.
- Copie à la troisième personne, conséquence d'abord, et jamais le mot « sécurisé » comme promesse
  (fondamentaux de contenu du design system).
- Aucune information d'énumération dans les messages : « identifiants invalides », pas « email inconnu ».
- Navigation clavier complète et annonce des erreurs aux lecteurs d'écran dès cet écran.

## Tests (écrits dans la même PR)
- Sans la permission, le contrôle est rendu désactivé avec sa raison ; avec, il est actif.
- Parcours e2e : login → MFA (TOTP et passkey) → console.
- Compte verrouillé : message avec durée, aucune fuite d'existence de compte.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build) · `pnpm e2e` vert
- [ ] aucun contrôle silencieusement masqué · clavier et libellés conformes (WCAG 2.1 AA)

## Hors périmètre
La gestion des opérateurs et des rôles → step-027.

# step-030 — Écrans Opérateurs et Rôles

> **Jalon :** M1 (§6.10, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-029, step-049 · **Bloque :** — (clôt M1)

## But
Le plan de coupe de step-029, exécuté : step-029 a livré les neuf routes d'administration et leurs
scénarios, celle-ci livre les deux écrans qui s'en servent. *Coupe décidée le 23/09/2026, avant la
première ligne de step-029, comme sa fiche le demandait.*

## Périmètre (ce que fait CETTE PR)
- L'écran **Opérateurs** : liste (`GET /operators`), création (`POST /operators`, la politique de
  douze caractères vient du Zod engendré), désactivation et réactivation (`PATCH`), rôles détenus
  (`POST /operators/{id}/roles`), réinitialisation du second facteur
  (`DELETE /operators/{id}/second-factors`) — désactivée et expliquée quand `secondFactorEnrolled`
  est faux.
- L'écran **Rôles** : les neuf par défaut en lecture (`isDefault`), les rôles personnalisés en
  édition, les permissions **groupées par catégorie** depuis `web/src/lib/permissions.gen.ts`. La
  suppression d'un rôle détenu est désactivée **avant** l'aller-retour, en nommant `holders`.
- Les refus structurels du serveur (`self_lockout`, `role_is_default`, `role_held`, `email_taken`,
  `role_name_taken`) rendus tels quels : ils nomment déjà ce qui manque et par où passer.

### Dettes héritées de step-029
- **040** — les descriptions des neuf rôles, que cet écran affiche.
- **042** — le nom des passkeys, et avec lui le sort de `DELETE /auth/mfa/webauthn/passkeys/{id}`.
- **052** — le succès d'une cérémonie WebAuthn, par un authentificateur virtuel CDP dans Playwright.
- **053** — le remplacement d'un facteur en place n'a pas d'écran.

## Points d'implémentation clés
- **`GET /roles` exige `roles:manage`**, et l'écran Opérateurs en a besoin pour attribuer : un
  détenteur de `operators:manage` seul ne verra pas la liste. Seul `super_admin` porte l'une ou
  l'autre aujourd'hui ; si un rôle personnalisé les sépare, trancher ici — contrôle désactivé et
  expliqué, ou `GET /roles` ouvert à `operators:manage`.
- **Un compte créé et jamais entré n'a pas de second facteur** : `secondFactorEnrolled` le montre ; la
  fenêtre se ferme au premier passage du titulaire (arbitrage de la dette 004, écrit sur
  `BeginWebauthnRegistration`).
- **Les passkeys** : inventaire et nom (dette 042), ou sort écrit de
  `DELETE /auth/mfa/webauthn/passkeys/{id}`.

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : l'éditeur de rôle groupe les 44 clés par catégorie, le clavier suit, les
  contrôles interdits sont désactivés et expliqués.
- **Parcours (Playwright)**, en étendant celui de step-028 : le premier administrateur crée un second
  opérateur, lui attribue un rôle, et cet opérateur entre.

## Definition of Done
- [ ] `make check` vert et `make e2e` vert
- [ ] **M1 est clos** : les **treize** fiches sont dans `tasks/steps/done/`, et le checkpoint du
      `plan.md` §6 est vérifié plutôt que déclaré.

## Hors périmètre
L'écran de consultation du journal d'audit → step-184. Toute route serveur : elles sont livrées.

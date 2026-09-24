# step-039 — Les facteurs de son propre compte

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-028, step-030, step-050 · **Bloque :** — (clôt M1)

## But
Ce qu'un opérateur fait de ses propres seconds facteurs une fois entré : les voir, en ajouter, en
retirer, remplacer celui qu'il a perdu. step-028 n'a livré que le premier enrôlement, et les routes
existent toutes (`/auth/mfa/*`). *Détachée de step-030 le 23/09/2026 : ses trois dettes portent sur
le compte de la session, pas sur l'administration des autres.*

## Périmètre (ce que fait CETTE PR)
- L'inventaire des facteurs du compte : application d'authentification, codes restants, passkeys.
- Le remplacement de l'application d'authentification, en présentant un code de l'actuelle ou un
  code de récupération (`TotpEnrollmentRequest`).
- L'ajout et le retrait d'une passkey, le dernier facteur restant désactivé et expliqué.

### Dettes héritées
- **042** — le nom des passkeys, et avec lui l'emploi de `DELETE /auth/mfa/webauthn/passkeys/{id}`.
- **052** — le succès d'une cérémonie WebAuthn, par un authentificateur virtuel CDP dans Playwright.
- **053** — le remplacement d'un facteur en place n'a pas d'écran.
- **055** — une panne serveur compte comme un échec de second facteur.

## Tests (écrits dans la même PR)
- **Parcours (Playwright)** : un authentificateur virtuel posé par CDP enregistre une passkey et
  franchit le second facteur avec elle, en étendant le parcours existant.
- **Composants (Vitest)** : le retrait du dernier facteur est désactivé et expliqué.

## Definition of Done
- [ ] `make check` vert et `make e2e` vert
- [ ] **M1 est clos** : toutes ses fiches sont dans `tasks/steps/done/`, et le checkpoint du
      `plan.md` §6 est vérifié plutôt que déclaré.

## Hors périmètre
La réinitialisation par un administrateur : le lien de reset de step-050.

# step-050 — Lien d'accès à usage unique : activation et réinitialisation par e-mail

> **Jalon :** M1 (§6.9, §6.10, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-030 · **Bloque :** step-039

## But
Plus personne ne connaît le mot de passe d'un autre. Aujourd'hui l'administrateur qui crée un compte
en choisit le mot de passe, et avec `DELETE /operators/{id}/second-factors` il peut, à tout moment,
effacer le second facteur, se connecter avec ce mot de passe et s'enrôler à la place de l'opérateur.
Le compte naît désormais **sans mot de passe** ; l'opérateur le définit lui-même par un lien à usage
unique reçu par e-mail, puis enrôle son second facteur par le parcours existant. *Arbitré le
24/09/2026 avec l'utilisateur.*

## Décisions (arbitrées, ne pas rouvrir)
- **Deux types de lien**, choisis par le serveur : `activation` (compte sans mot de passe, **72 h**) et
  `reset` (compte actif, **1 h**). Un lien sert une fois ; un nouveau lien invalide le précédent.
- **Le reset remet à zéro le mot de passe *et* le second facteur**, mais **rien ne change avant
  l'usage** : l'ancien mot de passe, les facteurs et les sessions restent valables jusque-là. À
  l'usage : nouveau mot de passe, TOTP + codes de récupération + passkeys supprimés, sessions
  révoquées.
- **`DELETE /operators/{id}/second-factors` est supprimée**, avec l'action d'audit `mfa.reset` : le
  lien de reset la remplace. Les deux refus qui la nomment (`internal/bff/mfa.go`, « un administrateur
  détenant operators:manage peut réinitialiser… ») sont réécrits vers « peut vous envoyer un lien de
  réinitialisation », et le contrat (`/auth/mfa/*`, lignes qui citent la route) avec eux. La sortie du
  compteur WebAuthn cassé (step-029, dette héritée) passe par le lien.
- **Le bootstrap garde son mot de passe CLI** : celui qui le lance est le seul à le connaître.
- **Envoi asynchrone.** Aucun jeton en clair au repos : la file porte la *demande*, le worker tire le
  jeton au moment d'envoyer.
- **Politique de mot de passe** (tout mot de passe *défini*, bootstrap compris) : ≥ 12 caractères, au
  moins une majuscule, une minuscule, un chiffre et un caractère spécial (ni lettre ni chiffre, au
  sens Unicode). Le refus nomme ce qui manque. *Choix de l'utilisateur contre la recommandation NIST
  SP 800-63B, signalée le 24/09/2026.*

## Périmètre (ce que fait CETTE PR)

### Données et envoi
- Migration : `operators.password_hash` nullable ; table `access_links` — `operator_id` (PK), `kind`,
  `token_hash` (nul tant que rien n'est parti), `expires_at`, `sent_at`, `attempts`,
  `next_attempt_at`. Demander un lien = `INSERT … ON CONFLICT (operator_id) DO UPDATE` qui remet
  `token_hash` à nul.
- Worker, une goroutine par instance, toutes les 5 s : `FOR UPDATE SKIP LOCKED` → 32 octets aléatoires
  → SHA-256 stocké avec l'expiration → envoi SMTP → commit. Échec SMTP : rollback, puis
  `attempts+1` et `next_attempt_at` en backoff doublé plafonné à 10 min ; arrêt après 10 échecs,
  journalisé. La fonction d'envoi est **injectée** (une `func`, pas une interface).
- SMTP par `net/smtp` (stdlib) : `DASHBOARD_SMTP_ADDR`, `DASHBOARD_SMTP_FROM`. Base des liens :
  `DASHBOARD_PUBLIC_URL`, **jamais** l'en-tête `Host`. Mailpit dans `docker-compose.yml` (SMTP 1025,
  UI 8025) et comme service du job e2e. Les trois variables se posent aussi dans la CI et dans
  `playwright.config.ts` — `make check` ne lance jamais le binaire.
- Le mail : texte brut, français — produit, raison, lien, durée, « Si vous n'attendiez pas ce
  message, ignorez-le : rien ne change tant que le lien n'est pas utilisé. »

### Contrat et routes
- `POST /operators` perd `password` ; crée le compte sans mot de passe et met une demande
  `activation` en file, dans la transaction de l'audit `operator.create`.
- `Operator.accessLink: { kind: activation|reset, state: queued|sent|failed } | null`.
- `POST /operators/{id}/access-link` — garde `operators:manage`, audit `operator.access_link`, 202 ;
  409 expliqué sur un compte désactivé.
- `POST /auth/access-link` — publique, `{ token, password }` → 204. Une transaction : hash argon2id,
  effacement des facteurs et révocation des sessions si `reset`, ligne `access_links` supprimée, audit
  `operator.password_set` (acteur : l'opérateur). Tout jeton invalide, expiré, consommé ou remplacé :
  **un seul** refus, « Ce lien n'est plus valable : demandez-en un nouveau à un administrateur. »
- Login d'un compte sans mot de passe : même refus qu'un mot de passe faux.
- `auth.PasswordLongEnough` → `auth.CheckPassword`, appliquée par `/auth/access-link` et `cmd/bootstrap`.
- Spec amendée : §6.9 (activation, reset, politique), §5.1 (routes).

### Écrans
- **Opérateurs** : création sans mot de passe (« Compte créé. Le lien d'activation part à <adresse> ;
  il vaut 72 heures. ») ; statut « Activation en attente » / « Lien envoyé » / « Envoi en échec » ;
  l'action **« Envoyer un lien »** remplace « Réinitialiser le second facteur », sa confirmation dit
  ce qui change et quand ; désactivée et expliquée sur un compte désactivé.
- **`/access`** (public, hors coquille) : jeton lu dans le **fragment** (jamais transmis au serveur,
  donc absent des journaux d'accès), effacé par `history.replaceState` ; nouveau mot de passe +
  confirmation, règle en indice, `refine` Zod à la main à côté du formulaire ; succès → `/login`
  « Mot de passe enregistré. Connectez-vous pour configurer votre second facteur. » ; sans jeton, le
  refus sans formulaire.

## Tests (écrits dans la même PR)
- **godog** : création → lien en file ; access-link 403 audité et 409 ; jeton valide → mot de passe ;
  reset → facteurs effacés et sessions fermées ; jeton expiré / consommé / remplacé → même refus ;
  mot de passe faible → refus qui nomme le manque ; compte sans mot de passe → refus du mot de passe
  faux.
- **Go** : `CheckPassword` ; worker — SMTP en échec laisse `token_hash` nul et repousse, backoff,
  arrêt à 10 ; deux workers, une ligne, **un** envoi, observé dans `pg_locks`.
- **Vitest** : fragment effacé ; `refine` ; « Envoyer un lien » désactivé sur un compte désactivé.
- **Playwright**, en étendant `coquille.spec.ts` : création → lien lu par l'API Mailpit → `/access` →
  login → enrôlement → console.
- **Mutations** : garde, usage unique, expiration, invalidation par un nouveau lien, effacement des
  facteurs, révocation des sessions, `SKIP LOCKED`, effacement du fragment, `DASHBOARD_PUBLIC_URL`
  contre `Host`.

## Definition of Done
- [x] `make check` vert et `make e2e` vert — les deux en `rc=0` le 25/09/2026
- [x] Aucun jeton en clair en base, dans un journal, une URL transmise ou un audit — vérifié sur le
      livré.

## Hors périmètre
- « Mot de passe oublié » en libre-service depuis `/login` : seul un `operators:manage` déclenche un
  lien.
- Route `GET` de pré-validation du jeton ; mail HTML ; indicateur de robustesse ; TLS/AUTH SMTP ;
  file d'envoi générique (M9, notifications).

# step-021 — Login email/mot de passe + anti-brute-force

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-020 · **Bloque :** step-022

## But
Authentifier un opérateur par email et mot de passe, côté serveur exclusivement, avec un coût
d'attaque par force brute qui monte vite.

## Périmètre (ce que fait CETTE PR)
- Fonction serveur `POST /auth/login` : vérification du mot de passe, retour d'un **challenge MFA**
  (jamais une session directe — la session n'existe qu'après MFA, step-023/024).
- ~~Hachage **Argon2id**~~ — **déjà livré en step-020**, qui devait hacher pour créer le premier
  `super_admin` : `src/server/auth/password.ts`, scrypt de `node:crypto`, `N=2^17 r=8 p=1`,
  comparaison en temps constant. Cette step **réutilise** `hashPassword` / `verifyPassword` et
  n'introduit pas un second schéma. Voir « Décision reportée » ci-dessous.
- Anti-brute-force : compteur par identifiant **et** par IP, ralentissement progressif puis
  verrouillage temporaire ; l'énumération de comptes est impossible (message et temps de réponse
  identiques pour email inconnu et mot de passe faux).
- **Bornage de la concurrence des vérifications** — contrainte héritée de step-020, à traiter ici :
  chaque vérification *en vol* demande **128 Mio et ~166 ms**. Limiter le nombre d'essais par compte
  ne suffit pas ; cinquante logins concurrents sur des comptes différents suffisent à faire tomber
  une instance par épuisement mémoire, ce qui est un déni de service gratuit à monter.
- Définition et validation de la politique de mot de passe (longueur mini, rejet des mots de passe
  compromis courants). La step-020 n'a posé qu'un plancher de 12 caractères, et **seulement pour le
  compte d'amorçage** (`MIN_PASSWORD_LENGTH` dans `src/server/auth/bootstrap.ts`).

## Décision reportée : scrypt plutôt qu'Argon2id
Argon2id reste le premier choix de l'OWASP et a été écarté sciemment : toutes ses implémentations
Node passent par un module natif, ce qui heurte la politique d'approvisionnement du dépôt
(quarantaine de 24 h, `allowBuilds` explicite et justifié, chaque avis `pnpm audit` trié à la main).
scrypt est le second choix de la même recommandation et vit dans la bibliothèque standard.

Le choix reste réversible : l'empreinte est au format PHC (`$scrypt$n=…,r=…,p=…$sel$empreinte`) et la
vérification lit les paramètres **de l'empreinte**, jamais ceux de la configuration courante. Un
passage ultérieur à argon2id cohabiterait avec les empreintes existantes sans en invalider une seule.

## Points d'implémentation clés
- **Toute la logique sensible vit côté serveur** (§6.9) : le client ne voit qu'un formulaire.
- Le verrouillage doit résister au **multi-instance** : compteur partagé (Redis, step-044) ou
  transaction Postgres — jamais un compteur en mémoire de process.
- Ne jamais journaliser un mot de passe, un hash, ni l'email en clair dans un log d'échec répétable.
- Réponse d'échec **stable dans le temps** : ajouter un délai plancher pour ne pas trahir l'existence
  d'un compte par la latence.

## Tests (écrits dans la même PR)
- Mot de passe correct → challenge MFA ; incorrect → échec sans session.
- Email inconnu et mot de passe faux produisent la même réponse et la même latence approximative.
- Après N échecs, le compte est verrouillé pour la durée prévue, y compris depuis une autre instance.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] aucun secret journalisé · verrouillage effectif en multi-instance

## Hors périmètre
La session émise → step-022. Les facteurs MFA → step-023 et step-024.

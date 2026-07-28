# step-022 — Session BFF (cookie signé) + `/auth/me` + gardes de route

> **Jalon :** M1 (§6.9, §4.1) · **Statut :** À FAIRE
> **Dépend de :** step-021 · **Bloque :** step-025, step-026

## But
Émettre et vérifier la session propre du tableau de bord, et exposer l'unique source de vérité du
front sur qui est connecté et ce qu'il a le droit de faire.

## Périmètre (ce que fait CETTE PR)
- Session émise par le BFF (cookie signé `HttpOnly`, `Secure`, `SameSite=Lax`, chemin restreint),
  avec durée, glissement et **révocation** côté serveur.
- `GET /auth/me` → opérateur + **ensemble de permissions résolu** (union des rôles) + état MFA.
- `POST /auth/logout` : révocation immédiate, y compris pour les autres instances.
- Garde de route côté serveur : toute route non publique exige une session valide et complète
  (MFA passée), sinon redirection vers le login.

## Points d'implémentation clés
- **Invariant (c)** : `/auth/me` sert au *rendu*, jamais à l'autorisation. Chaque fonction serveur
  revérifie ses permissions (step-025).
- Le secret de signature vient de la configuration ; rotation possible sans invalider toutes les
  sessions d'un coup (accepter l'ancienne clé pendant une fenêtre).
- Session **partagée entre instances** (magasin Postgres ou Redis) : un déploiement sans coupure ne
  doit déconnecter personne (§4.1).
- Le cookie ne contient aucune permission : elles sont résolues à chaque requête, pour qu'un
  changement de rôle prenne effet sans reconnexion.

## Tests (écrits dans la même PR)
- Session valide → `/auth/me` renvoie l'union attendue ; session absente/expirée → 401.
- `logout` révoque immédiatement, vérifié depuis une seconde instance.
- Une route protégée redirige un anonyme et un opérateur dont le MFA n'est pas passé.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] cookie `HttpOnly`/`Secure`/`SameSite` · aucune permission portée par le jeton

## Hors périmètre
Le moteur de permissions → step-025. Les écrans de login → step-026.

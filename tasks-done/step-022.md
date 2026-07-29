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
- La brique de garde côté serveur : `resolveSession()` rend, depuis un en-tête `Cookie`, un état
  vérifié — `active`, `pending_mfa` ou `none`. **Son branchement sur les routes appartient à
  step-026** : aucune route non publique n'existe encore (l'AppShell prend la racine en step-040) et
  la cible de la redirection — l'écran de login — n'est livrée qu'en step-026. La brancher ici
  demanderait une route factice, écrite pour porter un test et réécrite deux steps plus loin.

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
- Un cookie signé mais révoqué, échu, inactif, ou dont l'opérateur est désactivé résout `none`.
- Une session partielle expire en quelques minutes et ne glisse pas : c'est elle que step-023 fera
  valider par un code à six chiffres, et le plafond d'une session complète y ouvrirait une fenêtre
  de douze heures.

## Definition of Done
- [ ] `pnpm check` vert (typecheck · lint · test · vuln · build)
- [ ] cookie `HttpOnly`/`Secure`/`SameSite` · aucune permission portée par le jeton

## Hors périmètre
Le moteur de permissions → step-025. Les écrans de login et le **branchement de la garde sur les
routes**, redirection comprise → step-026.

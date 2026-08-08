# step-021 — Login email/mot de passe (`argon2id`) + anti-brute-force partagé

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-020 · **Bloque :** step-022, step-023, step-024, step-027

## But
Vérifier qu'un opérateur est bien qui il prétend être, sans jamais dire lequel des deux facteurs a
échoué, et sans qu'une machine puisse essayer indéfiniment. Rien n'est encore protégé : cette step
livre le premier facteur et la porte qui le limite, pas la session.

## Périmètre (ce que fait CETTE PR)
- `internal/auth` : hachage **argon2id** (`golang.org/x/crypto/argon2`), paramètres mesurés sur la
  machine cible et écrits, encodage **PHC** (`$argon2id$v=19$m=…,t=…,p=…$sel$hash`), vérification en
  temps constant.
- `POST /auth/login` au contrat du BFF : adresse + mot de passe → verdict et **challenge de second
  facteur** à usage unique, de courte durée, en base.
- **Anti-brute-force partagé entre instances** : compteur d'échecs et verrouillage temporaire en
  PostgreSQL, par compte **et** par adresse source. Migration `00004`.
- `make bootstrap`, **seconde moitié** : crée le premier opérateur, lit ses valeurs dans
  l'environnement, refuse de s'exécuter dès qu'un opérateur existe.
- Les variables nouvelles dans `internal/config` et `.env.example`, sans valeur par défaut.

## Points d'implémentation clés
- **PostgreSQL et non Redis, et ce n'est pas un pis-aller.** Redis n'entre qu'en step-044, et le plan
  écrit que son Pub/Sub est « au mieux une fois » ; un compteur d'échecs qui repart de zéro au
  redémarrage annule la protection qu'il prétend porter. La base est déjà partagée par les ≥2
  instances (§4.1), donc « partagé entre instances » est acquis sans brique nouvelle.
- **Aucun oracle d'énumération** : même code, même corps, et **même durée** pour « adresse inconnue »
  et « mot de passe faux ». Sans hachage factice sur l'adresse inconnue, l'écart de durée fait
  l'oracle à lui seul — argon2id coûte des dizaines de millisecondes, l'absence de calcul en coûte
  zéro.
- **Le verrouillage se dit**, avec sa durée restante. Un refus muet fait retenter l'opérateur, puis
  ouvrir un ticket ; et la charte interdit un contrôle qui refuse sans expliquer.
- **Le challenge est un objet en base, pas un jeton signé.** La session signée appartient à step-022 ;
  un challenge doit être révocable à la seconde où il est consommé (anti-rejeu), ce qu'un jeton sans
  état ne permet pas. Ce sont deux objets de nature différente, pas deux mécanismes redondants.
- **Les paramètres argon2id se relèvent, ils ne se devinent pas** : mémoire, itérations, parallélisme
  sont mesurés ici, et l'encodage PHC est ce qui permettra de les relever plus tard sans invalider les
  hachages existants.
- **Le README décrit déjà cette step** — le sel d'anti-brute-force, le refus de rejouer `bootstrap`,
  la lecture par l'environnement plutôt que par `argv` que `ps` afficherait (step-005, DN-12). Ce
  texte se confronte au livré et se corrige s'il ment (critère 2 de la DoD).

## Tests (écrits dans la même PR)
- **Scénario** `login.feature` : identifiants justes → challenge émis ; mot de passe faux → refus ; N
  échecs → verrouillage annoncé ; verrou expiré → un nouvel essai est possible.
- Unitaire : un hachage produit avec d'anciens paramètres reste vérifiable après relèvement.
- Unitaire : « adresse inconnue » et « mot de passe faux » rendent le même corps et le même code. La
  durée est **mesurée à la main** et le constat écrit sur place — un test de temps est instable en CI.
- Le compteur est bien partagé : deux pools distincts sur la même base additionnent leurs échecs.
- `make bootstrap` sur une base qui porte déjà un opérateur **refuse**, et ne modifie rien.

## Definition of Done
- [ ] `make check` vert
- [ ] les paramètres argon2id sont écrits avec la mesure qui les fonde, pas recopiés d'un billet
- [ ] `.env.example` liste exactement les variables lues, et le binaire refuse de démarrer sans elles
- [ ] la mutation « retirer le verrouillage » fait rougir le scénario
- [ ] la mutation « retirer le hachage factice sur adresse inconnue » : ce qui tombe, ou le constat
      qu'aucune porte ne rougit, écrit au-dessus de la ligne
- [ ] la mutation « laisser `bootstrap` s'exécuter deux fois » fait rougir

## Hors périmètre
Le cookie de session, `/auth/me` et `/auth/logout` → step-022. La vérification du second facteur →
step-023 et step-024. Les gardes de permission → step-025. L'écran → step-027.

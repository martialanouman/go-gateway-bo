# step-034 — Verrous d'essais sous concurrence, coût d'argon2id borné

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-021, step-023, step-031 · **Bloque :** — (aucune step ne l'attend)
>
> *Issue de l'audit du 16/09/2026.*

## But
Le plafond de cinq échecs par quinze minutes tient **aussi** quand les essais arrivent ensemble, et une
rafale de connexions ne peut plus épuiser la mémoire d'une instance. Aujourd'hui, ces deux garanties
ne tiennent que pour des requêtes qui arrivent l'une après l'autre.

## Constats de l'audit
| Où | Ce qui se passe |
|---|---|
| `internal/auth/authenticator.go:98` → `:112` | `LockFor` lit le compteur, argon2id tourne, et l'échec n'est compté qu'ensuite par `RecordFailure` (`internal/store/logins.go:104`, `:144`). N requêtes simultanées lisent toutes « pas de verrou » et vérifient toutes leur mot de passe : N essais au lieu de cinq. |
| `internal/bff/mfa.go:230` → `:254`, et `:121` → `:137` | Même forme pour le second facteur. Le challenge reste vivant cinq minutes et n'est pas consommé sur un échec : avec le mot de passe, une rafale toutes les quinze minutes essaie autant de codes TOTP qu'elle envoie de requêtes. |
| Migration 00004 | Son commentaire (« une source ne peut pas créer plus de lignes que son seuil par durée de verrou ») est faux sous concurrence. |
| `internal/auth/argon2.go:88` | Chaque vérification alloue 64 MiB, y compris pour une adresse inconnue (`VerifyDummy`). Aucune borne de concurrence n'existe : environ 200 connexions simultanées sans identifiants suffisent à faire tuer l'instance pour manque de mémoire. |
| `internal/mfa/manager.go:140` | `MatchRecoveryCode` fait dix vérifications argon2id par essai : un amplificateur du précédent, pour qui détient un mot de passe. |

## Périmètre (ce que fait CETTE PR)
- **L'essai est réservé avant d'être vérifié**, pour les deux facteurs : incrément atomique d'abord,
  refus si le seuil est dépassé, puis vérification, et remise à zéro sur succès.
- **Une borne de concurrence sur argon2id**, commune à `Verify`, `VerifyDummy` et aux codes de
  récupération.
- Le commentaire de la migration 00004 est corrigé par une nouvelle migration si le schéma bouge,
  sinon là où la règle est désormais tenue.

## Points d'implémentation clés
- **La réservation doit valoir aussi pour une adresse inconnue.** Les compteurs sont déjà clés sur
  l'adresse soumise ; ne pas réintroduire l'oracle que `VerifyDummy` ferme en réservant seulement pour
  un opérateur trouvé.
- **Remise à zéro sur succès, pas décrément** : un succès efface déjà le compteur d'adresse
  aujourd'hui, et la sémantique ne doit pas changer.
- **La borne est un canal Go de dix places.** Aucune dépendance nouvelle. Dix places, parce que
  `argon2.go` chiffre déjà le plafond de mémoire à 640 MiB pour dix vérifications simultanées.
  Une requête sans place attend dans la limite de son échéance, puis reçoit un **503 rédigé**,
  conséquence d'abord. Pas un 429 : l'opérateur n'a rien fait de trop.
- **Les codes de récupération** : garder une seule place pour les dix vérifications, pas dix places.
- **La fenêtre d'oubli écrite deux fois** (registre, sans porteur) : si la réécriture de `logins.go`
  la touche, la replier au passage et barrer la ligne. Sinon, ne pas l'ouvrir.

## Tests (écrits dans la même PR)
- **Scénario rouge d'abord** : trente connexions simultanées avec un mot de passe faux sur le même
  compte → exactement cinq refus « identifiants », vingt-cinq refus « verrouillé ». Même scénario sur
  la vérification TOTP. Le résultat s'observe dans les réponses, pas dans le temps.
- **Mutation** : remettre la vérification avant la réservation → rouge, pour chacun des deux facteurs.
- **Borne** : onze vérifications lancées ensemble, la onzième attend. **Mutation** : retirer la borne →
  rouge. La preuve ne doit pas dépendre d'un chronométrage.
- **Mutation** : un code de récupération prend une place par hachage → rouge.

## Hors périmètre
La calibration d'argon2id sur la machine de production → step-186. La purge de
`login_attempt_counters` → step-187.

## Definition of Done
Elle vit dans `CLAUDE.md`.

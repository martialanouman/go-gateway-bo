# step-025 — `RequirePermission`, journal d'audit, second facteur obligatoire *(invariant c)*

> **Jalon :** M1 (§6.10, §3.1) · **Statut :** EN COURS — PR 1/2 livrée, voir « Découpage »
> **Dépend de :** step-020, step-022, step-023, step-024 · **Bloque :** step-029, et toute écriture du produit

## But
L'autorisation est appliquée **côté serveur**, une fois pour toutes et de façon vérifiable : chaque
opération de mutation exige une clé du catalogue, une session dont le second facteur est vérifié, et
laisse une ligne d'audit. Le rendu conditionnel de l'interface reste un confort — c'est ici que se
gagne l'invariant (c).

## Périmètre (ce que fait CETTE PR)
- `RequirePermission(permissions.Key)` posé en **middleware strict** : le gabarit d'oapi-codegen donne
  `StrictMiddlewareFunc(f, operationID)` (`internal/bff/bff.gen.go:228`), donc une garde **par
  opération du contrat**, pas par préfixe de chemin.
- La table `operationID → permission requise` (+ « exige une session élevée »), et les exemptions
  **nommées avec leur raison**.
- L'écriture d'`audit_log` sur chaque mutation : opérateur, action, cible, avant/après, adresse.
- Le **second facteur obligatoire** : aucune session non élevée n'atteint une écriture ni
  `content:read`.
- Le **test d'énumération des routes**, bloquant et non désactivable.
- L'appel récurrent à `ensure_audit_log_partitions()`, ou l'écrit de qui le portera — voir plus bas.

### Cinq dettes que cette step hérite, et que ses prédécesseures ont laissées ouvertes

*Elles sont écrites **ici** et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est
ouverte par personne : le renvoi doit aller vers la step qui paie, pas vers celle qui a créé.*

- **Trois routes d'authentification ne sont bornées par aucun compteur** :
  `POST /auth/mfa/totp/enroll` (step-023), `POST /auth/mfa/webauthn/register/begin` et
  `POST /auth/mfa/webauthn/assert/begin` (step-024). Une session de premier facteur suffit à les
  répéter — le verrou d'essais ne garde que la vérification. L'enrôlement TOTP y hache dix argon2id
  par appel ; les cérémonies WebAuthn, elles, ne coûtent qu'une ligne dans `webauthn_challenges`, que
  rien ne purge avant step-187. Cette step reprend ces chemins pour les garder : c'est le moment.
- **`POST /auth/mfa/webauthn/register/finish` doit être audité même s'il reste exempté de garde.**
  Il pose un second facteur, et c'est précisément l'événement qu'une enquête sur compte compromis va
  chercher — « un facteur a été ajouté le … ». La liste d'exemptions ci-dessous parle de permission,
  pas d'audit : les deux ne se confondent pas.
- **`DELETE /auth/mfa/webauthn/passkeys/{passkeyId}` doit sortir des exemptions d'audit** — et pas
  des exemptions de permission. La rédaction précédente disait « c'est la seule opération de
  `/auth/mfa/*` qui exige une permission » ; **c'est faux, et DN-4 le corrige** ici, au contrat et au
  §5.1. Elle porte déjà sa garde d'élévation (step-024, DN-9), elle gagne son audit, et elle n'exige
  aucune clé du catalogue.

## Découpage : deux PRs, et la ligne de fracture n'est pas la taille

La step part en **deux PRs**, contre la règle « une step = une PR » du manuel. La raison n'est pas le
volume mais le fait que les deux moitiés ne se relisent pas avec les mêmes questions, et qu'une seule
des deux est urgente.

**PR 1/2 — le journal d'audit, ses partitions et les bornes héritées.** Tout y a un client réel
aujourd'hui et s'exerce de bout en bout : la panne de partitions était datée au 1er octobre 2026, les
six écritures d'audit sont déclenchées par de vraies routes, et les trois bornes ferment des chemins
gratuits. Elle se juge sur « la trace est-elle complète et propre ? ».

**PR 2/2 — `RequirePermission`, l'exigence d'élévation, et la porte d'énumération.** Aucune de ces
trois choses n'a de client dans M1 : les neuf mutations existantes sont exemptées de permission, et
la dixième opération n'est pas une mutation. Elle se juge sur « la porte forcera-t-elle step-029 et
M3 à déclarer leur garde ? ».

La fiche ne part dans `done/` qu'avec la seconde, et la ligne de `todo.md` reste décochée d'ici là.

## Décisions — PR 1/2

### DN-1 — Les partitions se renouvellent au démarrage **et** toutes les 24 heures
`audit_log` est partitionné par mois et n'en portait que deux, août et septembre 2026 : **toute
écriture aurait été refusée le 1er octobre**, et comme l'audit partage la transaction de l'action
qu'il trace, c'est l'action métier qui serait tombée. `ensure_audit_log_partitions()` est idempotente
(`CREATE TABLE IF NOT EXISTS`), donc deux instances concurrentes ne se gênent pas.

L'appel au démarrage précède `net.Listen` et son échec refuse de servir : une instance qui lierait
son port puis refuserait chaque écriture est déjà dans le pool du load balancer. Le ticker couvre ce
que l'appel de démarrage ne couvre pas — un process qui tourne plus d'un mois, c'est-à-dire le
produit stable qu'on ne redéploie plus. Élargir `ARRAY[0, 1]` à douze mois est refusé nommément par
la migration 00002 : cela déplacerait la date de la panne au lieu de créer ce qui manque.

### DN-2 — `store.Fields` : le type interdit d'y verser un objet de domaine
`before_json` / `after_json` se composent par `Text`, `Number` et `Flag`, jamais par le marshal d'un
type de domaine. Ce n'est pas une liste blanche qu'on relit : c'est l'**absence de méthode** pour y
mettre autre chose. Marshaler un type de domaine y ferait entrer ce qu'il porte aujourd'hui — un mot
de passe haché, un secret de second facteur, un corps de message — et tout ce qu'on lui ajoutera
demain, sans qu'aucune relecture ne le voie. C'est la règle du DTO de sortie (§1.11) appliquée à une
écriture.

`ip_address` va en clair, délibérément : le HMAC des adresses garde `login_attempt_counters`, la
seule table qu'une requête **non authentifiée** fait écrire. Le journal n'est écrit que par des
actions authentifiées, et une enquête a besoin de l'adresse telle quelle.

### DN-3 — L'audit d'une action locale partage sa transaction ; le trou du proxy est écrit
`RecordTx` écrit dans la transaction de l'action : ou les deux, ou aucune. C'est ce qui rend la trace
non contournable — et c'est aussi pourquoi une partition manquante ferait tomber l'action.

Pour une action **proxyfiée** vers la passerelle il n'y a pas de transaction commune : `Record`
écrit après le succès, et une panne entre les deux perd la trace. Le trou est réel, il est écrit ici
et dans le code, et **M3 en héritera** — le découvrir alors coûterait une passe.

### DN-4 — Le retrait d'une passkey n'exige **aucune** permission
La fiche, le §5.1 et le contrat disaient le contraire : « la seule opération de ce préfixe qui exige
une permission ». **Les trois sont corrigés dans cette PR.**

Aucune clé du catalogue ne convient : retirer sa propre passkey est du self-service, pas un acte sur
autrui. En créer une (`mfa:manage`) ferait une quatrième clé orpheline — donc une clé qu'il faudrait
attacher aux neuf rôles pour que le self-service marche, c'est-à-dire une clé qui n'exclut personne.
Elle garde son exigence d'élévation et gagne une ligne d'audit ; c'est `operators:manage` qui gardera
le geste **sur autrui**, en step-029.

### DN-5 — Six des huit mutations de `/auth/` sont auditées, et les deux exemptées le sont nommément
Les deux ouvertures de cérémonie WebAuthn n'ont aucun effet durable : un défi tiré, remplacé au
prochain appel, consommé ou échu en cinq minutes. Les tracer produirait du bruit qu'une enquête
devrait apprendre à écarter, ce qui est le meilleur moyen de lui faire écarter autre chose. Un
scénario garde l'exemption elle-même.

**Seuls les succès sont journalisés.** Un refus est déjà compté par le verrou d'essais, et
journaliser les échecs de connexion ouvrirait une écriture par requête non authentifiée : c'est
précisément ce que `login_attempt_counters` existe pour éviter d'exposer.

`register/finish` est **audité bien qu'exempté de garde** : il pose un second facteur, l'événement
qu'une enquête sur compte compromis cherche en premier. Exemption de garde et exemption d'audit ne se
confondent pas.

### DN-6 — Les trois routes gratuites sont bornées par un compteur d'**appels**, pas d'échecs
`POST /auth/mfa/totp/enroll`, `register/begin` et `assert/begin` réussissent à chaque fois : les
trois dimensions existantes de `login_attempt_counters` ne comptent que des échecs et ne les voyaient
jamais passer. La migration 00009 en ajoute deux qui comptent des appels — la divergence avec les
noms `failures` et `last_failure_at` est écrite dans la migration plutôt que laissée à découvrir.

Deux dimensions et non une : un enrôlement hache dix argon2id là où une ouverture écrit une ligne, et
un budget commun serait trop lâche pour l'un ou trop serré pour l'autre. Cinq enrôlements et vingt
ouvertures par quart d'heure ; **une garde qui refuse du légitime finit retirée**, et une clé qu'on
cherche produit de vraies reprises.

**Et la borne de l'enrôlement ferme un canal que la migration 00007 ne voyait pas.** Vérifié en
écrivant cette fiche : `EnrollTotp` appelle `verifyPresentedFactor` pour le remplacement, mais jamais
`Fail` — un code faux présenté à l'enrôlement ne faisait monter aucun compteur. Qui détenait le mot
de passe pouvait donc chercher un code à six chiffres par cette route, sans borne, exactement ce que
00007 avait fermé sur `/auth/mfa/verify`. Le compteur d'appels le ramène à cinq essais par quart
d'heure — le même débit que le verrou d'essais.

**L'ordre — consulter le verrou puis compter — n'est écrit qu'une fois**, dans `store.Counter.Admit`.
Il l'a d'abord été deux fois, un appelant chacun, et la mutation qui l'inverse est restée verte sur
celui des deux qu'aucun scénario d'échéance n'atteint. C'est ce qui a fait replier les deux gestes en
une méthode.

### DN-7 — `pgx` nu confirmé, et le critère de réexamen était un proxy

`plan.md` §19 fixait le réexamen à cette step et nommait deux déclencheurs. Mesurés :

| Déclencheur | Aujourd'hui |
|---|---|
| « un store au-delà d'une vingtaine de requêtes » | **29** littéraux SQL nommés, 42 sites d'appel |
| « une requête à plus de cinq ou six colonnes » | **dix** — `internal/store/webauthn.go:137` |

Les deux ont tiré, et le second dès step-024. Des trois jambes de la décision de step-020, **une est
cassée** : « `sqlc` n'aurait presque rien à engendrer » n'est plus vrai. Les deux autres tiennent, et
la première tient plus fort qu'alors — le second analyseur SQL doit désormais avaler une table
partitionnée, une fonction PL/pgSQL, `uuidv7()`, `make_interval(secs => $n)` et `nullif($1, '')::inet`.

**La troisième a cessé d'être une affirmation pour devenir une mesure.** Le plan nommait précisément
le défaut que `sqlc` supprime par construction : une liste d'arguments de `Scan` tenue à la main. Il
a été reproduit sur le pire cas du dépôt — le scan à dix colonnes de `passkeysOf` — en intervertissant
deux champs **de même type**, ce qui compile et passe le typage :

| Mutation | Résultat |
|---|---|
| `BackupEligible` et `BackupState` intervertis (deux `bool` adjacents) | rouge |
| `CredentialID` et `PublicKey` intervertis (deux `[]byte` adjacents) | rouge |

Le défaut n'est pas silencieux ici : les testcontainers l'attrapent. `pgx` nu tient.

**Et le critère lui-même était un proxy, qui a mal tiré.** « Vingt requêtes, six colonnes » mesure une
taille ; ce qui décide est l'observabilité d'un `Scan` mal ordonné, une propriété du harnais et non du
compte de requêtes. Le déclencheur juste est écrit dans `plan.md` §19 à la place de l'ancien : **un
`Scan` dont la mutation d'interversion de deux champs de même type reste verte**. Falsifiable, et
c'est la discipline que le dépôt applique déjà.

## Mutations mesurées — PR 1/2

Jouées une par une, `-count=1`, lues au code de sortie.

| Mutation | Ce qui rougit |
|---|---|
| `EnsureAuditPartitions` retirée du démarrage | scénario des partitions |
| le branchement du ticker retiré | `TestLeDemarrageEntretientLesPartitionsDAudit` |
| l'audit du login non écrit | « une connexion réussie laisse exactement une trace » |
| l'audit du retrait de passkey retiré | « retirer une clé d'accès laisse une trace » |
| l'adresse de l'appelant non transmise | « l'événement porte l'adresse de l'appelant » |
| le secret versé au journal | « le journal ne porte ni le secret ni les codes de récupération » |
| le verrou d'enrôlement non consulté | « six enrôlements d'affilée sont bornés » |
| l'enrôlement non compté | « six enrôlements d'affilée sont bornés » |
| la borne des cérémonies ne refuse plus | « vingt et une ouvertures d'affilée sont bornées » |
| les deux cérémonies ne partagent plus leur seau | « le seuil des cérémonies est commun … » |
| compter avant de consulter le verrou | « le verrou se lève tout seul, et la fenêtre oublie » |
| la fenêtre n'oublie pas (`CASE` retiré) | « le verrou se lève tout seul, et la fenêtre oublie » |

**Deux mutations ont d'abord survécu, et les deux étaient mal construites** : l'une remplaçait la
dimension des cérémonies par celle de l'enrôlement — les deux continuaient de la partager, donc le
défaut visé n'était pas reproduit ; l'autre inversait l'ordre sur le chemin des cérémonies, qu'aucun
scénario d'échéance n'atteint. La seconde a révélé un vrai défaut de conception et a été corrigée
dans le code, pas dans la mutation.

**Le 429 déclaré au contrat n'a pas de mutation**, et c'est mesuré plutôt que supposé : le retirer du
YAML fait disparaître le type engendré, donc le code ne compile plus. La conformité est tenue par le
compilateur, pas par un test.

## Points d'implémentation clés
- **La garde se pose par `operationID` parce que c'est ce que le code engendré offre.** Une garde
  montée sur un préfixe de chemin garde ce que le préfixe attrape, pas ce que le contrat déclare : le
  jour où une opération change de chemin, elle sort de la garde sans que rien ne le dise.
- **Le test d'énumération ne doit pas tirer ses cas de la table qu'il garde.** La population des
  opérations de mutation se lit dans le **YAML** (`POST`, `PATCH`, `PUT`, `DELETE`) ; la table de
  gardes est l'**objet** testé, jamais la source des cas. Une porte dont les cas viennent de la donnée
  qu'elle garde ne voit pas sa dérive — et la mutation qui compte est de **retirer** une entrée, pas
  d'en altérer une.
- **`chi.Walk` seul ne suffira pas** : mesuré en step-004, toutes les routes sous `/api` sont servies
  par le même wrapper engendré, et le choix d'implémentation vit dans un champ non exporté de closure
  qu'aucune réflexion n'atteint (`internal/bff/router_test.go:180-189`). Le walk prouve qu'une route
  est montée ; c'est la confrontation contrat ↔ table qui prouve qu'elle est gardée.
- **Les exemptions sont une liste courte et justifiée dans le code** : `/auth/login`, `/auth/mfa/*`,
  `/auth/logout`, `/health`. Une liste qui s'allonge sans raison écrite est le premier état d'une
  garde désactivée.
- **`audit_log` ne reçoit ni secret ni corps de message.** `before_json` / `after_json` sont produits
  par un réducteur qui **énumère les champs autorisés**, jamais par le marshal d'un type de domaine :
  la même règle que le DTO de sortie (§1.11), appliquée à une écriture. Un payload piégé le vérifie.
- **L'audit est écrit dans la transaction de l'action quand l'action est locale.** Pour une action
  proxyfiée vers la passerelle il n'y a pas de transaction commune : l'audit s'écrit après le succès,
  et ce trou-là s'écrit là où il vit — M3 en héritera, et le découvrir alors coûterait une passe.
- **Cette step est la première dont une écriture dépend des partitions d'`audit_log`.** step-005
  (DN-11) a mesuré que `ensure_audit_log_partitions()` n'est appelée qu'à l'application de la
  migration, et qu'aucun appelant récurrent n'existe : sur une base migrée aujourd'hui, **toute
  écriture d'audit sera refusée au troisième mois**. Comme l'audit partagera la transaction de
  l'action, c'est l'action qui tombera. Cette step livre l'appel récurrent, ou écrit noir sur blanc qui
  le porte et quand — elle ne peut pas l'ignorer.

## Tests (écrits dans la même PR)
- **Test d'énumération**, bloquant : toute opération de mutation du contrat a une entrée dans la table
  de gardes ; toute entrée désigne une clé qui existe au catalogue ; toute exemption est déclarée.
- **Scénario** `autorisation.feature` : un opérateur sans `operators:manage` est refusé sur une
  écriture qui l'exige, et **voit pourquoi** ; avec la clé, il passe.
- Une session non élevée est refusée sur une écriture, quelles que soient ses permissions.
- Une mutation réussie écrit **exactement une** ligne d'audit ; une mutation refusée n'en écrit pas
  (ou en écrit une de refus — tranché et écrit, pas laissé au hasard).
- Payload piégé : un objet portant un champ `password_hash` et un champ `body` ne laisse ni l'un ni
  l'autre dans `audit_log`.

## Definition of Done
- [ ] `make check` vert
- [ ] **retirer une garde au hasard fait rougir la suite** — vérifié sur trois opérations distinctes,
      pas supposé (checkpoint M1)
- [ ] la mutation « retirer l'exigence de session élevée » fait rougir
- [ ] la mutation « retirer l'écriture d'audit d'une mutation » fait rougir
- [ ] la mutation « retirer une entrée de la table de gardes » fait rougir le test d'énumération —
      **en retirant**, pas en altérant
- [ ] le sort des partitions d'`audit_log` est réglé ou écrit avec son propriétaire et sa date

## Hors périmètre
`usePermission` / `PermissionGate` côté client → step-040. L'écran de consultation du journal
d'audit → step-184. La rétention et le détachement des partitions → step-187. Les gardes des écrans
métier → leurs steps respectives, qui consomment ce middleware sans le redéfinir.

## Dettes ouvertes par cette step, avec leur porteur

- **Trois rédactions du même SQL de compteur.** `Logins` (premier facteur), `MFA` (second facteur) et
  `Counter` (appels) portent chacune l'incrément atomique et la fenêtre d'oubli. Replier les deux
  premières sur `Counter` est un remaniement de leur chemin — celui du premier facteur compte deux
  dimensions en une instruction — et n'est pas de cette step. **Sans porteur**, et c'est assumé :
  aucune des trois n'est fausse aujourd'hui, le risque est qu'une correction future n'en touche
  qu'une.
- **Aucune durée de rétention n'existe nulle part.** Le §3.1 renvoie à un document compagnon absent
  du dépôt. `audit_log` croît sans borne. → **step-187**, avec le détachement des partitions.
- **`GET /audit-log` filtrera sur `target_type` sans index.** La table est partitionnée par mois, donc
  un filtre par cible balaiera chaque partition retenue. → **step-184**, qui livre l'écran.
- ~~**`pgx` nu vs `sqlc` : le point de réexamen est re-daté à step-029.**~~ **La première rédaction de
  ce point était fausse, et le reste de cette puce la corrige.** Elle re-datait sans avoir mesuré les
  deux déclencheurs que `plan.md` nommait — or les deux avaient tiré, et le second dès step-024.
  Le réexamen a donc eu lieu ici, à la date prévue. **Verdict : `pgx` nu, confirmé** ; voir DN-7.
- **L'enrôlement TOTP ne compte toujours aucun échec dans la dimension qui convient.** Le compteur
  d'appels de DN-6 le borne au bon débit, mais un code faux y coûte autant qu'un enrôlement légitime,
  et un opérateur qui se trompe trois fois consomme trois cinquièmes de son budget d'enrôlement. La
  dimension juste est celle des échecs de second facteur, qui existe déjà. → **step-029**, qui reprend
  ce chemin pour la réinitialisation par un administrateur.

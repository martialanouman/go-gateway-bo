# step-025 — `RequirePermission`, journal d'audit, second facteur obligatoire *(invariant c)*

> **Jalon :** M1 (§6.10, §3.1) · **Statut :** À FAIRE
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

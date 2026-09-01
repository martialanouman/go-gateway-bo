# step-029 — Gestion des opérateurs et des rôles

> **Jalon :** M1 (§6.10, §5.1) · **Statut :** À FAIRE
> **Dépend de :** step-025, step-026, step-028 · **Bloque :** — (clôt M1)

## But
Administrer qui entre et ce qu'il peut faire, depuis l'interface plutôt que depuis la base. C'est la
step qui rend `operators:manage` et `roles:manage` utiles, et la première du produit à porter une
surface serveur **et** son écran dans la même PR.

## Périmètre (ce que fait CETTE PR)
- Les routes du BFF : `GET/POST/PATCH/DELETE /operators`, `POST /operators/{id}/roles`,
  `GET/POST/PATCH/DELETE /roles` — avec leurs DTO, leurs gardes (step-025) et leur audit.
- L'écran **Opérateurs** : liste, création, désactivation, rôles détenus, réinitialisation du second
  facteur.
- L'écran **Rôles** : les neuf par défaut en lecture, les rôles personnalisés en édition, les
  permissions **groupées par catégorie** depuis le catalogue engendré (`web/src/lib/permissions.gen.ts`).
- Les refus structurels, chacun expliqué : rôle par défaut non supprimable, rôle détenu non
  supprimable, auto-verrouillage impossible.

### Huit dettes que cette step hérite

*Écrites ici et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est ouverte par
personne. Les huit figurent au registre de `todo.md`.*

- **Un refus de permission ne laisse aucune trace côté serveur, et c'est cette step qui le rend
  visible.** `internal/bff` ne reçoit aucun `*slog.Logger` (`router.go:151-156`), et le journal
  d'audit ne porte que les **succès** — un 403 de `RequirePermission` n'existe donc nulle part.
  step-025 renvoyait la dette à step-060, qui apporte le journal avec le premier appel à la
  passerelle : **c'est plus tard que la step qui la fait mordre**, step-029 étant en M1 et step-060
  en M3. Le porteur est corrigé ici.

  **La forme proposée n'exige aucun journal : auditer les refus de permission.** La règle « seuls les
  succès sont journalisés » a une raison écrite — journaliser les échecs de connexion ouvrirait une
  écriture par requête **non authentifiée**, ce que `login_attempt_counters` existe précisément pour
  éviter d'exposer. Cette raison **ne s'applique pas à un 403 de permission**, qui vient par
  construction d'une session vivante *et* élevée : l'écriture est bornée par le nombre de sessions
  authentifiées, et c'est exactement ce qu'une enquête cherche — qui a tenté ce qu'il ne pouvait pas
  faire. Trancher dans cette PR, avec la première route gardée sous les yeux.

  Les **500**, eux, restent sans trace, et ça reste l'affaire de step-060 : ils ne sont pas bornés
  par une session, et le journal les attend de toute façon.

- **Le premier enrôlement d'un second facteur est libre pour toute session de premier facteur**
  (step-023, puis step-024 pour les passkeys). Sur un déploiement neuf, aucun opérateur n'est enrôlé :
  un mot de passe volé pendant cette fenêtre vaut un compte complet. C'est le problème d'amorçage
  classique du MFA, assumé faute de mieux — mais cette step est celle qui saura enrôler **pour le
  compte d'un autre**, donc celle qui peut fermer la fenêtre : un opérateur créé par un
  `operators:manage` peut recevoir son facteur d'emblée, ou un jeton d'enrôlement à usage unique.
- **La réinitialisation du second facteur d'un autre opérateur** est le chemin de sortie que
  step-023 et step-024 nomment toutes deux dans leurs refus : « sa réinitialisation par un
  administrateur arrivera avec la gestion des opérateurs ». Deux messages d'erreur en production
  promettent donc cette step. Ils deviendront faux si elle ne la livre pas.
- **Un authentificateur WebAuthn au compteur cassé enferme l'opérateur sur *tous* ses facteurs, et la
  seule sortie est celle que cette step livre.** step-024 a mesuré le dilemme et refusé de le trancher
  seule : « cinq assertions refusées pour compteur reculé ferment aussi le TOTP et les codes de
  récupération, un quart d'heure. Le découpler rouvrirait le trou que DN-7 ferme ; le laisser expose
  un opérateur au matériel défaillant. **Aucune des deux sorties n'est évidente.** » La réinitialisation
  par un administrateur — la puce ci-dessus — la rend évidente : le verrou peut rester serré parce
  qu'il cesse d'être définitif.
- **Les descriptions des neuf rôles par défaut ne sont gardées que par la relecture, et c'est cet
  écran qui les affiche.** step-020 : « rien ne dit qu'une phrase décrit bien ce que le rôle accorde.
  **Quatre ont menti** et ont été corrigées à la main, sur trois passes de revue […] C'est la ligne de
  ce tableau qui a le plus coûté. » L'écran des rôles les montre telles quelles à un opérateur qui
  s'en sert pour décider à qui accorder quoi — une description fausse y devient une erreur
  d'attribution, pas une coquille.
- **La seule politique de mot de passe du produit ne s'applique qu'au premier opérateur.**
  `internal/config/bootstrap.go` le dit en toutes lettres : « c'est la seule politique de mot de passe
  du produit à ce jour […] l'écran de gestion des opérateurs (step-029) tranchera pour les comptes
  suivants ». Le renvoi existait donc depuis step-020 ; ce qui manquait est qu'il soit lu ici. Sans
  cette ligne, la step passerait sans la payer pendant que le registre affirmerait le contraire.

- **Les deux moitiés de la question que DN-8 de step-020 a léguée, et qu'aucune autre step ne touche.**
  D'abord : un rôle personnalisé qui porterait le nom d'un rôle par défaut — celui d'aujourd'hui ou
  celui qu'une release future ajoutera — « serait basculé en `is_default`, verrait sa description
  écrasée et ses attributions ramenées à la liste du code. Le rapport le compte, donc ce n'est pas
  silencieux, mais **c'est destructeur par défaut** ». `seed.go` désigne nommément cette step pour
  décider « si l'écran interdit ces neuf noms ou ce qu'il fait d'une collision ».

- **Ensuite : un administrateur qui édite un rôle par défaut verra son édition défaite au déploiement
  suivant**, et step-020 ajoute que « la seconde sortie ne marche pas en l'état ». C'est la première
  moitié de la même question ; les deux se tranchent ensemble ou pas du tout.

## Points d'implémentation clés
- **L'auto-verrouillage est le défaut qui coûte l'installation** : un opérateur ne peut ni se retirer
  `operators:manage` / `roles:manage`, ni se désactiver. Sans cette règle, une installation devient
  inadministrable autrement qu'en écrivant dans la base à la main.
- **Désactiver un opérateur révoque ses sessions**, immédiatement. C'est exactement ce que la session
  avec état de step-022 a été choisie pour permettre ; livrer la désactivation sans la révocation
  laisserait le compte vivant jusqu'à expiration.
- **`RESTRICT` est déjà en base** sur `operator_roles.role_id` (step-005) : supprimer un rôle encore
  détenu échoue au niveau du schéma. L'écran doit le dire **avant** en nommant les détenteurs, pas
  traduire une violation de contrainte en toast d'erreur.
- **Aucune route `/permissions` n'est livrée** — le catalogue voyage déjà dans le bundle, engendré
  depuis la source Go (step-006), et une route engendrée sans appelant est pire que du code mort :
  `check-generated` la maintiendrait à vie pendant que rien ne la prouve. Le §5.1 la déclare : il est
  **amendé** dans cette PR, ou la route est livrée avec son appelant. Trancher, et écrire la raison.
- **Un contrôle interdit est désactivé et expliqué**, jamais masqué — et l'écran des rôles est
  l'endroit où cette règle se voit le plus, puisqu'il affiche des permissions que son utilisateur ne
  détient pas lui-même.
- **Cette step est grosse, et la coupe est préparée** : si la PR dépasse ce qu'une revue lit
  réellement, les routes et leurs scénarios partent seules et les deux écrans deviennent `step-030`.
  Décider **avant** d'écrire, pas au moment de pousser.

## Tests (écrits dans la même PR)
- **Scénario** `operateurs.feature` : sans `operators:manage`, la création est refusée et la raison
  est dite ; avec, elle réussit et laisse une ligne d'audit.
- Se retirer `operators:manage` est refusé ; se désactiver aussi.
- Désactiver un opérateur invalide ses sessions : la requête suivante avec son cookie est refusée.
- Supprimer un rôle détenu est refusé, en nommant les détenteurs ; un rôle par défaut n'est pas
  supprimable.
- **Composants (Vitest)** : l'éditeur de rôle groupe les 44 clés par catégorie, le clavier suit, les
  contrôles interdits sont désactivés et expliqués.
- **Parcours (Playwright)**, en étendant celui de step-028 : le premier administrateur crée un second
  opérateur, lui attribue un rôle, et cet opérateur entre.

## Definition of Done
- [ ] `make check` vert et `make e2e` vert
- [ ] la mutation « autoriser le retrait de sa propre permission d'administration » fait rougir
- [ ] la mutation « ne pas révoquer les sessions à la désactivation » fait rougir — le compte reste
      vivant, et c'est le genre de défaut qu'un test de rendu ne voit jamais
- [ ] la mutation « retirer la garde de `POST /operators` » fait rougir le test d'énumération de
      step-025 **et** le scénario
- [ ] le sort de `GET /permissions` est tranché et écrit — dans la spec si elle est amendée
- [ ] la politique de mot de passe des comptes créés depuis l'écran est tranchée et écrite ; sans quoi
      la seule du produit reste celle du bootstrap, qui ne s'applique qu'au premier opérateur
- [ ] **M1 est clos** : les **douze** fiches sont dans `tasks/steps/done/`, et le checkpoint du
      `plan.md` §6 est vérifié plutôt que déclaré. *Dix jusqu'au 31/08/2026, puis step-031 et step-032
      ont rejoint le jalon.*

## Hors périmètre
L'écran de consultation du journal d'audit → step-184. Les rôles personnalisés à portée restreinte
(par client, par groupe) — non prévus par la spec, à ne pas inventer ici. Toute surface métier.

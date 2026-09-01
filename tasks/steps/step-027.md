# step-027 — Écrans Login & MFA, branchés sur le BFF Go

> **Jalon :** M1 (§6.9, §4.2) · **Statut :** À FAIRE
> **Dépend de :** step-025, **step-040** (AppShell, `usePermission`, `PermissionGate`), step-041,
> step-042 · **Bloque :** step-028, step-029

## But
La porte d'entrée : deux écrans hors de la coquille, une garde de route qui s'exécute **aussi sur une
URL collée**, et aucun chemin qui tourne en rond. C'est le premier écran du produit à parler pour de
bon au BFF.

## Périmètre (ce que fait CETTE PR)
- Routes `/login` et `/mfa`, hors de l'`AppShell` : un opérateur non connecté n'a ni rail ni barre.
- Formulaire d'identifiants, puis challenge du second facteur — TOTP et passkey — sur ce que
  `/auth/login` a répondu.
- **Garde de route** : toute route de la coquille exige une session ; la destination demandée est
  conservée et rejouée après le login.
- Les cinq états de contenu là où ils s'appliquent, et les erreurs **champ par champ** depuis
  `errors[]` (§1.4).
- L'extension d'un **parcours Playwright existant** contre le binaire, jusqu'à la console.

### Deux dettes que cette step hérite

*Écrites ici et non seulement dans `steps/done/`, parce qu'une fiche archivée n'est ouverte par
personne. Les deux figurent au registre de `todo.md`.*

- **Le préfixe `__Host-` du cookie de session n'est vu par aucun scénario, et c'est cette step qui
  peut enfin le voir.** step-022 a mesuré le comportement dans Chromium et l'a écrit, mais son propre
  constat reste vrai : « le harnais porte ses cookies à la main et **accepterait n'importe quel nom** ».
  Seul un vrai navigateur applique le préfixe — il refuse un cookie `__Host-` porteur d'un `Domain`,
  d'un `Path` autre que `/`, ou servi sans `Secure`. Le parcours Playwright authentifié que cette step
  étend est le premier endroit du dépôt où cette règle s'exerce pour de bon.

- **Les valeurs des durées de session — 12 h absolue, 2 h d'inactivité — ne sont gardées par rien** :
  les changer laisse tout vert. step-022 le dit et l'assume, « c'est une décision, pas un invariant ».
  Cette step est la **première consommatrice** de la valeur : `expiresAt` a été renommé
  `absoluteExpiresAt` en step-022 précisément « avant que step-027 en fasse un décompte ». Ce qu'elle
  a à garder n'est donc pas la valeur mais **l'accord entre ce que le serveur pose et ce que l'écran
  affiche** — un décompte qui ment sur l'échéance est un défaut, une échéance qui change n'en est pas
  un.

## Points d'implémentation clés
- **La garde doit s'exécuter sur une URL collée.** En v1.0 elle ne s'exécutait jamais dans ce cas
  pendant que trois tests la déclaraient verte — c'est l'un des trois défauts que seul le parcours de
  bout en bout a trouvés (critère 1 de la DoD). Un test de composant ne peut pas le voir.
- **Pas de boucle entre le login et le second facteur** : la v1.0 en a livré une. Un opérateur qui
  n'a pas encore enrôlé de facteur va à l'**enrôlement** (step-028), pas au challenge — et cette
  step-ci doit donc décider ce qu'elle fait avant que step-028 n'existe : renvoyer vers un état
  explicite nommant le jalon, jamais vers un cul-de-sac.
- **Rien de simulé dans le produit** : pas de `QueryClientProvider` fourni par le harnais, pas de
  client injecté. La v1.0 avait un provider absent de l'application que seul le test possédait.
- **La copie ne distingue pas l'adresse inconnue du mot de passe faux** — elle serait le miroir bavard
  d'une garde serveur qui, elle, se tait (step-021). Le verrouillage, lui, annonce sa durée : un refus
  muet fait retenter.
- **Un contrôle interdit est désactivé et expliqué**, jamais masqué (charte). « Passkey » sur un poste
  qui n'en supporte pas se désactive en disant pourquoi.
- Aucun secret dans l'URL, aucun dans le stockage local : la session vit dans un cookie `HttpOnly` que
  le script ne lit pas (step-022).

## Tests (écrits dans la même PR)
- **Composants (Vitest)** : les cinq états du formulaire, la navigation clavier, la copie, les erreurs
  champ par champ, le contrôle désactivé et son explication.
- **Parcours (Playwright), contre le binaire** : login → second facteur → console, **et** l'URL
  profonde collée sans session qui atterrit sur `/login` puis revient à la destination demandée.
- Un opérateur sans second facteur enrôlé n'atteint jamais un écran dont il ne peut pas sortir.

## Definition of Done
- [ ] `make check` vert et `make e2e` vert
- [ ] clavier et libellés accessibles (WCAG 2.1 AA) sur les deux écrans
- [ ] la mutation « retirer la garde de route » fait rougir le parcours de l'URL collée — et
      **seulement** lui, ce qui est le constat qui compte
- [ ] la mutation « renvoyer un opérateur sans facteur vers le challenge » fait rougir
- [ ] la copie a été relue contre les réponses réelles du BFF, pas contre l'intention

## Hors périmètre
L'enrôlement du second facteur → step-028. La gestion des opérateurs → step-029. Le rail et la barre
supérieure → step-040. L'audit d'accessibilité complet et les cinq parcours → step-185.

# step-024 — MFA WebAuthn / passkey

> **Jalon :** M1 (§6.9) · **Statut :** À FAIRE
> **Dépend de :** step-023 · **Bloque :** step-025, step-028
>
> *La dépendance à step-023 n'est pas technique — les deux cérémonies sont indépendantes. Elle est
> celle du refus « retirer le dernier facteur enferme l'opérateur » : sans TOTP livré, la règle n'a
> qu'un cas et ne se teste pas.*

## But
Le second facteur que la spec privilégie quand l'appareil le supporte : une clé liée à l'origine, que
l'hameçonnage ne transporte pas. Les deux cérémonies — enregistrement et assertion — vivent
entièrement côté serveur ; le client ne fait que relayer ce que le navigateur produit.

## Périmètre (ce que fait CETTE PR)
- `go-webauthn/webauthn` : enregistrement d'une passkey, assertion à la connexion, élévation de la
  session de step-022.
- `rpID` et `origin` **de configuration serveur** (`DASHBOARD_WEBAUTHN_RP_ID`,
  `DASHBOARD_WEBAUTHN_ORIGIN`), vérifiés à chaque cérémonie.
- Défis à **usage unique**, de courte durée, liés à la session — même nature d'objet que le challenge
  de step-021, et comme lui absent du §3.1 : la migration qui les porte s'écrit ici.
- Stockage des authentificateurs dans `operators.mfa_webauthn_credentials` (colonne `jsonb` déjà
  créée par step-005), avec le **compteur de signature**.
- Plusieurs passkeys par opérateur ; suppression d'une passkey.

## Points d'implémentation clés
- **`rpID` et `origin` ne se lisent jamais dans la requête.** Les lire là reviendrait à laisser
  l'attaquant choisir le domaine contre lequel la clé s'authentifie — c'est exactement la propriété
  que WebAuthn achète, et la seule façon de la perdre.
- **Le compteur de signature qui recule signale un authentificateur cloné** : l'assertion est refusée
  et l'événement notifié. Mais certains authentificateurs rendent toujours zéro : ce cas est **admis
  explicitement et nommé**, jamais contourné en désactivant le contrôle — une garde qui refuse du
  légitime finit retirée.
- **Un défi rejouable annule la cérémonie.** Usage unique, expiration courte, et lié à la session qui
  l'a demandé.
- **Retirer la dernière passkey d'un opérateur qui n'a pas de TOTP l'enferme dehors** : refusé, et
  expliqué en nommant ce qui manque. Un contrôle interdit est désactivé et expliqué, jamais masqué.
- Un opérateur peut détenir TOTP **et** passkey. Laquelle proposer en premier est une décision
  d'écran (step-028), pas de serveur : le serveur accepte les deux à parité.
- La version de `go-webauthn/webauthn` se relève à l'ajout (`pkg.go.dev`), et ses types de session de
  cérémonie se lisent avant d'être utilisés — une signature inventée compile parfois.

## Tests (écrits dans la même PR)
- **Scénario** `mfa-webauthn.feature` : enregistrement puis assertion élèvent la session ; assertion
  sans enregistrement refusée.
- Une assertion dont l'`origin` ne correspond pas à la configuration est refusée.
- Un défi consommé ne peut pas être rejoué.
- Un compteur de signature inférieur au dernier connu est refusé.
- Supprimer la dernière passkey d'un opérateur sans TOTP est refusé, avec la raison.

## Definition of Done
- [ ] `make check` vert
- [ ] la politique sur le compteur à zéro est écrite, avec le cas légitime qu'elle admet
- [ ] la mutation « lire `origin` dans la requête » fait rougir
- [ ] la mutation « accepter un défi déjà consommé » fait rougir
- [ ] la mutation « ignorer le compteur de signature » fait rougir
- [ ] la mutation « autoriser le retrait du dernier facteur » fait rougir

## Hors périmètre
L'exigence de second facteur sur les écritures → step-025. Le choix d'affichage entre passkey et TOTP,
et la détection du support par le navigateur → step-028. La réinitialisation du second facteur d'un
autre opérateur → step-029.

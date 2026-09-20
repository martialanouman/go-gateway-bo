# 042 — Aucune passkey ne porte de nom : la table est livrée sans colonne `name`

> **Porteur :** step-029

## Ce qu'elle coûte si elle dure

« Celle enregistrée le 12 août » n'est pas un nom. Migration + champ au contrat.

**Le porteur passe de step-028 à step-029 le 21/09/2026**, et la raison est mesurée plutôt que
supposée : un nom ne sert qu'où on l'affiche et où on s'en sert pour retirer. Or `DELETE
/auth/mfa/webauthn/passkeys/{passkeyId}` **n'a aucun consommateur et aucune step** — vérifié par un
grep de `tasks/` le 21/09/2026 —, et le périmètre de step-028 ne porte ni inventaire ni retrait :
elle livre l'entrée du premier administrateur, pas la gestion de ses facteurs.

C'est la règle que cette dette cite elle-même, tenue pour de bon : « la colonne s'écrira avec la step
qui saura ce qu'elle doit contenir ». step-028 ne le sait pas.

**Ce que step-029 doit trancher avec elle**, et dans le même mouvement que la dette 045 — « une
opération au contrat que personne n'appelle : la trancher, et écrire la raison » : ou bien elle fait
naître l'inventaire des passkeys, et le nom y gagne son emploi ; ou bien `DELETE
/auth/mfa/webauthn/passkeys/{passkeyId}` reçoit le même sort écrit que `GET /permissions`, et cette
dette se ferme avec lui. Poser la colonne sans l'une ni l'autre livrerait une donnée sans
consommateur, ce que step-037 a précisément élagué.

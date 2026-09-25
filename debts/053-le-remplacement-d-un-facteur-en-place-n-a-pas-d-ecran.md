# 053 — Le remplacement d'un facteur en place n'a pas d'écran

> **Porteur :** step-039

## Ce qu'elle coûte si elle dure

`POST /auth/mfa/totp/enroll` sait remplacer un authentificateur en présentant un code de l'actuel,
mais `web/src/routes/enroll.tsx` n'enrôle que le premier facteur. Un opérateur qui change de
téléphone doit passer par un administrateur, qui lui envoie un lien de réinitialisation
(`POST /operators/{id}/access-link`) — ce qui referme aussi sa session en cours. Le commentaire de
l'écran renvoyait à step-029, dont la fiche ne l'a jamais porté — constaté le 23/09/2026.

**Re-portée de step-030 à step-039 le 23/09/2026** : elle porte sur les facteurs du compte de la
session, que step-039 administre ; step-030 administre les autres opérateurs.

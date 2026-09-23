# 053 — Le remplacement d'un facteur en place n'a pas d'écran

> **Porteur :** step-030

## Ce qu'elle coûte si elle dure

`POST /auth/mfa/totp/enroll` sait remplacer un authentificateur en présentant un code de l'actuel,
mais `web/src/routes/enroll.tsx` n'enrôle que le premier facteur. Un opérateur qui change de
téléphone doit passer par un administrateur (`DELETE /operators/{id}/second-factors`). Le commentaire
de l'écran renvoyait à step-029, dont la fiche ne l'a jamais porté — constaté le 23/09/2026.

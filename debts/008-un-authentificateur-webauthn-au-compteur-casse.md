# 008 — Un authentificateur WebAuthn au compteur cassé verrouille l'opérateur sur **tous** ses facteurs

> **Porteur :** step-029

## Ce qu'elle coûte si elle dure

Cinq assertions refusées ferment aussi le TOTP et les codes de récupération, un quart d'heure. Le découpler rouvrirait le trou que **DN-7** ferme — le verrou d'essais partagé entre méthodes ; la sortie est la réinitialisation par un administrateur.

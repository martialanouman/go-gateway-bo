# 029 — `GET /audit-log` filtrera sur `target_type` **sans index**

> **Porteur :** step-184

## Ce qu'elle coûte si elle dure

La table est partitionnée par mois : un filtre par cible balaiera chaque partition retenue.

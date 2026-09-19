# 039 — `login_attempt_counters` n'est jamais purgée

> **Porteur :** step-187

## Ce qu'elle coûte si elle dure

Une ligne par adresse soumise : la table croît avec chaque tentative sur une adresse nouvelle.

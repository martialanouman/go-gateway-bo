# 068 — L'écran Trafic sonde sans tenir compte de la permission et répartit ses fenêtres entre deux constantes

> **Porteur :** step-081 · la bascule de plage et le flux réécrivent ces requêtes

## Ce qu'elle coûte si elle dure

Quatre défauts relevés le 10/10/2026 à la revue finale de step-080. Aucun ne fausse un chiffre ni
n'ouvre un accès :

- **Les requêtes partent sans `traffic:read`.** `useQuery` n'a pas d'`enabled` ; sans la clé, l'URL
  tapée à la main fait deux appels refusés en 403 et affiche le refus. La garde reste côté serveur,
  invariant (c) ; seul le confort est perdu.
- **La durée et le pas d'une fenêtre vivent à deux endroits** : `WINDOW_SECONDS` (300 s, lu par
  `perSecond`) et `STEP_SECONDS`, dans `web/src/lib/traffic.ts`. Ajouter 1 h ou 24 h sans les
  réunir fausserait en silence les tuiles par seconde.
- **Un graphique à moins de deux points** n'affiche qu'une zone vide avec son libellé
  (`web/src/components/traffic/chart.tsx`), ce qui arrivera au changement de plage.
- **La clé de cache `['metrics', 'summary']` est recopiée dans un test**
  (`web/src/routes/_shell.traffic.test.tsx`) : si elle change d'un seul côté, le test ne vise plus le
  vrai cache.

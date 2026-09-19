# 020 — Quatre lignes d'infrastructure qu'aucune porte ne garde : `config.ConnectTimeout` dans `openSQL`, la position du verrou en tête de transaction, le `ConnectTimeout` de `pgx.Connect` dans `Seed`, `IsoLevel: pgx.ReadCommitted`

> **Porteur :** step-186

## Ce qu'elle coûte si elle dure

« Aucune porte ne rougit », vérifié plutôt que supposé — et pour le `ConnectTimeout` du `Seed`, il n'y a rien à retirer : la borne n'est **pas posée**, c'est un constat et non un correctif. Précédent : step-021 renvoie déjà une mesure d'infra à step-186.

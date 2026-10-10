# Runbook — Tableau de bord Admin

Ce document naîtra entier en M9. Il porte pour l'instant ce que step-070 rend nécessaire en
production : la clé qui signe les jetons de l'API Admin.

## Rotation de la clé de signature des jetons

La passerelle vérifie les jetons du tableau de bord contre son JWKS
(`<DASHBOARD_TOKEN_ISSUER>/.well-known/jwks.json`). Elle le relit dès qu'elle voit un `kid`
inconnu. Chaque étape est un déploiement roulant **terminé sur toutes les instances** avant la
suivante : une instance qui signe avec une clé qu'une autre ne publie pas encore fait répondre 401
à la passerelle dès que sa lecture du JWKS tombe sur l'autre.

1. **Publier.** Engendrer la clé :
   `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out nouvelle.pem`
   (PKCS#8, que le binaire exige). L'ajouter au Secret monté sur `DASHBOARD_TOKEN_KEYS_DIR`, sans
   toucher `DASHBOARD_TOKEN_ACTIVE_KID`. Déployer. Le log de démarrage `émetteur des jetons de
   l'API Admin` liste les deux `kid` dans `kid_publiés` ; `curl` du JWKS les montre aussi.
2. **Signer.** Poser `DASHBOARD_TOKEN_ACTIVE_KID` sur le nouveau `kid` (lu dans `kid_publiés`).
   Déployer. Les jetons émis portent désormais ce `kid`.
3. **Retirer**, au moins **5 minutes** après la fin de l'étape 2 (durée de vie d'un jeton) :
   supprimer l'ancien fichier du Secret. Déployer. **Les jetons personnels signés par l'ancienne
   clé cessent de fonctionner à cet instant** ; leurs détenteurs en redemandent un.

**Clé compromise** : enchaîner les trois étapes sans attendre. Les jetons de l'ancienne clé encore
en vol sont refusés en 401 pendant au plus 5 minutes ; le tableau de bord le montre
(`bff_gateway_rejected_token`) sans déconnecter personne.

**Ce qui casse si l'ordre est rompu** : étape 2 avant que l'étape 1 soit partout → 401 intermittents
(`gateway_token_rejected` dans les logs du BFF) ; étape 3 avant 5 minutes → 401 jusqu'à expiration
des jetons de l'ancienne clé.

## Valeurs à remettre à l'exploitant de la passerelle (ConfigMap `gateway-oidc`)

| Clé | Valeur |
|---|---|
| `OIDC_ISSUER` | la valeur **exacte** de `DASHBOARD_TOKEN_ISSUER`, recopiée octet pour octet (slash final compris ou non, à l'identique) |
| `OIDC_AUDIENCE` | `gateway-admin` |
| `OIDC_JWKS_URL` | `<DASHBOARD_TOKEN_ISSUER>/.well-known/jwks.json`, en https, servi par l'ingress interne et jamais par Internet |
| `OIDC_JWKS_CA_FILE` | le certificat de l'autorité interne qui signe le certificat TLS de cet ingress |

Une réponse 503 `service_unavailable` de la passerelle veut dire qu'elle n'a pas pu lire ce JWKS :
vérifier qu'il répond depuis le réseau de la passerelle, avant toute autre piste.

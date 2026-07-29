# `src/server/` — le BFF

Cette moitié du dépôt ne s'exécute **jamais** dans le navigateur. Elle est la seule à connaître :

- le jeton OAuth2 et les certificats mTLS de l'API Admin de la passerelle,
- la connexion PostgreSQL et Redis,
- le secret de signature de session, celui qui chiffre les secrets TOTP, et celui du webhook
  Alertmanager.

C'est l'**invariant (d)** : le navigateur ne parle jamais directement à l'API Admin. Une règle de
lint interdit d'importer `src/server/gateway/**` ou `src/server/db/**` depuis un composant client
(posée en step-001) — ne la désactive pas localement, elle est la frontière.

C'est aussi ici que vit l'**invariant (c)** : l'autorisation s'applique côté serveur, via
`requirePermission()`. Le rendu conditionnel de l'UI est un confort ; un contrôle masqué dont la
route n'est pas gardée reste une faille.

C'est ici, enfin, que vit l'**invariant (b)** : un secret n'est jamais réaffiché. Le secret TOTP et
les codes de récupération ne sortent qu'une fois, à l'enrôlement (`auth/mfa*.ts`) ; aucune action
« revoir mes codes » n'existe, et il n'y en aura pas.

Les passkeys (`auth/webauthn*.ts`, `auth/mfa-webauthn.ts`) n'y échappent pas mais posent l'inverse :
ce qui est stocké est une clé **publique**, donc la lire ne permet pas de se faire passer pour
l'opérateur. Ce qui compte là est ailleurs — `AUTH_WEBAUTHN_RP_ID` et `AUTH_WEBAUTHN_ORIGIN` sont
vérifiés côté serveur à chaque cérémonie, et c'est **la seule** garantie cryptographique du dépôt
qu'une valeur trop permissive annule au lieu d'affaiblir.

Contenu à venir : client Admin typé (step-001), accès Drizzle (step-002), session et MFA (M1),
WebAuthn (step-024), moteur de permissions et journal d'audit (step-025), hub WebSocket (step-043),
évaluateur d'alertes métier (step-182).

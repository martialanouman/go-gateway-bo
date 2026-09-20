# 052 — Le succès d'une cérémonie WebAuthn n'est exercé par aucun test, ni à l'enregistrement ni à l'assertion

> **Porteur :** step-029

## Ce qu'elle coûte si elle dure

Un opérateur qui choisit la clé d'accès plutôt que l'application d'authentification emprunte un
chemin dont personne n'a jamais vu le succès. La composition du corps de
`POST /auth/mfa/webauthn/register/finish`, le passage à `/mfa` qui suit, l'oubli de session qui le
rend possible, et symétriquement le corps de `POST /auth/mfa/verify` en méthode `webauthn` ne sont
tenus par rien : ils peuvent casser sans qu'aucune porte ne bouge. Les **refus**, eux, sont exercés
des deux côtés — c'est le succès qui manque.

Mesuré le 20/09/2026, sur step-028. jsdom n'expose pas `navigator.credentials`, donc
`startRegistration` et `startAuthentication` échouent toujours : les tests de ces deux écrans
n'atteignent que la rédaction française du refus. Le parcours Playwright, lui, passe par TOTP,
puisque c'est la voie qu'un poste de CI sans authentificateur peut suivre.

    pnpm -C web vitest run --coverage
    # enroll.tsx — 116-122, 337 : l'appel à register/finish et le retour de `createPasskey`
    # mfa.tsx    — 297          : le retour d'`assertPasskey`

Ce qui la refermerait : un **authentificateur virtuel** posé par CDP dans le parcours Playwright —
`WebAuthn.enable` puis `WebAuthn.addVirtualAuthenticator` sur une `CDPSession` —, qui fait répondre
Chromium à `navigator.credentials.create()` et `.get()` sans matériel. Une seule dépense couvre les
deux chemins, et step-029 est la première step qui touche les passkeys pour elles-mêmes :
inventaire, nom, retrait.

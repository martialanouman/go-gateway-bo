import { defineConfig, devices } from '@playwright/test'

/**
 * Bout en bout — le sommet de la pyramide, et le plus petit étage.
 *
 * La règle du projet : beaucoup d'unitaires, des tests de composant, **très peu** de bout en bout.
 * Ces tests-ci couvrent des parcours, jamais des cas limites : ils sont lents, ils échouent pour des
 * raisons qui n'ont rien à voir avec le code, et une suite e2e qu'on n'ose plus croire est pire
 * qu'une suite absente.
 *
 * Ils tournent contre le **build de production** (`pnpm build` puis `pnpm start`), pas contre le
 * serveur de développement : c'est le seul moyen de vérifier ce qui sera réellement servi — rendu
 * serveur compris — et cela évite de tester une pile de développement que personne ne déploie.
 */
export default defineConfig({
  testDir: './e2e',

  // Un `test.only` oublié ferait passer la CI en n'exécutant qu'un test.
  forbidOnly: !!process.env.CI,

  // Une reprise en CI, aucune en local. Deux reprises masqueraient un test réellement instable ;
  // zéro rendrait la CI sensible au moindre aléa de démarrage.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',

  // Une base migrée et un opérateur amorcé : les parcours d'authentification ne se simulent pas.
  globalSetup: './e2e/global-setup.ts',

  use: {
    // **`localhost` et non `127.0.0.1`** : WebAuthn n'accepte pas une adresse IP comme `rpID`, ce que
    // `readWebAuthnConfig` refuse désormais explicitement. `localhost` est par ailleurs un contexte
    // sécurisé aux yeux du navigateur, ce qui rend l'API disponible sans certificat.
    baseURL: 'http://localhost:3100',
    // La trace n'est enregistrée qu'à la reprise : un échec en CI livre alors le film complet
    // (réseau, DOM, console) sans ralentir les exécutions vertes.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    {
      name: 'chromium',
      // L'outil est desktop-first et interne : un seul moteur, à une résolution de poste de
      // travail. Multiplier les navigateurs coûterait du temps de CI sans rien apprendre.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    // Le build n'est PAS lancé ici : en CI il est une étape à part, et en local `pnpm build`
    // précède l'appel. Un build dans cette commande ferait passer un échec de compilation pour un
    // serveur qui n'a pas répondu à temps.
    command: 'pnpm start',
    // Port dédié, distinct du 3000 de `pnpm dev` : un serveur de développement qui traîne serait
    // sinon capté, et on croirait tester le build de production — la seule raison d'être de cette
    // suite — en testant Vite en mode développement.
    url: 'http://localhost:3100',
    // **Jamais de réutilisation, même en local.** Un serveur resté en vie sert le build précédent :
    // le symptôme est un test vert sur du code qui n'existe plus, et il est arrivé pendant l'écriture
    // de ce fichier. Redémarrer coûte une seconde depuis que le build n'est plus dans cette commande.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: '3100',
      // Le bout en bout ne parle pas à la vraie passerelle : il n'a pas à en connaître l'adresse,
      // et une suite qui en dépendrait échouerait pour des raisons étrangères au code testé.
      GATEWAY_MODE: 'mock',
      GATEWAY_ADMIN_BASE_URL: 'http://127.0.0.1:4010',

      // Le serveur est un **process séparé** : il ne peut pas hériter d'un conteneur démarré depuis un
      // test, et il lui faut donc la même base que `globalSetup`. Celle de `docker-compose.yml` en
      // local, un service du job « Bout en bout » en CI.
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://dashboard:dashboard@localhost:5432/dashboard',

      // Des secrets de test, et ils n'ont pas à ressembler à ceux de production — ils doivent
      // seulement exister et faire trente-deux caractères, puisque le serveur refuse de servir
      // l'authentification sans eux.
      AUTH_SESSION_SECRET: 'secret-de-session-pour-le-bout-en-bout-000',
      AUTH_THROTTLE_SECRET: 'secret-de-comptage-pour-le-bout-en-bout-0',
      AUTH_MFA_SECRET: 'secret-mfa-pour-le-bout-en-bout-0000000000',

      // L'origine doit correspondre **caractère pour caractère** à ce que le navigateur annoncera :
      // c'est la vérification que la cérémonie WebAuthn exige, et un port oublié la ferait échouer.
      AUTH_WEBAUTHN_RP_ID: 'localhost',
      AUTH_WEBAUTHN_ORIGIN: 'http://localhost:3100',
    },
  },
})

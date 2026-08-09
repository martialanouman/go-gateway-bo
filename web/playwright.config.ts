import { defineConfig, devices } from '@playwright/test'

// Le port des parcours n'est ni celui du BFF en développement (3001) ni celui de Vite (3000) ni celui
// du mock Prism (4010) : `make e2e` doit pouvoir tourner pendant que `make dev` occupe les siens.
const port = 3101

export default defineConfig({
  // Explicite, et pas seulement par rangement : sans lui, Playwright ramasse les fichiers de Vitest —
  // mesuré le 03/08/2026, il a chargé `chargement-a-froid.test.ts` et échoué dans `describe`, faute du
  // runner qui va avec.
  testDir: './e2e',

  // Un `test.only` oublié ne rougit pas, il rend **vert** sur un seul parcours : `filterOnly()`
  // — `playwright/lib/common/index.js` en 1.62.0 — ne garde du plan que les entrées portant `_only`.
  // Le défaut de Playwright étant `false`, rien ne le dirait. Un seul parcours existe aujourd'hui, la
  // porte doit donc précéder ceux qui rendront le silence coûteux. Mesuré le 03/08/2026 sur un
  // `.only` temporaire : `playwright test --list` rend 0 sans `CI`, et 1 avec `CI=1`, sur « item
  // focused with '.only' is not allowed ». Conditionné à `CI` : `.only` reste l'outil d'itération
  // normal en local.
  forbidOnly: !!process.env.CI,

  // La CI ne réessaie pas : un parcours instable doit se voir tout de suite. Le jour où l'un d'eux
  // clignotera, c'est le parcours qu'il faudra corriger, pas le compteur de reprises.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },

  // Chromium seul. Le produit est un outil interne au parc connu (`CLAUDE.md` : « desktop-first ») :
  // multiplier les moteurs multiplierait le temps de CI sans décrire un risque qu'il court.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // **Le binaire**, jamais `vite dev`. L'ordonnancement `/api` avant le fallback SPA, les en-têtes de
    // cache et l'embarquement des assets n'existent que dans le déployable ; c'est `make e2e` qui le
    // construit avant d'arriver ici.
    command: '../bin/dashboard',
    url: `http://127.0.0.1:${port}/`,
    // Ce que ce `false` tient exactement : `_startProcess` (`playwright/lib/runner/index.js` en
    // 1.62.0) sonde l'URL et, si elle répond déjà, **jette** au lieu de s'y raccrocher — les parcours
    // n'exerceront jamais un serveur qu'ils n'ont pas lancé. Le port dédié ci-dessus rend ce refus
    // tenable en local.
    //
    // Ce qu'il ne tient pas : la fraîcheur du binaire. `command` lance `../bin/dashboard` tel qu'il
    // est sur le disque, donc un `pnpm e2e` direct exercerait un déployable périmé sans le dire. La
    // garantie appartient à `make e2e`, qui dépend de `build`.
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DASHBOARD_ADDR: `127.0.0.1:${port}`,
      // Aucun mock n'est lancé : le client sortant n'est appelé par aucun écran, et la configuration
      // ne fait qu'exiger son adresse au démarrage.
      //
      // La base, elle, **doit répondre et porter les migrations** depuis step-020 : le binaire
      // contrôle la version du schéma avant de lier son port. Un `make e2e` sur un poste sans
      // `docker compose up -d` échoue donc ici sur une erreur de connexion, et avec les conteneurs
      // mais sans `make migrate`, sur un refus qui nomme la version trouvée et la version attendue.
      // Les deux valent mieux qu'un parcours qui échoue sur un écran blanc. `?sslmode=disable` parce
      // que ni le conteneur local ni le service de la CI ne présentent de certificat.
      DASHBOARD_GATEWAY_MODE: 'mock',
      DASHBOARD_GATEWAY_BASE_URL: 'http://127.0.0.1:4010',
      DASHBOARD_DATABASE_URL:
        'postgres://dashboard:dashboard@127.0.0.1:5432/dashboard?sslmode=disable',
      // Obligatoire depuis step-021, sans repli : le binaire refuse de démarrer sans elle, et ce
      // refus arrive avant qu'il ne lie son port — un parcours démarrerait donc sur un serveur qui
      // n'écoute pas. Rien d'un secret : aucun parcours ne relit un HMAC.
      DASHBOARD_BRUTEFORCE_SALT: 'un-sel-de-parcours-assez-long-pour-passer-la-borne',
    },
  },
})

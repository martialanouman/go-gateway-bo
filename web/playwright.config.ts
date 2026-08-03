import { defineConfig, devices } from '@playwright/test'

// Le port des parcours n'est ni celui du BFF en développement (3001) ni celui de Vite (3000) ni celui
// du mock Prism (4010) : `make e2e` doit pouvoir tourner pendant que `make dev` occupe les siens.
const port = 3101

export default defineConfig({
  // Explicite, et pas seulement par rangement : sans lui, Playwright ramasse les fichiers de Vitest —
  // mesuré le 03/08/2026, il a chargé `chargement-a-froid.test.ts` et échoué dans `describe`, faute du
  // runner qui va avec.
  testDir: './e2e',

  // La CI ne réessaie pas : un parcours instable doit se voir tout de suite. Le jour où l'un d'eux
  // clignotera, c'est le parcours qu'il faudra corriger, pas le compteur de reprises.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },

  // Chromium seul. Les cinq parcours de la spécification décrivent un outil interne desktop-first, dont
  // le parc est connu : multiplier les moteurs multiplierait le temps de CI sans décrire un risque que
  // ce produit court.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // **Le binaire**, jamais `vite dev`. L'ordonnancement `/api` avant le fallback SPA, les en-têtes de
    // cache et l'embarquement des assets n'existent que dans le déployable ; c'est `make e2e` qui le
    // construit avant d'arriver ici.
    command: '../bin/dashboard',
    url: `http://127.0.0.1:${port}/`,
    // Jamais de réutilisation, même en local : un serveur déjà lancé sert des assets embarqués à une
    // autre version que celle qu'on vient de construire, et le parcours dirait vert d'un binaire qu'il
    // n'a pas exercé. Le port dédié ci-dessus est ce qui rend ce refus tenable.
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DASHBOARD_ADDR: `127.0.0.1:${port}`,
      // Aucun mock n'est lancé et aucune base n'est jointe : la configuration est exigée au démarrage,
      // mais le client sortant n'est appelé par aucun écran et le pool ne se connecte qu'à la première
      // requête qui le demande (DN-5 de step-005).
      DASHBOARD_GATEWAY_MODE: 'mock',
      DASHBOARD_GATEWAY_BASE_URL: 'http://127.0.0.1:4010',
      DASHBOARD_DATABASE_URL: 'postgres://dashboard:dashboard@127.0.0.1:5432/dashboard',
    },
  },
})

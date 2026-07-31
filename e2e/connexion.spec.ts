import { expect, test } from '@playwright/test'
import { totpCodeAt } from '../src/server/auth/mfa-totp'
import { callApi } from './api'
import { E2E_OPERATOR } from './global-setup'
import { resetMfaFactors } from './reset-mfa'

/**
 * L'entrée dans la console, dans un vrai navigateur.
 *
 * ## Ce que ce fichier apporte que les tests jsdom ne peuvent pas
 *
 * La garde de session ne s'exécute que côté navigateur — le cookie est `HttpOnly` et n'accompagne
 * pas un `fetch` émis pendant le rendu serveur. Les tests de route prouvent la décision ; ils ne
 * prouvent pas qu'un opérateur qui ouvre `/trafic` au clavier atterrit bien sur le login, parce que
 * jsdom ne rend rien côté serveur et ne s'hydrate pas. C'est ici que cette moitié se vérifie.
 *
 * Et le cookie de session lui-même : sa signature, ses attributs, sa transmission d'une navigation à
 * l'autre. Aucun test de composant ne le voit passer.
 *
 * ## Pourquoi `serial`
 *
 * Les parcours partagent **un** opérateur — l'amorçage refuse d'en installer un second — et celui-ci
 * enrôle un TOTP. Les laisser courir en parallèle ferait dépendre le résultat de l'ordre des
 * workers, ce qui est la définition d'un test intermittent.
 */
test.describe.configure({ mode: 'serial' })

test.beforeAll(resetMfaFactors)

test('un anonyme qui vise un écran atterrit sur le login', async ({ page }) => {
  await page.goto('/trafic')

  // La redirection tombe à l'hydratation, pas au rendu serveur : on attend l'URL plutôt que de la
  // lire tout de suite.
  await expect(page).toHaveURL(/\/connexion$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion opérateur')

  // Aucune coquille derrière : ni rail, ni nom d'opérateur. Il n'y en a pas encore un.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0)
})

test('un mot de passe refusé le dit sans dire si le compte existe', async ({ page }) => {
  await page.goto('/connexion')

  await page.getByLabel(/Adresse e-mail/).fill(E2E_OPERATOR.email)
  await page.getByLabel(/Mot de passe/).fill('ce n’est pas le bon mot de passe')
  await page.getByRole('button', { name: /Continuer/ }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toHaveText(/identifiant ou mot de passe incorrect/)

  // Le même message qu'un compte inexistant recevrait. C'est ce qui empêche d'énumérer les
  // opérateurs de la console en essayant des adresses.
  await expect(alert).not.toHaveText(/inconnu|introuvable/)

  // Et le mot de passe n'a pas voyagé dans l'URL : le formulaire ne navigue pas.
  expect(page.url()).not.toContain('mot de passe')
})

test('login puis code TOTP mènent à la console, où l’annuaire s’administre', async ({ page }) => {
  // ─── Enrôlement par l'API : l'écran d'enrôlement arrive en step-028 ───
  // Le parcours démarre donc là où un opérateur déjà équipé se trouve. Ce que ce test prouve est
  // l'entrée, pas l'équipement.
  await page.goto('/connexion')
  const login = await callApi(page, '/api/auth/login', {
    identifier: E2E_OPERATOR.email,
    password: E2E_OPERATOR.password,
  })
  expect(login.status, JSON.stringify(login.body)).toBe(200)

  const started = await callApi(page, '/api/auth/mfa/enroll', {})
  expect(started.status, JSON.stringify(started.body)).toBe(200)
  const secret = started.body.secret as string

  const confirmed = await callApi(page, '/api/auth/mfa/enroll', {
    code: await totpCodeAt(secret, new Date()),
  })
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)

  await callApi(page, '/api/auth/logout', {})

  // ─── Et maintenant, l'entrée par les écrans ───
  await page.goto('/trafic')
  await expect(page).toHaveURL(/\/connexion$/)

  await page.getByLabel(/Adresse e-mail/).fill(E2E_OPERATOR.email)
  await page.getByLabel(/Mot de passe/).fill(E2E_OPERATOR.password)
  await page.getByRole('button', { name: /Continuer/ }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vérification en deux étapes')
  await expect(page.getByText(E2E_OPERATOR.email)).toBeVisible()

  await page.getByRole('tab', { name: /TOTP/ }).click()

  // **Le pas de temps suivant**, et pas celui qui vient d'enrôler : un code déjà consommé est rejeté
  // comme un rejeu, ce qui est précisément ce que la protection doit faire. La tolérance de dérive
  // est d'un pas de part et d'autre, donc ce code-ci est accepté.
  const nextStep = new Date(Date.now() + 30_000)
  await page.getByLabel(/Code à 6 chiffres/).fill(await totpCodeAt(secret, nextStep))
  await page.getByRole('button', { name: /^Vérifier/ }).click()

  // La console, avec son rail : la session est complète et porte les permissions du rôle.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(
    'Vérification en deux étapes',
  )

  // ─── L'annuaire (step-027) ─────────────────────────────────────────────────────────────────
  // Le parcours continue avec la même session plutôt que d'ouvrir un fichier : la règle du dépôt
  // est « très peu de bout en bout », et un fichier par step donnerait une soixantaine de parcours
  // à la fin du plan. Ce qui est prouvé ici ne l'est nulle part ailleurs — les modales de Base UI
  // font boucler `renderRoute`, dont l'arbre monte un document à deux racines (voir
  // `src/routes/_shell.operateurs.test.tsx`).

  await page.goto('/operateurs')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opérateurs')

  // ─── Créer un opérateur : le mot de passe initial n'apparaît qu'une fois ───
  await page.getByRole('button', { name: 'Créer un opérateur' }).click()
  await page.getByLabel('Adresse email').fill('recrue.e2e@example.test')
  await page.getByLabel('Nom affiché').fill('Recrue de test')
  await page.getByRole('checkbox', { name: 'auditor' }).click()
  await page.getByRole('button', { name: 'Créer le compte' }).click()

  // Vingt caractères de l'alphabet sans ambiguïté : c'est la seule fois où cette valeur existe hors
  // du BFF. Elle n'est pas recopiée ici — l'asserter par sa forme suffit, et l'écrire dans le test
  // la ferait entrer dans un rapport d'exécution.
  const motDePasseInitial = page.getByText(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/)
  await expect(motDePasseInitial).toBeVisible()

  await page.getByRole('button', { name: 'J’ai noté le mot de passe' }).click()
  await page.getByRole('button', { name: 'Créer un opérateur' }).click()

  // **Invariant (b), dans le seul écran du produit qui montre un secret** : rouvrir la modale ne le
  // réaffiche pas, et aucune action « révéler » n'existe.
  await expect(page.getByText(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{20}$/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Annuler' }).click()

  const recrue = page.getByRole('row', { name: /recrue\.e2e@example\.test/ })
  await expect(recrue).toBeVisible()
  await expect(recrue).toContainText('auditor')
  // Un compte neuf n'a pas de second facteur, et l'écran le dit : c'est ce qui permet de repérer
  // qui ne pourra pas entrer.
  await expect(recrue).toContainText('aucun')

  // ─── Le garde-fou d'auto-verrouillage, vu depuis l'écran ───
  const moi = page.getByRole('row', { name: new RegExp(E2E_OPERATOR.email) })
  await moi.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Modifier les rôles' }).click()
  await page.getByRole('checkbox', { name: 'super_admin' }).click()
  await page.getByRole('button', { name: 'Enregistrer les rôles' }).click()

  // Le refus vient du serveur et s'affiche **en bandeau** : il cite la clé entre guillemets, forme
  // sur laquelle `assertToastText` lève. Un écran qui l'aurait envoyée en toast aurait planté ici.
  await expect(page.getByRole('alert')).toContainText('operators:manage')

  // Et le rôle est toujours là : la transaction a été annulée, pas seulement l'affichage.
  await page.reload()
  await expect(page.getByRole('row', { name: new RegExp(E2E_OPERATOR.email) })).toContainText(
    'super_admin',
  )

  // ─── Les rôles : l'aperçu d'impact, et ce qui ne se supprime pas ───
  await page.getByRole('link', { name: 'Rôles' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rôles')

  const auditor = page.getByRole('row', { name: /auditor/ })
  await expect(auditor).toContainText('Livré avec le produit')
  await auditor.getByRole('button', { name: 'Actions' }).click()
  // Interdit, désactivé **et expliqué** — jamais un bouton grisé sans raison.
  await expect(
    page.getByRole('menuitem', { name: 'Supprimer — rôle livré avec le produit' }),
  ).toBeDisabled()

  await page.getByRole('menuitem', { name: 'Modifier le paquet' }).click()
  // Le nom d'un rôle livré est inerte : le seed le réinsérerait sous son ancien nom au déploiement
  // suivant.
  await expect(page.getByLabel('Nom du rôle')).toBeDisabled()

  await page.getByRole('checkbox', { name: 'audit:read' }).click()

  // L'aperçu est calculé par le serveur, sur le nombre réel de porteurs. `auditor` vient d'être
  // attribué à la recrue : le chiffre annoncé est celui-là, pas zéro.
  await expect(page.getByRole('status')).toContainText('retire 1 permission(s) à 1 opérateur(s)')

  await page.getByRole('button', { name: 'Annuler' }).click()
})

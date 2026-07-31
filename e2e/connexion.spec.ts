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

test('login puis code TOTP mènent à la console', async ({ page }) => {
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
})

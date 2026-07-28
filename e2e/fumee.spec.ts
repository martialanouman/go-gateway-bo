import { expect, test } from '@playwright/test'

/**
 * Le parcours de fumée : l'application se construit, démarre, et rend.
 *
 * C'est délibérément le test le plus bête de la suite, et c'est celui qui rattrapera le plus de
 * catastrophes — un build cassé, un rendu serveur qui lève, une feuille de style absente, une route
 * qui ne se monte pas. Aucun test unitaire ne voit ces choses-là : elles n'existent qu'une fois
 * l'ensemble assemblé et servi.
 *
 * Les quatre parcours métier (§1.2 de la spec) viendront avec les écrans qu'ils traversent, pas
 * avant : un parcours e2e écrit contre une interface qui n'existe pas encore ne teste rien.
 */

test("l'application démarre et rend sa page d'accueil", async ({ page }) => {
  const erreursConsole: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') erreursConsole.push(message.text())
  })
  page.on('pageerror', (error) => erreursConsole.push(error.message))

  const response = await page.goto('/')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tableau de bord')

  // Une exception d'hydratation ne casse pas l'affichage mais rend l'application inerte : les
  // gestionnaires d'événements ne s'attachent jamais, et l'écran devient une image.
  expect(erreursConsole).toEqual([])
})

test('la page est servie en français et applique la charte', async ({ page }) => {
  await page.goto('/')

  // `lang` porte plus qu'une convention : les lecteurs d'écran choisissent leur prononciation
  // dessus (WCAG 3.1.1).
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

  // Le thème sombre de la charte est appliqué par les tokens, pas par une préférence système : la
  // charte est sombre, sans bascule.
  const fond = await page.evaluate(() =>
    getComputedStyle(document.body).getPropertyValue('background-color'),
  )
  expect(fond).toBe('rgb(12, 15, 20)')
})

test('la référence visuelle rend la charte', async ({ page }) => {
  // `/_design` n'est liée depuis aucun écran : ce test est le seul à vérifier qu'elle reste
  // atteignable une fois l'application construite et servie.
  await page.goto('/_design')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Référence visuelle')
  await expect(page.getByRole('heading', { level: 2, name: 'États' })).toBeVisible()
})

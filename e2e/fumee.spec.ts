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
  // Deux signaux, et un seul est strict. `pageerror` ne se déclenche que sur une exception non
  // rattrapée — typiquement un échec d'hydratation, qui ne casse pas l'affichage mais rend
  // l'application inerte : les gestionnaires ne s'attachent jamais et l'écran devient une image.
  // `console.error`, lui, remonte aussi ce qui ne nous appartient pas (une ressource absente, un
  // avertissement d'extension) ; l'exiger vide rendrait la suite instable pour rien.
  const exceptions: string[] = []
  page.on('pageerror', (error) => exceptions.push(error.message))

  const response = await page.goto('/')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tableau de bord')

  // L'hydratation n'est pas terminée au rendu du titre — il vient du serveur. On attend que React
  // ait pris la main avant de conclure qu'aucune exception n'est survenue.
  await page.waitForFunction(() => document.readyState === 'complete')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  expect(exceptions).toEqual([])
})

test('la page est servie en français et applique la charte', async ({ page }) => {
  await page.goto('/')

  // `lang` porte plus qu'une convention : les lecteurs d'écran choisissent leur prononciation
  // dessus (WCAG 3.1.1).
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

  // Le thème sombre de la charte est appliqué par les tokens, pas par une préférence système : la
  // charte est sombre, sans bascule.
  //
  // On asserte la **liaison**, pas la constante : recopier `rgb(12, 15, 20)` ici ferait échouer ce
  // test au premier ajustement de la charte, avec un message qui ne dirait pas lequel des deux a
  // raison. Ce que le bout en bout peut prouver — et que l'unitaire ne peut pas — c'est que le
  // `body` est réellement câblé sur le token, une fois la feuille chargée et la cascade résolue.
  const { fond, token } = await page.evaluate(() => {
    const styles = getComputedStyle(document.body)
    const brut = styles.getPropertyValue('--surface-page').trim()

    // La valeur du token est un hexadécimal ; le fond calculé est en `rgb()`. On les compare dans
    // le même espace en laissant le navigateur faire la conversion.
    const sonde = document.createElement('div')
    sonde.style.color = brut
    document.body.append(sonde)
    const token = getComputedStyle(sonde).color
    sonde.remove()

    return { fond: styles.backgroundColor, token }
  })

  expect(fond).toBe(token)
})

test('la référence visuelle rend la charte', async ({ page }) => {
  // `/_design` n'est liée depuis aucun écran : ce test est le seul à vérifier qu'elle reste
  // atteignable une fois l'application construite et servie.
  await page.goto('/_design')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Référence visuelle')

  // `exact: true` — sans lui, Playwright cherche une **sous-chaîne** insensible à la casse, et
  // « États » désigne aussi « Les cinq états de contenu » depuis la step-042 : deux résultats, donc
  // une violation du mode strict. Le test échouait pour une ambiguïté, pas pour une régression.
  await expect(page.getByRole('heading', { level: 2, name: 'États', exact: true })).toBeVisible()

  // Les cinq états de contenu, livrés en step-042 : c'est la page qui fait foi sur leur copie.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Les cinq états de contenu' }),
  ).toBeVisible()
  await expect(page.getByText('Facturation — module désactivé sur la passerelle')).toBeVisible()
})

import { expect, test } from '@playwright/test'
import { totpCodeAt } from '../src/server/auth/mfa-totp'
import { E2E_OPERATOR } from './global-setup'
import { resetMfaFactors } from './reset-mfa'

/**
 * **Le parcours qui justifie la step-028**, et le seul qui n'appelle aucune route à la main.
 *
 * Les autres fichiers de bout en bout enrôlent par l'API avant de cliquer, parce qu'ils testent
 * autre chose. Celui-ci part de l'état réel d'une installation neuve — un administrateur amorcé
 * **sans aucun second facteur** — et n'utilise que ce qu'un opérateur a sous la main : le clavier et
 * la souris.
 *
 * C'est la propriété que la step existe pour établir. Avant elle, ce parcours s'arrêtait au
 * challenge : ni passkey ni application, et aucun moyen d'en obtenir. Si ce fichier redevient rouge,
 * le produit est de nouveau inaccessible à une installation neuve — ce qu'aucun test unitaire ne
 * peut dire, puisque chacun amorce son propre état.
 */
test.describe.configure({ mode: 'serial' })

test.beforeAll(resetMfaFactors)

test('un administrateur neuf enrôle son facteur et entre, sans jamais appeler l’API', async ({
  page,
}) => {
  // ─── Connexion ───
  await page.goto('/trafic')
  await expect(page).toHaveURL(/\/connexion$/)

  await page.getByLabel(/Adresse e-mail/).fill(E2E_OPERATOR.email)
  await page.getByLabel(/Mot de passe/).fill(E2E_OPERATOR.password)
  await page.getByRole('button', { name: /Continuer/ }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vérification en deux étapes')

  // ─── Le cul-de-sac est une porte ───
  // C'est le lien que la step-026 ne pouvait pas encore offrir.
  await page.getByRole('link', { name: /posez-en un maintenant/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Second facteur')

  // ─── Enrôlement TOTP ───
  await page.getByRole('button', { name: /Préparer/ }).click()

  // Le QR est rendu en SVG inline : il porte son titre accessible, et rien ne part sur le réseau.
  await expect(page.getByRole('img', { name: /QR code/i })).toBeVisible()

  // La clé de secours est affichée en clair, une seule fois — c'est ce qu'un opérateur recopie quand
  // son appareil ne peut pas scanner. Le test la lit au même endroit que lui.
  const secret = (await page.locator('.ui-enroll__secret code').innerText()).trim()
  expect(secret.length).toBeGreaterThan(0)

  await page.getByLabel(/Code à 6 chiffres/).fill(await totpCodeAt(secret, new Date()))
  await page.getByRole('button', { name: /^Confirmer/ }).click()

  // ─── Les codes de récupération, une fois ───
  const codes = page.locator('.ui-enroll__codes code')
  await expect(codes.first()).toBeVisible()
  expect(await codes.count()).toBeGreaterThan(0)

  // Aucune sortie tant que l'accusé n'est pas coché : ces codes ne seront jamais réaffichés.
  const leave = page.getByRole('button', { name: /Continuer vers la console/ })
  await expect(leave).toHaveAttribute('aria-disabled', 'true')

  await page
    .getByRole('checkbox', { name: /J’ai noté ces codes/ })
    .first()
    .click()
  await leave.click()

  // ─── La console ───
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()

  // Et le retour arrière ne rend pas les codes : ils n'ont jamais été ailleurs que dans un état
  // local, détruit avec le composant. C'est l'invariant (b) observé dans un vrai navigateur.
  await page.goBack()
  await expect(page.locator('.ui-enroll__codes')).toHaveCount(0)
})

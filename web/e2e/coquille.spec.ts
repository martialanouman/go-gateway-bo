import { expect, test } from '@playwright/test'

/**
 * Le seul parcours de M0, et il tourne contre le **binaire**. Ce qu'il prouve que rien d'autre ne
 * prouve : le bundle **embarqué dans le déployable** démarre dans un vrai navigateur. Les scénarios
 * `godog` exercent déjà le binaire, mais ils lisent ce qu'il sert sans jamais exécuter le JavaScript ;
 * le job « Build client et déployable » compare des octets. Aucun des deux ne verrait une application
 * servie intacte et incapable de se monter.
 *
 * Mesuré le 03/08/2026, et c'est ce qui fixe le partage : l'asset embarqué remplacé par un `throw`,
 * puis le binaire recompilé — la première assertion passe (le document servi est correct) et les
 * suivantes tombent, « element(s) not found ». C'est exactement le défaut qu'aucune autre porte ne
 * voit.
 *
 * Les quatre autres parcours de `plan.md` §17.4 arrivent chacun avec la step qui livre son écran.
 *
 * Ce que ce parcours n'observe pas : le contenu servi par `/api` ni l'ordonnancement du fallback SPA,
 * tenus par les scénarios `godog` ; ni l'égalité octet à octet entre ce que le binaire rend et la
 * sortie de Vite, tenue par le job « Build client et déployable ».
 */
test("le binaire sert la coquille peinte, puis l'application la remplace", async ({
  page,
  request,
}) => {
  // Étant donné le document que le binaire sert, avant qu'aucun script ne s'exécute — c'est la
  // requête brute, pas celle du navigateur, qui montre ce qui part sur le fil.
  const served = await request.get('/')
  expect(served.ok()).toBe(true)
  expect(await served.text()).toContain('data-skeleton="rail"')

  // Quand un opérateur ouvre l'application
  await page.goto('/')

  // Alors le squelette cède la place à l'écran, et la coquille reste autour.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Le cockpit d'exploitation se construit",
  )
  await expect(page.locator('[data-skeleton="rail"]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()
})

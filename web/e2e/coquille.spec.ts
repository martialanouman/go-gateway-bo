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
 * `plan.md` §17.4 pose « cinq parcours seulement » — un plafond, jamais une liste : ni lui ni la
 * spécification n'en énumèrent un seul. Les suivants arriveront donc avec la step qui livre leur
 * écran, et c'est elle qui les nommera ; les quatre restants ne sont pour l'instant qu'un budget.
 *
 * Ce que ce parcours n'observe pas : le contenu servi par `/api` ni l'ordonnancement du fallback SPA,
 * tenus par les scénarios `godog` ; ni l'égalité octet à octet entre ce que le binaire rend et la
 * sortie de Vite, tenue par le job « Build client et déployable ».
 */
test("le binaire sert la coquille peinte, puis l'application la remplace", async ({
  page,
  request,
}) => {
  // Les écouteurs sont posés **avant** le premier `goto`, sinon les requêtes du chargement initial —
  // celles qui portent justement la feuille et les polices — échapperaient à l'observation.
  const requested: string[] = []
  const problems: string[] = []
  page.on('request', (r) => requested.push(r.url()))
  page.on('requestfailed', (r) => problems.push(`requête échouée : ${r.url()}`))
  page.on('pageerror', (error) => problems.push(`exception : ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console : ${message.text()}`)
  })

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

  // Et le navigateur n'est sorti nulle part. C'est la moitié « vérifiée sur le binaire » de la DoD de
  // step-008 : la charte est servie par le déployable, jamais par un tiers. Le test de bundle attrape
  // déjà une adresse écrite en dur dans les sources ; lui seul ne dit rien de ce qu'un navigateur
  // demande réellement — un `@import` résolu à l'exécution ne laisse aucune trace dans le bundle.
  const origin = new URL(page.url()).origin
  expect(requested.filter((url) => !url.startsWith(origin))).toEqual([])

  // Un plancher, sans quoi « aucune police tierce » serait vrai en n'ayant chargé aucune police :
  // l'assertion ci-dessus passe tout aussi bien si les `@font-face` ont disparu de la feuille.
  expect(
    requested.filter((url) => url.endsWith('.woff2')),
    "aucune police n'a été chargée : la charte n'est pas servie",
  ).not.toHaveLength(0)

  // Et la référence visuelle est atteignable **sur le binaire**, pas seulement dans un routeur monté
  // en mémoire par un test de composant. C'est ce que la DoD appelle traverser le chemin pour de
  // bon : rien de simulé, le vrai déployable, le vrai fallback SPA sur une URL profonde. La v1.0
  // avait trois défauts que seul ce genre de traversée avait trouvés.
  await page.goto('/_design')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Référence visuelle')
  // Hors de la coquille : elle ne s'adresse pas à un opérateur.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0)
  // Et elle rend la charte pour de vrai — la police, pas un repli système. `getComputedStyle` dans
  // Chromium résout les `var()` et les `color-mix()`, ce que jsdom ne fait pas : c'est le seul
  // endroit de la suite où l'on lit ce qui est **réellement peint**.
  await expect(page.locator('h1')).toHaveCSS('font-family', /IBM Plex Sans/)

  expect(problems).toEqual([])
})

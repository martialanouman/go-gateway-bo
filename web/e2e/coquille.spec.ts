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

  // ── Les primitives, peintes pour de bon (step-041) ──────────────────────────────────────────
  //
  // Ce bloc prolonge le parcours plutôt que d'ouvrir un fichier : les primitives n'ont pas d'écran
  // à elles, et ce qu'il faut vérifier — ce qui est **réellement peint** — n'existe qu'ici. Trois
  // propriétés tiennent à des `var()` et des `color-mix()` que jsdom ne résout pas, donc qu'aucun
  // test de composant ne peut observer, quoi qu'il affirme.

  // **L'anneau de focus, WCAG 2.4.7.** Les tests de composant vérifient qu'un contrôle *reçoit* le
  // focus ; aucun ne peut dire qu'il se **voit**. step-008 a mesuré le contraire du confort : retirer
  // l'import qui porte `:focus-visible` laissait 137 tests verts et le build à rc=0.
  const button = page.getByRole('button', { name: 'Nouveau client' })
  await button.focus()
  await expect(button).toBeFocused()
  const ring = await button.evaluate((element) => getComputedStyle(element).boxShadow)
  expect(ring, 'le bouton focalisé ne porte aucun anneau visible').not.toBe('none')
  // Deux couches, et non une ombre quelconque : le repli couleur page puis l'anneau teal, sans quoi
  // l'anneau se confondrait avec la surface sur laquelle il est posé.
  expect(ring.match(/rgb/g) ?? [], "l'anneau n'a pas ses deux couches").toHaveLength(2)

  // **La chasse tabulaire de la table.** Le raccourci `font:` des rôles typographiques réinitialise
  // `font-variant-numeric`, donc défait ce que `body` posait : une colonne de nombres perd sa chasse
  // commune et danse à chaque rafraîchissement. C'est la seule lecture possible de cette propriété —
  // elle est calculée, jamais présente dans le DOM.
  await expect(page.locator('.ui-table').first()).toHaveCSS('font-variant-numeric', 'tabular-nums')

  // **Un contrôle interdit reste visible et atteignable.** « Désactivé et expliqué, jamais masqué. »
  const blocked = page.getByRole('button', { name: 'Effectuer la rotation' })
  await expect(blocked).toBeVisible()
  await expect(blocked).toHaveAttribute('aria-disabled', 'true')
  await blocked.focus()
  await expect(blocked).toBeFocused()

  // **L'astérisque du champ requis**, qui n'est pas une prop mais une conséquence de l'état du
  // contrôle — donc invisible à jsdom, qui n'applique pas le CSS. C'est ici qu'on vérifie que le
  // `:has()` trouve sa cible, et que la marque n'est pas annoncée.
  const required = await page
    .locator('.ui-field:has(.ui-input:required) .ui-field__label')
    .first()
    .evaluate((element) => getComputedStyle(element, '::after').content)
  expect(required, 'le champ requis ne porte pas sa marque').toContain('*')

  // **Les deux formes de statut ne se confondent pas**, et c'est la règle la plus stricte du
  // système : un disjoncteur ouvert sur un lien vivant et un bind mort demandent des actions
  // opposées. Sur la page, les deux sont côte à côte ; la pilule n'emprunte jamais le point.
  //
  // Compter les pilules serait compter la page, pas la règle : la première rédaction attendait une
  // `half_open` et en a trouvé deux — la rangée de spécimens et la ligne MTN de la table. Ce qui se
  // vérifie ici est la **séparation**, dans les deux sens, sur toutes les occurrences.
  const breakers = await page.locator('.ui-breaker').count()
  const dots = await page.locator('.ui-status .ui-dot').count()
  expect(
    breakers,
    'aucune pilule de disjoncteur sur la page : la règle ne garde rien',
  ).toBeGreaterThan(0)
  expect(dots, 'aucun point de lien sur la page : la règle ne garde rien').toBeGreaterThan(0)
  expect(
    await page.locator('.ui-breaker .ui-dot').count(),
    'une pilule de disjoncteur a emprunté le rendu du lien',
  ).toBe(0)
  expect(
    await page.locator('.ui-status .ui-breaker').count(),
    'un point de lien a emprunté le rendu du disjoncteur',
  ).toBe(0)

  expect(problems).toEqual([])
})

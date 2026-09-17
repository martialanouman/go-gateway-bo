import { expect, test } from '@playwright/test'

/**
 * Le seul parcours du dépôt — né en M0, étendu à la coquille de M2 par step-040 — et il tourne contre
 * le **binaire**. Ce qu'il prouve que rien d'autre ne prouve : le bundle **embarqué dans le
 * déployable** démarre dans un vrai navigateur. Les scénarios
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
    if (message.type() !== 'error') return
    // Le seul refus attendu : la coquille lit la session avant la connexion.
    if (message.location().url.endsWith('/api/auth/me') && message.text().includes('401')) return
    problems.push(`console : ${message.text()}`)
  })

  // Étant donné le document que le binaire sert, avant qu'aucun script ne s'exécute — c'est la
  // requête brute, pas celle du navigateur, qui montre ce qui part sur le fil.
  const served = await request.get('/')
  expect(served.ok()).toBe(true)
  expect(await served.text()).toContain('data-skeleton="rail"')

  // Quand un opérateur ouvre l'application sans session
  await page.goto('/')

  // Alors le squelette cède la place à un état qui nomme l'écran à venir — step-027 n'est pas livrée
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aucune session ouverte')
  await expect(page.getByText(/step-027/)).toBeVisible()
  await expect(page.locator('[data-skeleton="rail"]')).toHaveCount(0)

  // Étant donné une session ouverte par l'API, **depuis la page** : c'est le navigateur qui range le
  // cookie, avec ses propres règles, et non le client de requêtes de Playwright.
  const status = await page.evaluate(
    async (credentials) =>
      (
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        })
      ).status,
    {
      email: fromEnv('DASHBOARD_E2E_OPERATOR_EMAIL'),
      password: fromEnv('DASHBOARD_E2E_OPERATOR_PASSWORD'),
    },
  )
  expect(status).toBe(200)

  // Alors l'AppShell remplace l'état, et nomme l'opérateur
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Le cockpit d'exploitation se construit",
  )
  const nav = page.getByRole('navigation', { name: 'Navigation principale' })
  await expect(nav).toBeVisible()
  await expect(page.getByRole('banner')).toContainText(fromEnv('DASHBOARD_E2E_OPERATOR_NAME'))

  // Et une entrée du rail mène à un état vide qui nomme son jalon
  const routes = nav.getByRole('link', { name: 'Routes' })
  await routes.click()
  await expect(page).toHaveURL(/\/routes$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Routes')
  await expect(page.getByText(/jalon M6 /)).toBeVisible()

  // L'entrée active peint le token que `CONTRAST_PAIRS` juge — résolu par le navigateur, pas recopié.
  await expect(routes).toHaveAttribute('aria-current', 'page')
  const actif = await page.evaluate(() => {
    const sonde = document.createElement('span')
    sonde.style.color = 'var(--action-primary-fg)'
    document.body.append(sonde)
    const resolu = getComputedStyle(sonde).color
    sonde.remove()
    return resolu
  })
  await expect(routes).toHaveCSS('color', actif)

  // Et une adresse profonde s'ouvre sur le binaire, fallback SPA compris
  await page.goto('/billing')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Soldes & crédits')

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
  // focus ; aucun ne peut dire qu'il se **voit**. Mesuré deux fois plutôt que supposé : step-008 en
  // retirant l'import qui porte `:focus-visible` — 137 tests verts, build rc=0 — et step-041 en
  // retirant la déclaration elle-même — 214 tests verts, build rc=0. Seule cette ligne-ci rougit.
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

  // **Le bouton destructif change de token de texte au survol.** `--action-danger-fg` est
  // `--red-500` : il tient sur une surface nue et **tombe à 4,05 sur sa propre teinte**, la
  // combinaison que le survol peint. `design-tokens.ts` juge le ratio de la paire ; cette ligne-ci
  // vérifie que la feuille peint bien ce token-là, sans quoi la table décrirait une intention.
  //
  // Le token est résolu **par le navigateur** plutôt que recopié en `rgb(…)` : une valeur écrite ici
  // et une valeur écrite dans `colors.css` sont deux recopies de la même main, qui se confirment
  // l'une l'autre sans rien mesurer.
  const danger = page.getByRole('button', { name: 'Déconnecter la session' })
  const attendu = await page.evaluate(() => {
    const sonde = document.createElement('span')
    sonde.style.color = 'var(--text-danger-on-tint)'
    document.body.append(sonde)
    const resolu = getComputedStyle(sonde).color
    sonde.remove()
    return resolu
  })
  const auRepos = await danger.evaluate((element) => getComputedStyle(element).color)
  await danger.hover()
  await expect(danger).toHaveCSS('color', attendu)
  expect(auRepos, 'le repos et le survol peignent déjà la même couleur').not.toBe(attendu)

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
  // `'"*" / ""'` et non `toContain('*')` : c'est le ` / ""` — le texte de remplacement **vide** —
  // qui empêche le lecteur d'écran d'annoncer « étoile » sur chaque libellé de champ requis. Mesuré
  // en le retirant : `toContain('*')` passait, et le commentaire du CSS affirmait le contraire de ce
  // que le parcours mesurait.
  expect(required, "le champ requis ne porte pas sa marque, ou l'annonce").toBe('"*" / ""')

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

  // ── Les surfaces flottantes et les états, peints pour de bon (step-042) ─────────────────────
  //
  // Même raison que le bloc précédent, et quatre propriétés de plus qu'aucun test de composant ne
  // peut observer : jsdom n'applique aucun CSS, n'a pas d'ordre de tabulation réel, et ne connaît
  // ni `prefers-reduced-motion` ni `backdrop-filter`.

  // **Le voile ne floute pas.** La charte tranche — « blurring live metrics behind a dialog costs
  // more than it gives » —, et `--scrim-blur` reste donc déclaré sans consommateur. Un test de
  // composant ne peut rien en dire : la propriété n'existe qu'une fois la règle appliquée.
  await page.getByRole('button', { name: 'Ouvrir la modale' }).click()
  const dialog = page.getByRole('dialog', { name: 'Déconnecter la session ?' })
  await expect(dialog).toBeVisible()

  const scrim = page.locator('.ui-scrim')
  await expect(scrim).toHaveCSS('backdrop-filter', 'none')
  await expect(scrim).toHaveCSS('background-color', 'rgba(6, 8, 11, 0.72)')

  // **Le piège du focus, et c'est ici qu'il se mesure.** jsdom n'a ni ordre de tabulation réel, ni
  // `inert`, ni visibilité calculée : y « vérifier » un piège donnerait un vert qui ne prouve rien.
  // On tabule plus de fois qu'il n'y a de contrôles dans la modale, et le focus doit y rester.
  //
  // La lecture attend, parce que le piège passe **hors** de la modale : Base UI pose ses gardes de
  // focus à côté du popup, et une garde atteinte par `Tab` ne rend le focus qu'à l'image suivante
  // (`enqueueFocus`, par `requestAnimationFrame`). Lue aussitôt, elle a rougi deux fois en CI sur un
  // piège intact. Une vraie fuite ne revient pas, et l'attente expire.
  const focusIsInModal = () =>
    page.evaluate(() => document.activeElement?.closest('.ui-modal') !== null)
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab')
    await expect
      .poll(focusIsInModal, 'le focus est sorti de la modale : le piège ne tient pas')
      .toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // **La source du toast, résolue par le navigateur.** Le token est lu à l'exécution plutôt que
  // recopié en `rgb(…)` : deux recopies de la même main se confirment l'une l'autre sans rien
  // mesurer, et c'est le piège qu'une revue de step-041 avait trouvé sur l'anneau de focus.
  await page.getByRole('button', { name: 'Toast · alertmanager' }).click()
  await page.getByRole('button', { name: 'Toast · bff' }).click()

  const couleursDeSource = await page.evaluate(() =>
    (['--source-alertmanager', '--source-bff'] as const).map((token) => {
      const sonde = document.createElement('span')
      sonde.style.color = `var(${token})`
      document.body.append(sonde)
      const peint = getComputedStyle(sonde).color
      sonde.remove()
      return peint
    }),
  )

  await expect(page.locator('.ui-toast__source--alertmanager')).toHaveCSS(
    'color',
    couleursDeSource[0] ?? '',
  )
  await expect(page.locator('.ui-toast__source--bff')).toHaveCSS('color', couleursDeSource[1] ?? '')
  expect(couleursDeSource[0], 'les deux étages se peignent de la même couleur').not.toBe(
    couleursDeSource[1],
  )

  // **Le plafond plafonne à l'écran.** Base UI marque les excédentaires `data-limited` sans cesser
  // de les rendre : c'est la règle `display: none` qui les retire, et le test Vitest ne peut que
  // constater le marquage. Mesuré : remplacer cette règle par une opacité y laisse tout vert.
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: 'Toast · bff' }).click()
  }
  await expect(page.locator('.ui-toast:visible')).toHaveCount(3)

  // **`prefers-reduced-motion` coupe le scintillement — vérifié, pas déclaré.** La règle vit dans
  // `tokens/base.css`, sur `*`, et aucune feuille de composant ne la redit. Sa disparition ne se
  // verrait donc nulle part ailleurs.
  //
  // La durée est comparée en **secondes**, jamais en chaîne : Chromium rend `0.01ms` sous la forme
  // `1e-05s`, et recopier cette sortie dans l'assertion ne vérifierait que ma propre recopie.
  const squelette = page.locator('.ui-skeleton').first()
  const dureeAnimation = () =>
    squelette.evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration))

  expect(await dureeAnimation(), 'le squelette ne bat pas au rythme de la charte').toBeCloseTo(1.4)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await dureeAnimation(), 'le mouvement réduit ne coupe pas le scintillement').toBeLessThan(
    0.001,
  )
  await page.emulateMedia({ reducedMotion: null })

  expect(problems).toEqual([])
})

function fromEnv(name: string) {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} est vide : les parcours se lancent par make e2e, qui sème le compte`)
  return value
}

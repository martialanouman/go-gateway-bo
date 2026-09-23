import { createHmac } from 'node:crypto'
import { expect, type Request, test } from '@playwright/test'

/**
 * Le seul parcours du dépôt, et il tourne contre le **binaire**. Ce qu'il prouve que rien d'autre ne
 * prouve : le bundle **embarqué dans le déployable** démarre dans un vrai navigateur. Les scénarios
 * `godog` exercent déjà le binaire, mais lisent ce qu'il sert sans jamais exécuter le JavaScript ; le
 * job « Build client et déployable » compare des octets. Aucun des deux ne verrait une application
 * servie intacte et incapable de se monter — mesuré en remplaçant l'asset embarqué par un `throw` :
 * la première assertion passe, les suivantes tombent sur « element(s) not found ».
 *
 * `plan.md` §17.4 pose « cinq parcours seulement » — un plafond, jamais une liste : ni lui ni la
 * spécification n'en énumèrent un seul. Les suivants arriveront avec la step qui livre leur écran.
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
  // Une requête qui a **reçu sa réponse** n'a pas échoué, quoi que Chromium en dise ensuite. Le cas
  // est celui des `204` du produit — `/auth/logout`, `/auth/mfa/verify` : leur corps est vide, rien
  // ne le lit, et la navigation qui suit le succès fait marquer la requête `net::ERR_ABORTED`. Le
  // croisement garde l'observation utile là où un filtre sur `ERR_ABORTED` l'aurait aveuglée : une
  // requête réellement perdue n'a, elle, jamais de réponse.
  const answered = new WeakSet<Request>()
  page.on('response', (response) => {
    if (response.ok()) answered.add(response.request())
  })
  page.on('requestfailed', (r) => {
    if (answered.has(r)) return
    problems.push(`requête échouée : ${r.url()} — ${r.failure()?.errorText ?? '?'}`)
  })
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

  // ── La porte d'entrée ───────────────────────────────────────────────────────────────────────

  // Quand un opérateur ouvre l'application sans session, la garde de route s'exécute **sur une URL
  // collée**, au chargement à froid : c'est le cas que la v1.0 ne traitait pas pendant que trois
  // tests la déclaraient verte, et qu'aucun test de composant ne peut voir.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion')
  // Hors de la coquille : le squelette du rail a bien cédé, et rien ne l'a remplacé.
  await expect(page.locator('[data-skeleton="rail"]')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0)

  // Et une **adresse profonde** collée sans session garde sa destination, plutôt que de la perdre
  // au passage par la connexion.
  await page.goto('/billing')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fbilling$/)

  // ── Le premier facteur, puis un compte sans second facteur ──────────────────────────────────

  const signIn = async () => {
    await page.getByLabel(/E-mail/).fill(fromEnv('DASHBOARD_E2E_OPERATOR_EMAIL'))
    await page.getByLabel('Mot de passe').fill(fromEnv('DASHBOARD_E2E_OPERATOR_PASSWORD'))
    await page.getByRole('button', { name: 'Se connecter' }).click()
  }

  await signIn()

  // Le compte semé n'a **aucun** second facteur, et `POST /auth/login` rend un challenge sans
  // regarder ce qui est enrôlé : le cas se découvre donc ici. L'envoyer au challenge serait
  // l'envoyer à un refus certain ; la garde le conduit à l'enrôlement.
  await expect(page).toHaveURL(/\/enroll/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enrôler un second facteur')

  // ── Le préfixe `__Host-`, appliqué par un vrai navigateur ───────────────────────────────────
  //
  // La dette de step-022 se solde ici. Son harnais portait ses cookies à la main et « accepterait
  // n'importe quel nom » ; seul un navigateur applique le préfixe — il **refuse** un cookie
  // `__Host-` porteur d'un `Domain`, d'un `Path` autre que `/`, ou servi sans `Secure`. Qu'une
  // session ait vécu ci-dessus le prouve déjà ; ces lignes nomment ce qui casserait.
  const stored = await page.context().cookies()
  const session = stored.find((cookie) => cookie.name.startsWith('__Host-'))
  expect(
    session,
    'aucun cookie `__Host-` retenu : le navigateur a refusé ce que le BFF a posé',
  ).toBeDefined()
  expect(session?.path, '`__Host-` exige `Path=/`').toBe('/')
  expect(session?.secure, '`__Host-` exige `Secure`').toBe(true)
  expect(session?.httpOnly, 'le script ne doit pas lire la session (invariant b)').toBe(true)

  // Et ce n'est pas un cul-de-sac : la sortie ramène à la connexion.
  await page.getByRole('button', { name: 'Recommencer la connexion' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // ── Le parcours du premier administrateur, jusqu'à la console ───────────────────────────────
  //
  // Plus aucun décor d'API ici : c'est l'écran de step-028 qui enrôle, et le secret est lu **sur
  // l'écran** comme un opérateur le lirait. C'est la seule façon de prouver que ce QR et cette clé
  // mènent quelque part.

  // Une adresse profonde, sans session, et cette fois le parcours va jusqu'au bout : connexion,
  // second facteur, **et la destination demandée rejouée**.
  await page.goto('/billing')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fbilling$/)

  // Lu **sur le fil**, puisque c'est la seule façon d'en connaître la valeur : le produit ne
  // l'expose nulle part, ce qui est précisément ce qu'on vérifie plus bas.
  let challenge = ''
  page.on('response', async (response) => {
    if (!response.url().endsWith('/api/auth/login') || !response.ok()) return
    challenge = ((await response.json()) as { challenge: string }).challenge
  })

  await signIn()

  // L'enrôlement, en gardant la destination demandée à travers les deux écrans.
  await expect(page).toHaveURL(/\/enroll\?redirect=%2Fbilling$/)
  await page.getByRole('button', { name: 'Configurer une application d’authentification' }).click()

  // **Le QR est peint, pas seulement monté.** C'est la seule lecture possible du défaut de la
  // v1.0 : `qrcode.react` émet deux chemins, le fond puis les modules, et la règle qui les visait
  // tous les deux rendait un carré uni que le parcours d'alors déclarait « visible ». jsdom
  // n'applique aucun CSS, donc aucun test de composant ne peut voir cette couleur-là.
  const couches = page.locator('.auth__qr path')
  await expect(couches).toHaveCount(2)
  const [fond, modules] = await couches.evaluateAll((chemins) =>
    chemins.map((chemin) => getComputedStyle(chemin).fill),
  )
  expect(fond, 'le fond et les modules du QR se peignent de la même couleur').not.toBe(modules)

  // Et la vignette porte bien le token clair — la seule surface du produit qui ne suit pas le
  // thème sombre. Résolu par le navigateur plutôt que recopié : deux recopies de la même main se
  // confirment l'une l'autre sans rien mesurer.
  const papier = await page.evaluate(() => {
    const sonde = document.createElement('span')
    sonde.style.color = 'var(--qr-paper)'
    document.body.append(sonde)
    const resolu = getComputedStyle(sonde).color
    sonde.remove()
    return resolu
  })
  await expect(page.locator('.auth__qr')).toHaveCSS('background-color', papier)
  // Dessiné à sa taille, et non laissé aux 128 px du défaut.
  await expect(page.locator('.auth__qr svg')).toHaveCSS('width', '200px')

  // La clé, lue à l'écran comme sur un poste sans caméra.
  const secret = (await page.locator('.auth__secret').innerText()).trim()
  expect(secret, 'la clé d’enrôlement n’est pas affichée').not.toBe('')

  // **Rien des codes de récupération à ce stade.** Les montrer avant que le facteur ait fait ses
  // preuves, c'est les faire enregistrer pour un authentificateur qui ne marchera peut-être jamais.
  await expect(page.locator('.auth__codes')).toHaveCount(0)

  // Le premier code, saisi sur cet écran-ci : c'est lui qui confirme l'enrôlement.
  await page.getByLabel(/Code à six chiffres/).fill(totpCode(secret))
  await page.getByRole('button', { name: 'Vérifier' }).click()

  // Alors seulement les dix codes paraissent, et la seule sortie est l'accusé de réception.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Codes de récupération')
  await expect(page.locator('.auth__codes li')).toHaveCount(10)
  await expect(page.getByRole('button', { name: 'Recommencer la connexion' })).toHaveCount(0)

  // **Les dix codes tiennent sur deux colonnes**, et c'est la seule propriété de cette liste qui
  // porte une décision : en une seule colonne la carte dépasse l'écran, et le rappel « Quitter cet
  // écran sans les avoir enregistrés les perd » sort du champ de vision au moment même où il sert.
  // Aucune porte ne voit les règles `.auth__` — `classes-peintes.test.ts` ne lit que les `ui-`.
  await expect(page.locator('.auth__codes')).toHaveCSS('grid-template-columns', /\S+ \S+/)

  await page.getByRole('button', { name: 'J’ai enregistré ces codes' }).click()

  // Alors la coquille s'ouvre **sur la destination demandée**, et non sur l'accueil.
  await expect(page).toHaveURL(/\/billing$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Soldes & crédits')
  const nav = page.getByRole('navigation', { name: 'Navigation principale' })
  await expect(nav).toBeVisible()
  await expect(page.getByRole('banner')).toContainText(fromEnv('DASHBOARD_E2E_OPERATOR_NAME'))

  // Le challenge n'a laissé aucune trace — et c'est **sa valeur** qu'on cherche, captée sur le fil,
  // non un mot qui y ressemblerait. Chercher la chaîne « challenge » passerait tout aussi bien sur
  // un stockage qui porte le secret sous une autre clé.
  expect(challenge, "le challenge n'a pas été observé : l'assertion ne garde rien").toBeTruthy()
  expect(page.url(), "le challenge est passé par l'URL").not.toContain(challenge)

  const storage = await page.evaluate(() =>
    JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }]),
  )
  expect(storage, 'le challenge a été déposé dans le stockage du navigateur').not.toContain(
    challenge,
  )

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Le cockpit d'exploitation se construit",
  )

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

  // Et le navigateur n'est sorti nulle part : la charte est servie par le déployable, jamais par un
  // tiers. Le test de bundle attrape une adresse écrite en dur dans les sources ; lui seul ne dit
  // rien de ce qu'un navigateur demande réellement — un `@import` résolu à l'exécution ne laisse
  // aucune trace dans le bundle.
  const origin = new URL(page.url()).origin
  expect(requested.filter((url) => !url.startsWith(origin))).toEqual([])

  // Un plancher, sans quoi « aucune police tierce » serait vrai en n'ayant chargé aucune police :
  // l'assertion ci-dessus passe tout aussi bien si les `@font-face` ont disparu de la feuille.
  expect(
    requested.filter((url) => url.endsWith('.woff2')),
    "aucune police n'a été chargée : la charte n'est pas servie",
  ).not.toHaveLength(0)

  // Et la référence visuelle est atteignable **sur le binaire**, pas seulement dans un routeur monté
  // en mémoire par un test de composant : rien de simulé, le vrai déployable, le vrai fallback SPA
  // sur une URL profonde.
  await page.goto('/_design')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Référence visuelle')
  // Hors de la coquille : elle ne s'adresse pas à un opérateur.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0)
  // Et elle rend la charte pour de vrai — la police, pas un repli système. `getComputedStyle` dans
  // Chromium résout les `var()` et les `color-mix()`, ce que jsdom ne fait pas : c'est le seul
  // endroit de la suite où l'on lit ce qui est **réellement peint**.
  await expect(page.locator('h1')).toHaveCSS('font-family', /IBM Plex Sans/)

  // ── Les primitives, peintes pour de bon ─────────────────────────────────────────────────────
  //
  // Ce bloc prolonge le parcours plutôt que d'ouvrir un fichier : les primitives n'ont pas d'écran
  // à elles, et ce qu'il faut vérifier — ce qui est **réellement peint** — n'existe qu'ici. Ces
  // propriétés tiennent à des `var()` et des `color-mix()` que jsdom ne résout pas, donc qu'aucun
  // test de composant ne peut observer, quoi qu'il affirme.

  // **L'anneau de focus, WCAG 2.4.7.** Les tests de composant vérifient qu'un contrôle *reçoit* le
  // focus ; aucun ne peut dire qu'il se **voit**. Mesuré deux fois : en retirant l'import qui porte
  // `:focus-visible`, puis la déclaration elle-même — suite verte et build rc=0 les deux fois, seule
  // cette ligne-ci rougit.
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

  // **Le marqueur porte l'optionnel, et rien d'autre.** La règle s'est inversée : un cockpit
  // demande presque tous ses champs, donc semer des astérisques fait du bruit sur la règle et du
  // silence sur l'exception. Vérifié ici et pas en test de composant parce que la disparition de la
  // marque tenait à une règle CSS — `::after` sur `:has(:required)` —, que jsdom n'applique pas.
  const marqueDuRequis = await page
    .locator('.ui-field:has(.ui-input:required) .ui-field__label')
    .first()
    .evaluate((element) => getComputedStyle(element, '::after').content)
  expect(marqueDuRequis, 'un champ requis porte encore une marque').toBe('none')

  // **Les deux formes de statut ne se confondent pas**, et c'est la règle la plus stricte du
  // système : un disjoncteur ouvert sur un lien vivant et un bind mort demandent des actions
  // opposées. Sur la page, les deux sont côte à côte ; la pilule n'emprunte jamais le point.
  //
  // Compter les pilules serait compter la page, pas la règle : ce qui se vérifie ici est la
  // **séparation**, dans les deux sens, sur toutes les occurrences.
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

  // ── Les surfaces flottantes et les états, peints pour de bon ────────────────────────────────
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
  // mesurer.
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

  // step-030 : le premier administrateur fait entrer un second opérateur, sans toucher à la base.
  await page.goto('/operators')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Opérateurs')
  await page.getByRole('button', { name: 'Nouvel opérateur' }).click()
  const creation = page.getByRole('dialog', { name: 'Nouvel opérateur' })
  const recrue = { email: 'recrue@example.test', password: 'un mot de passe de recrue' }
  await creation.getByLabel('Adresse e-mail').fill(recrue.email)
  await creation.getByLabel('Nom affiché').fill('Recrue de parcours')
  await creation.getByLabel('Mot de passe').fill(recrue.password)
  await creation.getByRole('button', { name: 'Créer l’opérateur' }).click()

  const ligne = page.getByRole('row', { name: new RegExp(recrue.email) })
  await expect(ligne).toContainText('Aucun rôle')
  await ligne.getByRole('button', { name: 'Modifier les rôles' }).click()
  const attribution = page.getByRole('dialog', { name: 'Rôles de Recrue de parcours' })
  await attribution.getByRole('checkbox', { name: /auditor/ }).check()
  await attribution.getByRole('button', { name: 'Enregistrer les rôles' }).click()
  await expect(ligne).toContainText('auditor')

  await page.getByRole('banner').getByRole('button', { name: 'Se déconnecter' }).click()
  await page.getByRole('link', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel(/E-mail/).fill(recrue.email)
  await page.getByLabel('Mot de passe').fill(recrue.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  // Il entre, et c'est l'enrôlement qui l'accueille : un compte créé n'a encore aucun facteur.
  await expect(page).toHaveURL(/\/enroll/)

  expect(problems).toEqual([])
})

/**
 * Le code TOTP attendu à cet instant, calculé **dans le test** — SHA-1, six chiffres, pas de trente
 * secondes, exactement ce que `internal/mfa/mfa.go` déclare (`digits`, `algorithm`,
 * `PeriodSeconds`). Le parcours tient le rôle du téléphone, et la clé qu'il consomme vient de
 * l'écran d'enrôlement ; `node:crypto` suffit, là où une bibliothèque de plus ne ferait que redire
 * ces quinze lignes.
 *
 * Le serveur tolère un pas d'écart (`Skew: 1`), ce qui met ce calcul à l'abri d'une frontière de
 * période franchie entre la saisie et la vérification.
 */
function totpCode(secretBase32: string) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))

  const mac = createHmac('sha1', decodeBase32(secretBase32)).update(counter).digest()
  // Troncature dynamique de la RFC 4226 §5.4 : les quatre bits de poids faible du dernier octet
  // désignent où lire les quatre octets du code.
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f
  const truncated = mac.readUInt32BE(offset) & 0x7fff_ffff

  return String(truncated % 1_000_000).padStart(6, '0')
}

function decodeBase32(input: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bytes: number[] = []
  let accumulator = 0
  let bits = 0

  for (const character of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(character)
    if (index === -1) throw new Error(`secret base32 invalide : ${character}`)

    accumulator = (accumulator << 5) | index
    bits += 5

    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >>> bits) & 0xff)
    }
  }

  return Buffer.from(bytes)
}

function fromEnv(name: string) {
  const value = process.env[name]
  if (!value)
    throw new Error(`${name} est vide : les parcours se lancent par make e2e, qui sème le compte`)
  return value
}

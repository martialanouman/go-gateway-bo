/**
 * Les routes HTTP du BFF — **la liste fait autorité**.
 *
 * ## Pourquoi un module, et pas un littéral dans `vite.config.ts`
 *
 * Parce que le test d'énumération de l'invariant (c) (`src/test/routes-gardees.test.ts`) doit
 * savoir quelles routes existent, et qu'il n'y a que deux façons de le lui dire : lui faire lire le
 * **texte** de la configuration, ou lui donner une **valeur**.
 *
 * La première a été essayée et elle est mauvaise. Une expression régulière sur `vite.config.ts` ne
 * voit pas une clé entre guillemets (`'handler':`), ni un espace avant le deux-points, ni un
 * `...SPREAD` — et surtout, elle ne le signale pas : l'entrée devient simplement invisible, donc
 * jamais vérifiée. Un test de comptage n'y change rien, puisqu'il compte avec la même expression et
 * manque les mêmes entrées des deux côtés de l'égalité. Le filet de sécurité de la step-025 se
 * serait troué au premier reformatage du fichier.
 *
 * Ici, le test importe un tableau. Le typage refuse une méthode inventée, l'orthographe ne joue plus
 * aucun rôle, et un `...spread` reste un tableau à l'exécution.
 *
 * ## Pourquoi ces routes ne sont pas sous `src/routes/`
 *
 * Une server route TanStack y vivrait — c'est le routage par fichiers qui lui donne son URL — et
 * devrait donc importer `src/server/` depuis `src/routes/`, ce que la règle de lint de l'invariant
 * (d) interdit. Nitro enregistre un handler depuis n'importe quel chemin : le fichier reste sous
 * `src/server/`, et la règle n'a besoin d'aucune exception.
 */

/** `get` et `head` ne changent rien ; les autres exigent une garde et une ligne d'audit. */
export type BffRouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export type BffRoute = {
  readonly route: string
  /** Chemin relatif à la racine du dépôt, tel que Nitro l'attend. */
  readonly handler: string
  readonly method: BffRouteMethod
}

export const BFF_ROUTES = [
  { route: '/api/auth/login', handler: './src/server/auth/http/login.ts', method: 'post' },
  { route: '/api/auth/me', handler: './src/server/auth/http/me.ts', method: 'get' },
  // Deux phases sur un même point d'entrée : sans code, l'opérateur demande un QR code ; avec un
  // code, il confirme l'enrôlement. C'est ce que décrit le §6.9 de la spécification.
  {
    route: '/api/auth/mfa/enroll',
    handler: './src/server/auth/http/mfa-enroll.ts',
    method: 'post',
  },
  {
    route: '/api/auth/mfa/verify',
    handler: './src/server/auth/http/mfa-verify.ts',
    method: 'post',
  },
  // Les passkeys demandent deux allers-retours par cérémonie — options, puis réponse signée — et
  // suivent donc le même motif à deux phases que l'enrôlement TOTP : sans réponse d'authentificateur
  // dans le corps, le point d'entrée rend des options.
  {
    route: '/api/auth/mfa/passkey/register',
    handler: './src/server/auth/http/mfa-passkey-register.ts',
    method: 'post',
  },
  {
    route: '/api/auth/mfa/passkey/verify',
    handler: './src/server/auth/http/mfa-passkey-verify.ts',
    method: 'post',
  },
  {
    route: '/api/auth/mfa/passkeys',
    handler: './src/server/auth/http/mfa-passkeys.ts',
    method: 'get',
  },
  // `post` et non `delete` : le même point d'entrée renomme et retire, selon la présence d'un nom
  // dans le corps. Deux routes pour deux gestes sur la même liste auraient dupliqué la garde de
  // session complète, qui est ce qui compte ici.
  {
    route: '/api/auth/mfa/passkeys/manage',
    handler: './src/server/auth/http/mfa-passkey-manage.ts',
    method: 'post',
  },
  // `post` et non `get` : une déconnexion est une mutation, et un `get` se déclenche depuis une
  // image ou un lien préchargé — un tiers déconnecterait un opérateur à son insu.
  { route: '/api/auth/logout', handler: './src/server/auth/http/logout.ts', method: 'post' },

  // ─── L'annuaire (step-027) ────────────────────────────────────────────────────────────────────
  // Les six premières routes de mutation **métier** du produit, donc les premières que le test
  // d'énumération de l'invariant (c) éprouve réellement : jusqu'ici, les sept routes de mutation
  // étaient les sept exemptions de l'authentification, et les assertions portaient sur une liste
  // vide.
  { route: '/api/admin/operators', handler: './src/server/admin/http/operators.ts', method: 'get' },
  {
    route: '/api/admin/operators/create',
    handler: './src/server/admin/http/operator-create.ts',
    method: 'post',
  },
  {
    route: '/api/admin/operators/update',
    handler: './src/server/admin/http/operator-update.ts',
    method: 'post',
  },
  {
    route: '/api/admin/operators/mfa-reset',
    handler: './src/server/admin/http/operator-mfa-reset.ts',
    method: 'post',
  },
  { route: '/api/admin/roles', handler: './src/server/admin/http/roles.ts', method: 'get' },
  // L'aperçu d'impact est une **lecture** : voir `parseImpactQuery` pour la raison du `get`.
  {
    route: '/api/admin/roles/impact',
    handler: './src/server/admin/http/role-impact.ts',
    method: 'get',
  },
  {
    route: '/api/admin/roles/create',
    handler: './src/server/admin/http/role-create.ts',
    method: 'post',
  },
  {
    route: '/api/admin/roles/update',
    handler: './src/server/admin/http/role-update.ts',
    method: 'post',
  },
  {
    route: '/api/admin/roles/delete',
    handler: './src/server/admin/http/role-delete.ts',
    method: 'post',
  },
] as const satisfies readonly BffRoute[]

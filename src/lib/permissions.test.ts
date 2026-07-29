import { describe, expect, it } from 'vitest'
import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
  type PermissionKey,
  permissionByKey,
} from './permissions'

describe('catalogue de permissions', () => {
  it('compte exactement 44 clés', () => {
    // Le nombre est asserté parce que le catalogue est **figé et versionné avec les livraisons**
    // (§3.1) : une clé ajoutée sans passer par le seed, la garde serveur et le tableau des rôles par
    // défaut est une permission qui existe sans rien garder. Faire échouer ce test est le rappel.
    //
    // 44 = les 40 clés du §3.1, plus les quatre ajoutées par cette step et amendées dans la spec :
    // `connectors:read/write/rebind` et `cdr:read_pii`.
    expect(PERMISSION_CATALOG).toHaveLength(44)
  })

  it("n'a aucune clé en double", () => {
    // Un doublon ne casserait rien à la lecture — `permissionByKey` rendrait la première entrée —
    // mais le seed poserait deux fois la même ligne et échouerait sur la clé primaire, en
    // production, au démarrage. Ici c'est gratuit.
    const keys = PERMISSION_CATALOG.map((entry) => entry.key)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('utilise chacune des catégories déclarées', () => {
    // **Le test qui a trouvé le trou.** La catégorie `connectors` existait dans l'enum PostgreSQL
    // depuis la step-002, et le §3.1 n'énumérait aucune clé `connectors:*` — alors que le §6.10
    // donne « lecture/écriture connecteurs » au rôle `ops` et décrit `account_manager` par
    // l'exclusion « pas de routage/connecteur ». Deux écrans entiers (step-083, step-084) auraient
    // été livrés sans rien pour les garder.
    //
    // Une catégorie sans clé est toujours ce symptôme : soit la catégorie est morte, soit des
    // permissions manquent. Les deux méritent qu'on s'arrête.
    const used = new Set(PERMISSION_CATALOG.map((entry) => entry.category))

    expect([...PERMISSION_CATEGORIES].filter((category) => !used.has(category))).toEqual([])
  })

  it('nomme ses clés en minuscules, segments séparés par deux-points', () => {
    // La clé est un identifiant technique : elle reste en anglais, en mono, et se grep dans les
    // logs. `billing:provider:write` a trois segments — la forme n'est donc pas « domaine:verbe ».
    for (const { key } of PERMISSION_CATALOG) {
      expect(key).toMatch(/^[a-z]+(:[a-z_]+){1,2}$/)
    }
  })

  it('décrit chaque clé en français, sans point final', () => {
    // La description est rendue telle quelle dans l'écran d'édition de rôle (step-027) : c'est de la
    // copie d'interface, soumise à la charte. Un libellé vide y laisserait une ligne muette en face
    // d'une case à cocher qui accorde un pouvoir.
    for (const { key, description } of PERMISSION_CATALOG) {
      expect(description.length, `description vide pour ${key}`).toBeGreaterThan(10)
      expect(description.endsWith('.'), `point final sur ${key}`).toBe(false)
      expect(description[0], `initiale non capitalisée sur ${key}`).toBe(
        description[0]?.toUpperCase(),
      )
    }
  })

  it('retrouve une entrée par sa clé, et rien pour une clé inconnue', () => {
    expect(permissionByKey('audit:read')?.category).toBe('audit')
    expect(permissionByKey('routes:raed' as PermissionKey)).toBeUndefined()
  })

  it("garde les verbes dangereux séparés du droit d'écriture ordinaire", () => {
    // Motif constant du catalogue, et la raison pour laquelle `connectors:rebind` existe séparément :
    // l'acte irréversible ou visible en production ne se fond jamais dans le `:write` qui sert à
    // corriger une configuration. Un rôle peut ainsi éditer sans pouvoir déclencher.
    const keys = new Set(PERMISSION_CATALOG.map((entry) => entry.key))

    for (const dangerous of [
      'sessions:disconnect',
      'credentials:rotate',
      'suppressions:delete',
      'scripts:publish',
      'billing:scope_change',
      'connectors:rebind',
      'content:erase',
      'gdpr:erase',
      'cdr:read_pii',
    ] satisfies PermissionKey[]) {
      expect(keys.has(dangerous), `${dangerous} absente du catalogue`).toBe(true)
    }
  })

  it('conserve les 40 clés du §3.1 sans en renommer aucune', () => {
    // Le catalogue s'étend, il ne se réécrit pas : un renommage silencieux retirerait la permission
    // à tous les rôles qui la détiennent — le seed retire les clés disparues — et l'écran continuerait
    // de s'afficher, gardé par une clé que plus personne n'a. Cette liste est celle de la spec avant
    // amendement ; elle ne bouge plus.
    const keys = new Set<string>(PERMISSION_CATALOG.map((entry) => entry.key))
    const specified = [
      'routes:read',
      'routes:write',
      'routes:import',
      'scripts:read',
      'scripts:write',
      'scripts:publish',
      'sessions:read',
      'sessions:disconnect',
      'antispam:read',
      'antispam:write',
      'customers:read',
      'customers:write',
      'accounts:read',
      'accounts:write',
      'credentials:read',
      'credentials:write',
      'credentials:rotate',
      'senderrewrite:read',
      'senderrewrite:write',
      'suppressions:read',
      'suppressions:write',
      'suppressions:delete',
      'inbound:read',
      'inbound:write',
      'groups:read',
      'groups:write',
      'billing:read',
      'billing:write',
      'billing:topup',
      'billing:provider:write',
      'billing:scope_change',
      'content:read',
      'content:erase',
      'gdpr:erase',
      'cdr:export_bulk',
      'alerts:read',
      'alerts:write',
      'audit:read',
      'operators:manage',
      'roles:manage',
    ]

    expect(specified).toHaveLength(40)
    expect(specified.filter((key) => !keys.has(key))).toEqual([])
  })
})

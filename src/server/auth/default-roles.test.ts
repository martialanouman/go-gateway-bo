import { describe, expect, it } from 'vitest'
import { PERMISSION_CATALOG, type PermissionKey } from '~/lib/permissions'
import { DEFAULT_ROLES, permissionsOfDefaultRole } from './default-roles'

/** Les permissions d'un rôle par défaut, en ensemble, pour des assertions lisibles. */
function permissionsOf(name: string): Set<PermissionKey> {
  return new Set(permissionsOfDefaultRole(name))
}

describe('rôles par défaut (§6.10)', () => {
  it('en déclare exactement neuf, tous marqués par défaut', () => {
    expect(DEFAULT_ROLES.map((role) => role.name)).toEqual([
      'super_admin',
      'ops',
      'script_author',
      'support_readonly',
      'billing_admin',
      'billing_readonly',
      'account_manager',
      'compliance',
      'auditor',
    ])
  })

  it('ne référence que des clés du catalogue', () => {
    // Une clé mal orthographiée dans un paquet de rôle ne casse rien à la lecture : le rôle est
    // simplement livré amputé d'une permission, et l'écran correspondant reste inaccessible sans
    // que rien ne l'explique. Le seed échouerait sur la clé étrangère — en production, au démarrage.
    const catalog = new Set<string>(PERMISSION_CATALOG.map((entry) => entry.key))
    const unknown = DEFAULT_ROLES.flatMap((role) =>
      role.permissions.filter((key) => !catalog.has(key)).map((key) => `${role.name} → ${key}`),
    )

    expect(unknown).toEqual([])
  })

  it('ne laisse aucune clé du catalogue détenue par le seul super_admin, hors réserves justifiées', () => {
    // **Le test qui a trouvé les deux autres trous.** `alerts:read` / `alerts:write`,
    // `content:erase` et `cdr:export_bulk` n'apparaissaient dans aucune description de rôle du
    // §6.10 : seul `super_admin` les détenait, par « toutes les permissions ». Un système d'alertes
    // métier que le rôle « Exploitation réseau » ne peut ni consulter ni configurer n'a pas de sens ;
    // un effacement de contenu que la conformité ne peut pas exécuter non plus ; et le §6.4 réserve
    // l'export de masse « hors lecture seule » sans jamais dire à qui il revient.
    //
    // Une clé détenue par personne d'autre que le propriétaire est toujours l'un des trois : une
    // permission oubliée dans un paquet, une clé qui n'aurait pas dû exister, ou une réserve
    // délibérée. Les réserves sont donc nommées **ici**, avec leur motif — les laisser implicites
    // rendrait ce test muet le jour où une vraie clé orpheline apparaîtrait.
    const RESERVED_TO_OWNER = {
      // « `content:read` jamais implicite » (§6.10). Ni le support, ni la conformité ne l'ont : le
      // corps d'un message se donne à un opérateur nommé, par un rôle taillé pour lui.
      'content:read': 'jamais implicite — accordée par un rôle dédié, jamais par un paquet livré',
      // « Toutes les permissions, **y compris** `operators:manage`/`roles:manage` » (§6.10) : la
      // formule ne les distingue que parce qu'elles n'appartiennent qu'au propriétaire. Qui peut
      // éditer les rôles peut s'accorder tout le reste.
      'operators:manage': 'réservée au propriétaire — équivaut à distribuer toutes les autres',
      'roles:manage': 'réservée au propriétaire — équivaut à distribuer toutes les autres',
    } as const satisfies Partial<Record<PermissionKey, string>>

    const held = new Set<string>(
      DEFAULT_ROLES.filter((role) => role.name !== 'super_admin').flatMap(
        (role) => role.permissions,
      ),
    )

    expect(
      PERMISSION_CATALOG.map((entry) => entry.key).filter(
        (key) => !held.has(key) && !(key in RESERVED_TO_OWNER),
      ),
    ).toEqual([])

    // **Et l'assertion réciproque, sans laquelle la précédente est un piège.** Sans elle, une clé
    // réservée sortait du filtre par les deux côtés à la fois : donner `roles:manage` à `ops` — donc
    // l'escalade totale, puisque qui édite les rôles s'accorde le reste — laissait la suite entière
    // au vert. Une exemption ne doit jamais être une autorisation.
    const escalations = DEFAULT_ROLES.filter((role) => role.name !== 'super_admin').flatMap(
      (role) =>
        role.permissions
          .filter((key) => key in RESERVED_TO_OWNER)
          .map((key) => `${role.name} détient ${key}`),
    )

    expect(escalations).toEqual([])
  })

  it("confie l'export de masse de CDR à ops et compliance, jamais à un rôle de lecture seule", () => {
    // Le §6.4 exige `cdr:export_bulk` « hors lecture seule » sans nommer de détenteur. Sortir des
    // CDR en masse est un acte de gouvernance de données : il revient à l'exploitation et à la
    // conformité, pas au support ni au reporting financier.
    const holders = DEFAULT_ROLES.filter(
      (role) => role.name !== 'super_admin' && role.permissions.includes('cdr:export_bulk'),
    ).map((role) => role.name)

    expect(holders).toEqual(['ops', 'compliance'])
  })

  it('donne à super_admin le catalogue entier', () => {
    // `toEqual` sur l'ensemble, et pas une comparaison de tailles : `permissions: PERMISSION_KEYS`
    // rend une assertion de longueur tautologique, donc incapable d'échouer le jour où ce rôle sera
    // défini autrement.
    expect(permissionsOf('super_admin')).toEqual(
      new Set(PERMISSION_CATALOG.map((entry) => entry.key)),
    )
  })

  /**
   * **L'ensemble exact de chaque rôle, les neuf lignes du §6.10.**
   *
   * Les assertions ponctuelles qui suivent — « ops n'a pas `suppressions:delete` » — disent ce que la
   * spec souligne, et c'est utile à la lecture. Elles ne suffisent pas : elles ne peuvent pas voir ce
   * qu'un paquet gagne par accident. C'est arrivé pendant l'écriture de cette step — le socle
   * « toutes les clés `:read` » avait donné `audit:read` à `support_readonly` et à `billing_admin`,
   * et aucune assertion ponctuelle ne pouvait le dire.
   *
   * Une table figée coûte cher à maintenir. C'est exactement le point : élargir un rôle par défaut
   * doit demander un geste conscient dans ce fichier, jamais résulter d'un socle calculé.
   */
  const PAQUETS_ATTENDUS: Record<string, readonly PermissionKey[]> = {
    ops: [
      'alerts:read',
      'alerts:write',
      'antispam:read',
      'antispam:write',
      'audit:read',
      'billing:read',
      'cdr:export_bulk',
      'cdr:read_pii',
      'connectors:read',
      'connectors:rebind',
      'connectors:write',
      'inbound:read',
      'inbound:write',
      'routes:import',
      'routes:read',
      'routes:write',
      'scripts:publish',
      'scripts:read',
      'scripts:write',
      'senderrewrite:read',
      'senderrewrite:write',
      'sessions:disconnect',
      'sessions:read',
      'suppressions:read',
      'suppressions:write',
    ],
    script_author: ['scripts:read', 'scripts:write'],
    support_readonly: [
      'accounts:read',
      'alerts:read',
      'antispam:read',
      'billing:read',
      'cdr:read_pii',
      'connectors:read',
      'customers:read',
      'groups:read',
      'inbound:read',
      'routes:read',
      'sessions:read',
      'suppressions:read',
    ],
    billing_admin: [
      'accounts:read',
      'alerts:read',
      'antispam:read',
      'billing:provider:write',
      'billing:read',
      'billing:scope_change',
      'billing:topup',
      'billing:write',
      'connectors:read',
      'customers:read',
      'groups:read',
      'inbound:read',
      'routes:read',
      'sessions:read',
      'suppressions:read',
    ],
    billing_readonly: ['billing:read'],
    account_manager: [
      'accounts:read',
      'accounts:write',
      'billing:read',
      'billing:scope_change',
      'billing:write',
      'credentials:read',
      'credentials:rotate',
      'credentials:write',
      'customers:read',
      'customers:write',
      'groups:read',
      'groups:write',
    ],
    compliance: [
      'accounts:read',
      'cdr:export_bulk',
      'cdr:read_pii',
      'content:erase',
      'customers:read',
      'gdpr:erase',
      'inbound:read',
      'suppressions:delete',
      'suppressions:read',
      'suppressions:write',
    ],
    auditor: ['audit:read'],
  }

  for (const [name, attendu] of Object.entries(PAQUETS_ATTENDUS)) {
    it(`donne à ${name} exactement son paquet, ni plus ni moins`, () => {
      expect([...permissionsOf(name)].sort()).toEqual([...attendu].sort())
    })
  }

  // ─── Les six pièges que la step-020 impose de respecter au caractère près ────────────────────

  it('ops peut inscrire un désabonnement mais jamais le lever', () => {
    const ops = permissionsOf('ops')

    expect(ops.has('suppressions:read')).toBe(true)
    expect(ops.has('suppressions:write')).toBe(true)
    expect(ops.has('suppressions:delete')).toBe(false)
  })

  it('script_author écrit un script mais ne le publie pas', () => {
    // La publication est l'acte visible en production ; le §6.10 la réserve à une revue par
    // `ops` / `super_admin`. C'est le même motif que `connectors:rebind` face à `connectors:write`.
    const author = permissionsOf('script_author')

    expect(author.has('scripts:read')).toBe(true)
    expect(author.has('scripts:write')).toBe(true)
    expect(author.has('scripts:publish')).toBe(false)
  })

  it("support_readonly n'a jamais le corps des messages, ni les identifiants, ni le code des scripts", () => {
    // « `content:read` jamais implicite » (§6.10). Un rôle de support L1 voit la chronologie d'un
    // message, ses statuts et ses horodatages — pas ce qui a été écrit dedans.
    const support = permissionsOf('support_readonly')

    expect(support.has('content:read')).toBe(false)
    expect(support.has('credentials:read')).toBe(false)
    expect(support.has('scripts:read')).toBe(false)
    expect([...support].filter((key) => !key.endsWith(':read') && key !== 'cdr:read_pii')).toEqual(
      [],
    )
  })

  it('compliance est le seul rôle par défaut à lever un désabonnement et à effacer au titre du RGPD', () => {
    const others = DEFAULT_ROLES.filter(
      (role) => role.name !== 'super_admin' && role.name !== 'compliance',
    )

    for (const role of others) {
      expect(role.permissions, `${role.name}`).not.toContain('suppressions:delete')
      expect(role.permissions, `${role.name}`).not.toContain('gdpr:erase')
    }
    expect(permissionsOf('compliance').has('suppressions:delete')).toBe(true)
    expect(permissionsOf('compliance').has('gdpr:erase')).toBe(true)
  })

  it("compliance n'a pas le corps des messages non plus", () => {
    // Effacer un contenu ne demande pas de l'avoir lu — et le §6.10 le dit explicitement. C'est ce
    // qui sépare `content:erase`, que ce rôle détient, de `content:read`, qu'il n'a pas.
    const conformite = permissionsOf('compliance')

    expect(conformite.has('content:erase')).toBe(true)
    expect(conformite.has('content:read')).toBe(false)
  })

  it('account_manager ne recharge aucun solde et ne touche ni au routage ni aux connecteurs', () => {
    const manager = permissionsOf('account_manager')

    expect(manager.has('billing:topup')).toBe(false)
    expect(manager.has('billing:provider:write')).toBe(false)
    expect(
      [...manager].filter((key) => key.startsWith('routes:') || key.startsWith('connectors:')),
    ).toEqual([])
  })

  // ─── Les deux rôles à périmètre fermé ────────────────────────────────────────────────────────

  it('auditor ne détient que la lecture du journal', () => {
    // Sans `cdr:read_pii` : un rôle de revue corrèle une ligne d'audit avec un MSISDN masqué.
    // S'il lui en faut plus, c'est une élévation explicite — pas un droit permanent.
    expect(permissionsOf('auditor')).toEqual(new Set(['audit:read']))
  })

  it('billing_readonly ne détient que la lecture de la facturation', () => {
    expect(permissionsOf('billing_readonly')).toEqual(new Set(['billing:read']))
  })

  // ─── Les décisions prises en step-020 sur les clés ajoutées ──────────────────────────────────

  it('réserve le rebind de connecteur à ops', () => {
    for (const role of DEFAULT_ROLES) {
      if (role.name === 'super_admin' || role.name === 'ops') continue
      expect(role.permissions, `${role.name}`).not.toContain('connectors:rebind')
    }
    expect(permissionsOf('ops').has('connectors:rebind')).toBe(true)
  })

  it('ne démasque les MSISDN que pour ops, support_readonly et compliance', () => {
    const holders = DEFAULT_ROLES.filter(
      (role) => role.name !== 'super_admin' && role.permissions.includes('cdr:read_pii'),
    ).map((role) => role.name)

    expect(holders).toEqual(['ops', 'support_readonly', 'compliance'])
  })

  it('ne déclare aucune permission en double dans un même rôle', () => {
    for (const role of DEFAULT_ROLES) {
      expect(new Set(role.permissions).size, `${role.name}`).toBe(role.permissions.length)
    }
  })

  it('rend un ensemble vide pour un rôle inconnu plutôt que de lancer', () => {
    // Un rôle personnalisé (step-027) n'est pas dans cette table : demander ses permissions par ce
    // chemin doit rendre « rien », jamais tout.
    expect(permissionsOfDefaultRole('role_invente')).toEqual([])
  })
})

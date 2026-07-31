// @vitest-environment node

/**
 * Ce que les coquilles HTTP de l'annuaire délèguent ici : lire une requête, et rendre un refus.
 *
 * Les deux méritent des tests pour la même raison — ce sont les seules décisions de la frontière.
 * Un parseur trop permissif envoie une chaîne quelconque là où PostgreSQL attend un `uuid`, et le
 * refus devient une erreur 500 au lieu d'un message ; un parseur qui laisse passer une clé de
 * permission inconnue fait échouer l'insertion sur une clé étrangère, au milieu d'une transaction.
 */

import { describe, expect, it } from 'vitest'
import { PERMISSION_KEYS } from '~/lib/permissions'
import { checkAuditPayload } from '../authz/audit'
import { AUTHZ_CODES } from '../authz/permission'
import { DirectoryRuleError } from './directory-write'
import {
  auditList,
  invalidRequest,
  parseImpactQuery,
  parseNewOperator,
  parseOperatorTarget,
  parseOperatorUpdate,
  parseRoleDefinition,
  parseRoleTarget,
  parseRoleUpdate,
  refusalResponse,
  ruleResponse,
} from './http'

const UUID = '00000000-0000-7000-8000-000000000001'
const OTHER_UUID = '00000000-0000-7000-8000-000000000002'

describe('la lecture d’une création d’opérateur', () => {
  it('accepte une adresse, un nom et des rôles', () => {
    const parsed = parseNewOperator({
      email: ' nouveau@example.test ',
      displayName: ' Awa Koné ',
      roleIds: [UUID],
    })

    expect(parsed).toEqual({
      ok: true,
      email: 'nouveau@example.test',
      displayName: 'Awa Koné',
      roleIds: [UUID],
    })
  })

  it('refuse une adresse qui n’en est pas une', () => {
    expect(parseNewOperator({ email: 'awa', displayName: 'Awa', roleIds: [] }).ok).toBe(false)
  })

  it('refuse un nom vide — la colonne « nom » de l’écran serait vide', () => {
    expect(parseNewOperator({ email: 'a@b.test', displayName: '   ', roleIds: [] }).ok).toBe(false)
  })

  it('refuse un identifiant de rôle qui n’a pas la forme d’un UUID', () => {
    // Sans ce refus, la valeur atteint PostgreSQL, qui rend un `22P02` au milieu de la
    // transaction : l'opérateur verrait une panne là où il a fait une faute de frappe.
    const parsed = parseNewOperator({ email: 'a@b.test', displayName: 'A', roleIds: ['ops'] })

    expect(parsed.ok).toBe(false)
  })

  it('refuse un corps absent', () => {
    expect(parseNewOperator(undefined).ok).toBe(false)
  })
})

describe('la lecture d’une modification d’opérateur', () => {
  it('accepte un statut seul', () => {
    expect(parseOperatorUpdate({ operatorId: UUID, status: 'disabled' })).toEqual({
      ok: true,
      operatorId: UUID,
      status: 'disabled',
      roleIds: undefined,
    })
  })

  it('accepte des rôles seuls', () => {
    expect(parseOperatorUpdate({ operatorId: UUID, roleIds: [OTHER_UUID] })).toEqual({
      ok: true,
      operatorId: UUID,
      status: undefined,
      roleIds: [OTHER_UUID],
    })
  })

  it('refuse une modification qui ne modifie rien', () => {
    // Un corps sans statut ni rôles écrirait une ligne d'audit pour une action qui n'a rien fait,
    // et le journal deviendrait illisible à force de lignes vides.
    expect(parseOperatorUpdate({ operatorId: UUID }).ok).toBe(false)
  })

  it('refuse un statut inventé', () => {
    expect(parseOperatorUpdate({ operatorId: UUID, status: 'suspendu' }).ok).toBe(false)
  })

  it('lit une cible seule pour la réinitialisation du second facteur', () => {
    expect(parseOperatorTarget({ operatorId: UUID })).toEqual({ ok: true, operatorId: UUID })
    expect(parseOperatorTarget({ operatorId: 'moi' }).ok).toBe(false)
  })
})

describe('la lecture d’un rôle', () => {
  it('accepte un nom greppable et des clés du catalogue', () => {
    const parsed = parseRoleDefinition({
      name: 'support_n2',
      description: 'Support de second niveau',
      permissions: ['sessions:read', 'accounts:read', 'sessions:read'],
    })

    expect(parsed).toEqual({
      ok: true,
      name: 'support_n2',
      description: 'Support de second niveau',
      // Dédoublonné : deux fois la même clé ferait échouer l'insertion sur la clé primaire
      // composite de `role_permissions`.
      permissions: ['accounts:read', 'sessions:read'],
    })
  })

  it('refuse un nom qui ne se grep pas', () => {
    const parsed = parseRoleDefinition({
      name: 'Support N2',
      description: 'Support de second niveau',
      permissions: [],
    })

    expect(parsed.ok).toBe(false)
  })

  it('refuse une clé absente du catalogue, plutôt que de l’ignorer', () => {
    // L'ignorer silencieusement enregistrerait un rôle amputé d'une permission que l'administrateur
    // croit avoir accordée — c'est-à-dire un droit qu'il pense donné et qui ne l'est pas.
    const parsed = parseRoleDefinition({
      name: 'support_n2',
      description: 'Support',
      permissions: ['sessions:read', 'routes:raed'],
    })

    expect(parsed.ok).toBe(false)
  })

  it('exige un identifiant pour une édition, et lui seul pour une suppression', () => {
    expect(
      parseRoleUpdate({
        roleId: UUID,
        name: 'support_n2',
        description: 'Support',
        permissions: [],
      }),
    ).toMatchObject({ ok: true, roleId: UUID })

    expect(parseRoleTarget({ roleId: UUID })).toEqual({ ok: true, roleId: UUID })
    expect(parseRoleTarget({}).ok).toBe(false)
  })
})

describe('la lecture d’une demande d’aperçu', () => {
  it('lit un rôle et une liste de clés séparées par des virgules', () => {
    expect(parseImpactQuery({ role: UUID, permissions: 'audit:read,alerts:read' })).toEqual({
      ok: true,
      roleId: UUID,
      permissions: ['alerts:read', 'audit:read'],
    })
  })

  it('accepte une liste vide — retirer tout est le cas qui intéresse le plus', () => {
    expect(parseImpactQuery({ role: UUID, permissions: '' })).toEqual({
      ok: true,
      roleId: UUID,
      permissions: [],
    })
  })

  it('refuse une clé inconnue', () => {
    expect(parseImpactQuery({ role: UUID, permissions: 'audit:read,inventee' }).ok).toBe(false)
  })
})

describe('une liste de noms en valeur d’audit', () => {
  it('se recolle telle quelle tant qu’elle tient', () => {
    expect(auditList(['ops', 'auditor'])).toBe('ops,auditor')
    expect(auditList([])).toBe('')
  })

  it('cède la place au compte quand elle déborde, et le dit', async () => {
    // Le cas réel : vider le paquet de `super_admin` fait une liste de quarante-quatre clés, soit
    // près de neuf cents caractères. `checkAuditValue` la refuserait, et `mutate` annulerait une
    // action légitime en parlant d'un « champ de contrôle trop long ».
    const long = auditList(PERMISSION_KEYS)

    expect(long).toBe(`${PERMISSION_KEYS.length} entrées, trop longues pour cette ligne`)
    // Tronquer aurait rendu une ligne qui se lit comme complète sans l'être — le seul mode d'échec
    // inacceptable pour une table qui sert de preuve.
    expect(long).not.toContain('audit:read')
    // Et la valeur doit rester acceptable pour l'audit, sinon la garde ne sert à rien.
    expect(() => checkAuditPayload('after', { permissions_removed: long })).not.toThrow()
  })
})

describe('les refus', () => {
  it('rendent 401 pour une session absente et 403 pour le reste', async () => {
    const absent = refusalResponse({
      code: AUTHZ_CODES.sessionAbsent,
      message: 'Session absente.',
      errors: [],
    })
    const denied = refusalResponse({
      code: AUTHZ_CODES.denied,
      message: 'Permission absente.',
      errors: [],
    })
    const mfa = refusalResponse({
      code: AUTHZ_CODES.mfaRequired,
      message: 'Second facteur requis.',
      errors: [],
    })

    expect(absent.status).toBe(401)
    // 403 et non 401 : l'appelant **est** authentifié. Un 401 ferait renvoyer l'écran au login,
    // d'où il reviendrait avec la même session et le même refus — une boucle.
    expect(denied.status).toBe(403)
    expect(mfa.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'Permission absente.', code: 'permission_denied' })
  })

  it('rendent 409 pour une règle du produit, avec son code', async () => {
    const response = ruleResponse(
      new DirectoryRuleError('last_super_admin', 'Changement refusé : plus aucun propriétaire.'),
    )

    // 409 et non 400 : la requête est bien formée, c'est l'état de l'annuaire qui la refuse.
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Changement refusé : plus aucun propriétaire.',
      code: 'last_super_admin',
    })
  })

  it('rendent 400 pour un corps mal formé', async () => {
    const response = invalidRequest('Corps illisible.')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Corps illisible.' })
  })

  it('ne se mettent jamais en cache', () => {
    const response = ruleResponse(new DirectoryRuleError('unknown_role', 'Rôle inconnu.'))

    // Un intermédiaire qui garderait la réponse d'un administrateur la servirait à un autre, avec
    // ses opérateurs et ses rôles dedans.
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

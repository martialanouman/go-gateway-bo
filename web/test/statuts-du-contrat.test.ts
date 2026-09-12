// @vitest-environment node

/**
 * Les statuts que le produit peint sont-ils encore ceux que le contrat déclare ?
 *
 * **Le mode d'échec est daté et coûteux.** `StatusPill` recopie quatre énumérations du contrat pour
 * leur donner une tonalité. Une valeur qui manque à la table ne casse rien : elle retombe sur le
 * repli au repos, se peint en gris, et **disparaît de l'œil de l'opérateur** qui balaie la colonne à
 * la recherche des rouges. La v1.0 portait six des huit valeurs de `CdrStatus` — `accepted` et
 * `cancelled` absentes — et toutes ses portes étaient vertes.
 *
 * Un contrat qui bouge périme donc en silence une table qu'aucune porte ne regarde. Ce fichier la
 * regarde : il lit le **YAML installé**, pas une liste écrite à la main, et rougit dès qu'une valeur
 * apparaît, disparaît ou se renomme en amont. C'est exactement la forme de garde que `plan.md` §1.12
 * réclame — « une contrainte resserrée passe le typage et échoue à l'exécution ».
 *
 * Ce qu'il ne garde pas : la **tonalité** attribuée à chaque valeur, qui est un choix de la charte
 * et se teste dans `src/components/ui/status-pill.test.tsx`.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  BREAKER_STATES,
  DELIVERY_TONES,
  ENTITY_TONES,
  LINK_TONES,
} from '../src/components/ui/status-pill'

/**
 * Le contrat **résolu comme le code le résout**, et non par un chemin écrit à la main : un
 * `node_modules/…` en dur survivrait à une désinstallation du paquet et lirait un fichier fantôme.
 */
const contract = readFileSync(
  createRequire(import.meta.url).resolve(
    '@martialanouman/gateway-api-contracts/openapi-admin.yaml',
  ),
  'utf8',
)

/**
 * Les énumérations du contrat sont écrites sur une ligne — `Nom: { type: string, enum: [a, b, c] }`.
 * On extrait la première déclaration portant ce nom.
 */
function enumOf(name: string): string[] {
  const found = contract.match(new RegExp(`${name}: *\\{[^}]*enum: *\\[([^\\]]*)\\]`))
  if (found?.[1] === undefined) throw new Error(`${name} : aucune énumération dans le contrat`)

  return found[1].split(',').map((value) => value.trim())
}

describe('les statuts peints suivent le contrat', () => {
  it('sait lire une énumération — sans quoi tout ce fichier serait vert et vide', () => {
    // Le méta-test. Si la forme du YAML change et que l'extraction cesse de trouver quoi que ce
    // soit, les comparaisons ci-dessous deviendraient des égalités de listes vides. Mesuré ici sur
    // une valeur qu'on sait présente, et sur un nom qu'on sait absent.
    expect(enumOf('LinkStatus')).toContain('reconnecting')
    expect(() => enumOf('StatutQuiNExistePas')).toThrow()
  })

  it('link_status : les mêmes valeurs, ni plus ni moins', () => {
    expect(Object.keys(LINK_TONES).sort()).toEqual(enumOf('LinkStatus').sort())
  })

  it('breaker_state : les mêmes valeurs, ni plus ni moins', () => {
    expect([...BREAKER_STATES].sort()).toEqual(enumOf('BreakerState').sort())
  })

  it('CdrStatus : les mêmes valeurs, ni plus ni moins', () => {
    // Les huit, dont les deux que la v1.0 avait laissées tomber au gris.
    expect(Object.keys(DELIVERY_TONES).sort()).toEqual(enumOf('CdrStatus').sort())
  })

  it('le statut d’un client ou d’un compte SMPP : les mêmes valeurs', () => {
    // `Customer.status` et `SmppAccount.status` n'ont pas de schéma nommé : ils déclarent leur
    // énumération sur place. On les ancre donc par **nom de schéma**, et le cardinal est fixé.
    //
    // **La première rédaction filtrait les occurrences sur `includes('suspended')`** — c'est-à-dire
    // sur le contenu de ce qu'elle jugeait. Mesuré : renommer une seule des quatre en
    // `[active, paused, closed]` la faisait sortir de l'échantillon au lieu de rougir, et les cinq
    // tests restaient verts. `<StatusPill kind="entity" state="paused" />` aurait alors peint un
    // client au gris, exactement le mode d'échec que ce fichier existe pour fermer. Une porte dont
    // les cas viennent de la donnée qu'elle garde ne voit pas sa dérive.
    const PORTEURS = ['Customer', 'CustomerUpdate', 'SmppAccount', 'SmppAccountUpdate'] as const

    const attendu = Object.keys(ENTITY_TONES).sort()

    for (const schema of PORTEURS) {
      // Le bloc du schéma : de sa déclaration au premier schéma suivant, au même niveau.
      const bloc = new RegExp(`^    ${schema}:$([\\s\\S]*?)(?=^    [A-Z])`, 'm').exec(contract)?.[1]
      expect(bloc, `${schema} a disparu du contrat`).toBeDefined()

      const declaration = /status: *\{ *type: string, enum: *\[([^\]]*)\]/.exec(bloc ?? '')?.[1]
      expect(declaration, `${schema} ne déclare plus de statut sur place`).toBeDefined()

      expect(
        (declaration ?? '')
          .split(',')
          .map((value) => value.trim())
          .sort(),
        `${schema} ne porte plus le même vocabulaire que les autres entités`,
      ).toEqual(attendu)
    }
  })
})

// @vitest-environment node

/**
 * Invariant (b), côté base : `operators.password_hash` et `operators.mfa_totp_secret` ne doivent
 * jamais être lus « par accident ».
 *
 * `db.select().from(operators)` — sans argument — compile parfaitement et remonte les deux colonnes.
 * Il suffit ensuite que le résultat parte dans une réponse pour qu'un hash de mot de passe et un
 * secret TOTP quittent le serveur. Le schéma expose `operatorSafeColumns` pour cette raison, mais
 * une convention documentée n'arrête personne : ce dépôt applique ses invariants par des tests.
 *
 * Ce test est vert aujourd'hui parce qu'aucune requête ne lit encore cette table. C'est justement le
 * moment de le poser — il devient un garde-fou pour les steps M1 (opérateurs, rôles, MFA) plutôt
 * qu'une correction après coup.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Une lecture non projetée de la table des opérateurs : `select()` sans argument, suivi quelque part
 * de `from(operators)`. La projection explicite — `select({ ... })` — ne correspond pas.
 */
const UNPROJECTED_READ = /\.select(?:Distinct)?\(\s*\)[\s\S]{0,200}?\.from\(\s*operators\b/

describe('lecture des colonnes de secret', () => {
  it('aucune requête ne lit la table des opérateurs sans projection explicite', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => UNPROJECTED_READ.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))

    expect(offenders).toEqual([])
  })

  it('détecte bien une lecture non projetée — le test se prouve lui-même', () => {
    // Sans cette vérification, une expression régulière cassée rendrait le test ci-dessus vert à
    // jamais, et l'invariant ne serait plus gardé que par un commentaire.
    expect(UNPROJECTED_READ.test('const rows = await db.select().from(operators)')).toBe(true)
    expect(UNPROJECTED_READ.test('await db.selectDistinct().from(operators).where(x)')).toBe(true)

    // Et ne se déclenche pas sur la forme correcte.
    expect(UNPROJECTED_READ.test('await db.select(operatorSafeColumns).from(operators)')).toBe(
      false,
    )
    expect(UNPROJECTED_READ.test('await db.select().from(roles)')).toBe(false)
  })
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : []
  })
}

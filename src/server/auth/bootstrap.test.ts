// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { readBootstrapIdentity } from './bootstrap'

const COMPLET = {
  BOOTSTRAP_ADMIN_EMAIL: 'proprietaire@example.test',
  BOOTSTRAP_ADMIN_PASSWORD: 'un mot de passe assez long',
  BOOTSTRAP_ADMIN_NAME: 'Propriétaire',
} satisfies NodeJS.ProcessEnv

describe("lecture de l'identité du premier administrateur", () => {
  it('lit les trois variables', () => {
    expect(readBootstrapIdentity(COMPLET)).toEqual({
      email: 'proprietaire@example.test',
      password: 'un mot de passe assez long',
      displayName: 'Propriétaire',
    })
  })

  it('nomme chacune des variables manquantes', () => {
    // « Configuration incomplète » obligerait à ouvrir le code pour savoir laquelle. L'exploitant
    // qui lance cette commande est au milieu d'une installation.
    expect(() => readBootstrapIdentity({})).toThrow(
      /BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ADMIN_NAME/,
    )
  })

  it('nomme la seule variable manquante quand les autres sont là', () => {
    const { BOOTSTRAP_ADMIN_NAME, ...sansNom } = COMPLET

    expect(() => readBootstrapIdentity(sansNom)).toThrow(/BOOTSTRAP_ADMIN_NAME/)
  })

  it('traite une variable vide comme absente', () => {
    // `export BOOTSTRAP_ADMIN_PASSWORD=` définit la variable à la chaîne vide. Sans ce traitement,
    // le bootstrap échouerait plus loin, sur la longueur minimale, avec un message qui parlerait
    // d'un mot de passe trop court plutôt que d'une variable oubliée.
    expect(() => readBootstrapIdentity({ ...COMPLET, BOOTSTRAP_ADMIN_PASSWORD: '' })).toThrow(
      /BOOTSTRAP_ADMIN_PASSWORD/,
    )
  })

  it('retire les espaces autour de l email et du nom, jamais du mot de passe', () => {
    // Un espace collé par un copier-coller ne doit pas créer un second compte. Le mot de passe, lui,
    // se prend verbatim : rogner ses bords changerait silencieusement ce que l'exploitant a choisi,
    // et il ne pourrait plus se connecter avec ce qu'il croit avoir saisi.
    const identite = readBootstrapIdentity({
      BOOTSTRAP_ADMIN_EMAIL: '  proprietaire@example.test ',
      BOOTSTRAP_ADMIN_PASSWORD: '  mot de passe entouré  ',
      BOOTSTRAP_ADMIN_NAME: ' Propriétaire ',
    })

    expect(identite.email).toBe('proprietaire@example.test')
    expect(identite.displayName).toBe('Propriétaire')
    expect(identite.password).toBe('  mot de passe entouré  ')
  })

  it("ne fait jamais figurer le mot de passe dans le message d'erreur", () => {
    // Le message part dans un log d'installation, qui est conservé.
    const secret = 'ZQX7-MOTDEPASSE'
    let message = ''
    try {
      readBootstrapIdentity({ BOOTSTRAP_ADMIN_PASSWORD: secret })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).not.toContain(secret)
    expect(message).toContain('BOOTSTRAP_ADMIN_EMAIL')
  })
})

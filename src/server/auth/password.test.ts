// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { hashPassword, MAX_MEMORY_BYTES, PASSWORD_PARAMETERS, verifyPassword } from './password'

/**
 * Paramètres allégés pour la suite unitaire. Chaque hachage aux paramètres de production coûte
 * 166 ms et 128 Mio : une douzaine de cas ajouterait deux secondes à la boucle de travail pour ne
 * rien prouver de plus, la fonction étant identique. Les paramètres réels sont assertés par un test
 * dédié, qui est le seul endroit où ils doivent apparaître en dur.
 */
const RAPIDE = { N: 1024, r: 8, p: 1 } as const

describe('hachage de mot de passe', () => {
  it('vérifie un mot de passe correct', async () => {
    const stored = await hashPassword('correct horse battery staple', RAPIDE)

    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
  })

  it('refuse un mot de passe incorrect', async () => {
    const stored = await hashPassword('correct horse battery staple', RAPIDE)

    await expect(verifyPassword('correct horse battery stapl', stored)).resolves.toBe(false)
  })

  it('produit deux empreintes différentes pour le même mot de passe', async () => {
    // Sans sel aléatoire, deux opérateurs ayant choisi le même mot de passe se reconnaîtraient dans
    // un dump, et une table précalculée les casserait tous les deux d'un coup.
    const [a, b] = await Promise.all([
      hashPassword('même mot de passe', RAPIDE),
      hashPassword('même mot de passe', RAPIDE),
    ])

    expect(a).not.toBe(b)
  })

  it('ne laisse jamais le mot de passe apparaître dans l empreinte', async () => {
    const secret = 'ZQX7-MOTDEPASSE-EN-CLAIR'
    const stored = await hashPassword(secret, RAPIDE)

    expect(stored).not.toContain(secret)
    expect(Buffer.from(stored).toString('utf8')).not.toContain(secret)
  })

  it('se relit lui-même : l empreinte porte ses propres paramètres', async () => {
    // Format PHC, et ce n'est pas de la cosmétique : c'est ce qui permettra de passer à argon2id
    // sans invalider les mots de passe existants. Une empreinte muette obligerait à tout réinitialiser
    // le jour du changement — c'est-à-dire à ne jamais changer.
    const stored = await hashPassword('peu importe', RAPIDE)

    expect(stored).toMatch(/^\$scrypt\$n=1024,r=8,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  })

  it('vérifie une empreinte produite avec d autres paramètres que ceux du jour', async () => {
    // Le corollaire du point précédent : la vérification lit les paramètres **de l'empreinte**, pas
    // ceux de la configuration courante. Sans cela, durcir les paramètres déconnecterait tout le
    // monde au redéploiement suivant.
    const ancienne = await hashPassword('mot de passe historique', { N: 512, r: 8, p: 1 })

    await expect(verifyPassword('mot de passe historique', ancienne)).resolves.toBe(true)
  })

  it('refuse une empreinte malformée sans lever', async () => {
    // Une empreinte corrompue en base doit refuser la connexion, jamais faire remonter une exception
    // jusqu'à l'écran : une trace de pile sur un formulaire de login raconte la structure du stockage.
    for (const corrompue of [
      '',
      'pas-du-tout-une-empreinte',
      '$scrypt$n=1024,r=8,p=1$sel-sans-empreinte',
      '$scrypt$n=abc,r=8,p=1$c2Vs$ZW1wcmVpbnRl',
      '$argon2id$v=19$m=65536$c2Vs$ZW1wcmVpbnRl',
      '$scrypt$n=1024,r=8,p=1$!!!$ZW1wcmVpbnRl',
    ]) {
      await expect(verifyPassword('peu importe', corrompue), corrompue).resolves.toBe(false)
    }
  })

  it('refuse une empreinte dont le coût dépasse ce qu on accepte de calculer', async () => {
    // Une empreinte lue en base porte ses propres paramètres : un `N` absurde y ferait allouer des
    // gigaoctets à la première tentative de connexion. La borne se pose ici, à la lecture, et pas
    // seulement à l'écriture — c'est la valeur venue de la base qui est hostile, pas la nôtre.
    await expect(
      verifyPassword('peu importe', '$scrypt$n=1073741824,r=8,p=1$c2Vs$ZW1wcmVpbnRl'),
    ).resolves.toBe(false)
  })

  it('refuse de hacher un mot de passe vide', async () => {
    await expect(hashPassword('', RAPIDE)).rejects.toThrow(/vide/i)
  })
})

describe('paramètres de production', () => {
  it('tient la recommandation OWASP pour scrypt', () => {
    // N = 2^17, r = 8, p = 1. Mesuré à 166 ms et 128 Mio par vérification sur la machine de
    // développement. Ces deux nombres sont une contrainte pour la step-021 : le coût mémoire est
    // par vérification **en vol**, donc dix tentatives simultanées demandent 1,3 Gio. L'anti-brute-force
    // devra borner la concurrence, pas seulement le nombre d'essais par compte.
    expect(PASSWORD_PARAMETERS).toEqual({ N: 131_072, r: 8, p: 1 })
  })

  it('hache et vérifie réellement aux paramètres de production', async () => {
    // **Le seul test de ce fichier qui exerce `MAX_MEMORY_BYTES`.** Il a remplacé une assertion qui
    // comparait `128 × N × r` au défaut de Node sans jamais appeler scrypt : ramener
    // `MAX_MEMORY_BYTES` à 64 Mio aurait fait échouer 100 % des connexions en production tout en
    // laissant la suite verte.
    //
    // Deux pièges qu'il attrape, et qu'aucune arithmétique n'aurait montrés : `maxmem` vaut 32 Mio
    // par défaut dans Node, et le besoin réel n'est pas `128 × N × r` mais `128·r·(N+2) + 128·r·p` —
    // trois kilo-octets de plus, assez pour un « memory limit exceeded ».
    //
    // Il coûte deux hachages, soit environ 340 ms. C'est le prix du seul mode d'échec qui casse
    // tout, d'un coup, au premier login réel.
    const stored = await hashPassword('mot de passe de production', PASSWORD_PARAMETERS)

    await expect(verifyPassword('mot de passe de production', stored)).resolves.toBe(true)
  })

  it('reste au-dessus du plafond mémoire par défaut de Node', () => {
    // Ce que l'ancienne version de ce fichier prétendait vérifier : les paramètres retenus dépassent
    // les 32 Mio par défaut, donc `maxmem` doit impérativement être relevé — ce que la constante
    // ci-dessus fait, et que le test précédent prouve à l'exécution.
    expect(128 * PASSWORD_PARAMETERS.r * (PASSWORD_PARAMETERS.N + 2)).toBeGreaterThan(
      32 * 1024 * 1024,
    )
    expect(MAX_MEMORY_BYTES).toBeGreaterThan(
      128 * PASSWORD_PARAMETERS.r * (PASSWORD_PARAMETERS.N + 2) +
        128 * PASSWORD_PARAMETERS.r * PASSWORD_PARAMETERS.p,
    )
  })
})

describe('empreintes hostiles venues de la base', () => {
  it('refuse un parallélisme qui monopoliserait un thread pendant des heures', async () => {
    // `p` ne coûte presque rien en mémoire mais multiplie le temps : une garde qui ne regarderait
    // que la mémoire laisserait passer celle-ci, et le pool libuv — quatre threads par défaut — s'y
    // épuiserait dès la première tentative de connexion.
    await expect(
      verifyPassword('peu importe', '$scrypt$n=131072,r=8,p=50000$c2Vs$ZW1wcmVpbnRl'),
    ).resolves.toBe(false)
  })

  it('refuse un coût qui passe pour une puissance de deux en arithmétique 32 bits', async () => {
    // `N = 2**32` : `N & (N - 1)` vaut `0 & -1`, donc zéro — le test de puissance de deux le laisse
    // passer. Sans borne explicite sur `N`, la sûreté dépendrait de l'ordre des gardes suivantes.
    await expect(
      verifyPassword('peu importe', `$scrypt$n=${2 ** 32},r=8,p=1$c2Vs$ZW1wcmVpbnRl`),
    ).resolves.toBe(false)
  })

  it('refuse un r absurde', async () => {
    await expect(
      verifyPassword('peu importe', '$scrypt$n=1024,r=99999,p=1$c2Vs$ZW1wcmVpbnRl'),
    ).resolves.toBe(false)
  })
})

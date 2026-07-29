// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { isCountableIp, readClientIp, readTrustedProxyCount, UNKNOWN_CLIENT_IP } from './client-ip'

describe('adresse de l appelant', () => {
  it('ne compte rien tant que la topologie n est pas déclarée', () => {
    // **Le défaut qui échoue du bon côté, et il a failli être inversé.** Rendre l'adresse du socket
    // ici paraissait un progrès — enfin une valeur que l'appelant ne contrôle pas. Mais derrière le
    // load balancer que la spec impose, cette adresse est celle du répartiteur, la même pour tous :
    // vingt échecs de n'importe qui auraient verrouillé la console entière.
    expect(readClientIp({ forwardedFor: '1.2.3.4', remoteAddress: '10.0.0.9' }, undefined)).toBe(
      UNKNOWN_CLIENT_IP,
    )
  })

  it('compte l adresse du socket quand zéro proxy est explicitement déclaré', () => {
    // `0` est une affirmation — « aucun proxy ne s'intercale » — pas une absence de réponse.
    expect(readClientIp({ forwardedFor: '1.2.3.4', remoteAddress: '10.0.0.9' }, 0)).toBe('10.0.0.9')
  })

  it('ne laisse pas un attaquant forger son adresse de comptage', () => {
    // Chaque proxy **ajoute à droite** l'adresse du pair qu'il a vu. Tout ce qui se trouve à gauche
    // du maillon écrit par notre infrastructure vient donc de l'appelant — ici, deux valeurs
    // inventées avant que notre load balancer n'ajoute l'adresse réelle.
    //
    // Prendre la valeur la plus à gauche, ce que font la plupart des exemples, laisserait
    // l'attaquant changer d'identité de comptage à chaque tentative : le compteur par adresse ne
    // compterait plus rien, et l'anti-brute-force serait neutralisé sans que rien ne le signale.
    const forge = '203.0.113.1, 203.0.113.2, 198.51.100.77'

    expect(readClientIp({ forwardedFor: forge, remoteAddress: '10.0.0.9' }, 1)).toBe(
      '198.51.100.77',
    )
    expect(readClientIp({ forwardedFor: forge, remoteAddress: '10.0.0.9' }, 1)).not.toBe(
      '203.0.113.1',
    )
  })

  it('remonte du bon nombre de maillons', () => {
    // Deux proxies en série : le client atteint P1, qui ajoute l'adresse du client, puis P2, qui
    // ajoute celle de P1. La valeur forgée par l'appelant reste en tête et n'est jamais retenue.
    const chaine = 'valeur-forgée, adresse-du-client, adresse-de-p1'

    expect(readClientIp({ forwardedFor: chaine, remoteAddress: '10.0.0.9' }, 1)).toBe(
      'adresse-de-p1',
    )
    expect(readClientIp({ forwardedFor: chaine, remoteAddress: '10.0.0.9' }, 2)).toBe(
      'adresse-du-client',
    )
  })

  it('retombe sur l adresse de connexion quand la chaîne est trop courte', () => {
    // Chaîne plus courte qu'annoncé : la requête n'a pas traversé le chemin attendu. On ne devine
    // pas — deviner reviendrait à accepter une valeur choisie par l'appelant.
    expect(readClientIp({ forwardedFor: '1.2.3.4', remoteAddress: '10.0.0.9' }, 3)).toBe('10.0.0.9')
    expect(readClientIp({ forwardedFor: '', remoteAddress: '10.0.0.9' }, 2)).toBe('10.0.0.9')
  })

  it('tolère les espaces et les valeurs vides de la chaîne', () => {
    expect(
      readClientIp({ forwardedFor: ' 1.2.3.4 ,, 5.6.7.8 ', remoteAddress: '10.0.0.9' }, 1),
    ).toBe('5.6.7.8')
  })

  it('rend une clé commune plutôt que rien quand tout manque', () => {
    // `undefined` traverserait le compteur sans être compté : une adresse inconnue doit rester
    // comptable, quitte à partager sa clé avec d'autres.
    expect(readClientIp({}, 0)).toBe(UNKNOWN_CLIENT_IP)
    expect(readClientIp({ forwardedFor: null, remoteAddress: null }, 2)).toBe(UNKNOWN_CLIENT_IP)
  })
})

describe('adresse comptable', () => {
  it('ne compte pas une adresse indéterminée', () => {
    // Un seau commun serait pire que rien : vingt échecs de n'importe qui verrouilleraient la
    // connexion de tout le monde. L'anti-brute-force deviendrait le déni de service.
    expect(isCountableIp(UNKNOWN_CLIENT_IP)).toBe(false)
    expect(isCountableIp('')).toBe(false)
  })

  it('refuse une valeur trop longue pour être une adresse', () => {
    // La clé est la clé primaire de `login_attempts` : au-delà de la taille d'index de PostgreSQL,
    // l'insertion échouerait — hors plancher, avec un statut différent, donc un oracle de plus.
    expect(isCountableIp('a'.repeat(65))).toBe(false)
  })

  it('compte une adresse ordinaire', () => {
    expect(isCountableIp('198.51.100.42')).toBe(true)
    expect(isCountableIp('2001:db8::1')).toBe(true)
  })
})

describe('nombre de proxies de confiance', () => {
  it('n est pas déclaré quand la variable est absente ou vide', () => {
    // Distinct de zéro : voir l'en-tête du module. Confondre les deux rendait la console
    // verrouillable par n'importe qui en vingt requêtes.
    expect(readTrustedProxyCount({})).toBeUndefined()
    expect(readTrustedProxyCount({ AUTH_TRUSTED_PROXIES: '   ' })).toBeUndefined()
  })

  it('lit un zéro explicite comme une déclaration', () => {
    expect(readTrustedProxyCount({ AUTH_TRUSTED_PROXIES: '0' })).toBe(0)
  })

  it('lit une déclaration valide', () => {
    expect(readTrustedProxyCount({ AUTH_TRUSTED_PROXIES: '2' })).toBe(2)
  })

  it('traite une valeur absurde comme une absence de déclaration', () => {
    // Surtout pas comme un zéro : zéro engage, et une faute de frappe ne doit pas engager.
    for (const value of ['-1', 'deux', '1.5', '']) {
      expect(readTrustedProxyCount({ AUTH_TRUSTED_PROXIES: value }), value).toBeUndefined()
    }
  })
})

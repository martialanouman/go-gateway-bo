// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  isCountableIp,
  readClientIp,
  readClientIpFromRequest,
  readTrustedProxyCount,
  UNKNOWN_CLIENT_IP,
} from './client-ip'

describe('adresse de l appelant', () => {
  it('ignore x-forwarded-for quand aucun proxy n est déclaré', () => {
    // **Le défaut qui échoue du bon côté.** Sans déclaration, l'en-tête est fourni par le client :
    // le croire reviendrait à laisser l'appelant choisir son identité de comptage.
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

describe('lecture depuis une requête entrante', () => {
  const requete = (headers: Record<string, string>) => ({
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  })

  it('ne lit jamais x-real-ip', () => {
    // **Le trou que la revue a trouvé.** `x-real-ip` est fourni par le client au même titre que
    // `x-forwarded-for` : le lire refermait une porte tout en en ouvrant une autre, et l'appelant
    // reprenait le contrôle de son identité de comptage — donc de l'anti-brute-force entier.
    const ip = readClientIpFromRequest(
      requete({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }),
      {},
    )

    expect(ip).not.toBe('203.0.113.9')
    expect(ip).toBe(UNKNOWN_CLIENT_IP)
  })

  it('utilise x-forwarded-for quand des proxies sont déclarés', () => {
    const ip = readClientIpFromRequest(requete({ 'x-forwarded-for': 'forgé, 198.51.100.1' }), {
      AUTH_TRUSTED_PROXIES: '1',
    })

    expect(ip).toBe('198.51.100.1')
  })

  it("retient l'adresse de connexion quand le serveur la fournit", () => {
    expect(readClientIpFromRequest(requete({}), {}, '198.51.100.42')).toBe('198.51.100.42')
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
  it('vaut zéro sans déclaration', () => {
    expect(readTrustedProxyCount({})).toBe(0)
  })

  it('lit une déclaration valide', () => {
    expect(readTrustedProxyCount({ AUTH_TRUSTED_PROXIES: '2' })).toBe(2)
  })

  it('retombe à zéro sur une valeur absurde plutôt que de deviner', () => {
    for (const value of ['-1', 'deux', '1.5', '']) {
      expect(readTrustedProxyCount({ AUTH_TRUSTED_PROXIES: value }), value).toBe(0)
    }
  })
})

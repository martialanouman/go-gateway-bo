import { describe, expect, it } from 'vitest'
import {
  forgetAccessToken,
  forgetChallenge,
  peekAccessToken,
  peekChallenge,
  rememberAccessToken,
  rememberChallenge,
  safeDestination,
} from './session'

describe('the destination replayed after login', () => {
  it('keeps an address of this dashboard, including path, filters and anchor', () => {
    expect(safeDestination('/billing')).toBe('/billing')
    expect(safeDestination('/cdr?statut=echec#ligne-12')).toBe('/cdr?statut=echec#ligne-12')
  })

  it('refuses a scheme-relative URL, in both of its spellings', () => {
    // `//ailleurs.example` et `/\ailleurs.example` désignent le même hôte tiers, et les navigateurs
    // suivent les deux. Sans ce refus, le paramètre ferait du lien de connexion un hameçon : le
    // domaine affiché est celui du cockpit, la connexion est réelle, et la redirection dépose
    // ailleurs.
    expect(safeDestination('//ailleurs.example/moisson')).toBeUndefined()
    expect(safeDestination('/\\ailleurs.example/moisson')).toBeUndefined()
  })

  it('refuses a blank or a backslash slipped further into the value', () => {
    // `/\n//ailleurs.example` ne commence ni par `//` ni par `/\` : il traversait les deux premiers
    // refus. Le routeur ne gardait alors que le chemin — mesuré — mais le plafond était chez lui.
    expect(safeDestination('/\n//ailleurs.example')).toBeUndefined()
    expect(safeDestination('/billing\\..\\ailleurs')).toBeUndefined()
    expect(safeDestination('/ bil ling')).toBeUndefined()
  })

  it('refuses anything that is not an absolute path of this site', () => {
    expect(safeDestination('https://ailleurs.example')).toBeUndefined()
    expect(safeDestination('javascript:alert(1)')).toBeUndefined()
    expect(safeDestination('billing')).toBeUndefined()
    expect(safeDestination(undefined)).toBeUndefined()
    // Un paramètre répété arrive en tableau : rien d'une adresse.
    expect(safeDestination(['/billing', '//ailleurs.example'])).toBeUndefined()
  })
})

describe('the second-factor challenge', () => {
  it('is retained then forgotten, and leaves no trace anywhere but in the module', () => {
    rememberChallenge('un-challenge')
    expect(peekChallenge()).toBe('un-challenge')

    // Ni l'URL ni le stockage du navigateur : l'un se recopie et part dans un `Referer`, l'autre
    // survit à la fermeture de l'onglet alors que le challenge ne vaut que cinq minutes.
    expect(window.location.search).not.toContain('un-challenge')
    expect(window.sessionStorage.getItem('challenge')).toBeNull()
    expect(Object.values({ ...window.localStorage })).not.toContain('un-challenge')

    forgetChallenge()
    expect(peekChallenge()).toBeUndefined()
  })
})

describe('the access link token', () => {
  it('is retained then forgotten, and leaves no trace anywhere but in the module', () => {
    rememberAccessToken('un-jeton')
    expect(peekAccessToken()).toBe('un-jeton')

    expect(window.location.search).not.toContain('un-jeton')
    expect(window.sessionStorage.getItem('access-token')).toBeNull()
    expect(Object.values({ ...window.localStorage })).not.toContain('un-jeton')

    forgetAccessToken()
    expect(peekAccessToken()).toBeUndefined()
  })
})

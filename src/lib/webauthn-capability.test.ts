import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectPasskeyCapability, shouldOfferPasskeyFirst } from './webauthn-capability'

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(),
  platformAuthenticatorIsAvailable: vi.fn(),
}))

const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable } = await import(
  '@simplewebauthn/browser'
)

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReset()
  vi.mocked(platformAuthenticatorIsAvailable).mockReset()
})

describe('détection de capacité', () => {
  it('rend « platform » quand un authentificateur intégré est disponible', async () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
    vi.mocked(platformAuthenticatorIsAvailable).mockResolvedValue(true)

    expect(await detectPasskeyCapability()).toBe('platform')
  })

  it('distingue un navigateur capable sans authentificateur intégré', async () => {
    // Un poste de bureau sans lecteur biométrique présente l'API : proposer la passkey en premier y
    // mènerait à une invite que l'opérateur ne peut pas satisfaire. Une clé externe reste possible.
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
    vi.mocked(platformAuthenticatorIsAvailable).mockResolvedValue(false)

    expect(await detectPasskeyCapability()).toBe('external-only')
  })

  it('rend « unsupported » quand l’API est absente', async () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false)

    expect(await detectPasskeyCapability()).toBe('unsupported')
    // La seconde question n'est même pas posée : l'API n'existe pas.
    expect(platformAuthenticatorIsAvailable).not.toHaveBeenCalled()
  })

  it('mène au TOTP quand le navigateur refuse de répondre, sans lever', async () => {
    // Politique d'entreprise, contexte non sécurisé, implémentation partielle : l'opérateur doit
    // pouvoir entrer avec le facteur qu'il détient, pas voir un écran en erreur.
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
    vi.mocked(platformAuthenticatorIsAvailable).mockRejectedValue(new Error('refusé'))

    expect(await detectPasskeyCapability()).toBe('unsupported')
  })
})

describe('ordre des facteurs proposés', () => {
  it('propose la passkey dès qu’un authentificateur est atteignable', () => {
    expect(shouldOfferPasskeyFirst('platform')).toBe(true)
    expect(shouldOfferPasskeyFirst('external-only')).toBe(true)
  })

  it('va droit au TOTP quand rien n’est atteignable', () => {
    expect(shouldOfferPasskeyFirst('unsupported')).toBe(false)
  })
})

import { startRegistration } from '@simplewebauthn/browser'
import { z } from 'zod'
import { api, refusalMessage } from './api'
import { WebauthnRegistration } from './contract.gen'

export const passkeyNaming = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nommez la clé : c’est ce nom qui la distingue quand il faudra en retirer une.')
    .pipe(WebauthnRegistration.shape.name),
})

export const CEREMONY_ABANDONED =
  'La clé d’accès n’a pas été enregistrée : la fenêtre du navigateur s’est refermée, ou l’appareil n’a pas répondu. Reprenez l’enregistrement.'

/** Ce que `navigator.credentials.create()` produit, transmis **tel quel** au BFF. */
export async function createPasskey(options: unknown) {
  try {
    return await startRegistration({
      optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'],
    })
  } catch {
    // La bibliothèque rédige en anglais, et le cas courant n'est pas une panne : c'est la fenêtre
    // du navigateur qu'on referme.
    throw new Error(CEREMONY_ABANDONED)
  }
}

/** Ouvre la cérémonie, la conduit, et enregistre la clé sous le nom que l'opérateur lui donne. */
export async function registerPasskey(name: string) {
  const opened = await api.POST('/auth/mfa/webauthn/register/begin')
  if (opened.data === undefined) throw new Error(registrationRefusal(opened.error, opened.response))

  const attestation = await createPasskey(opened.data.publicKey)

  const { data, error, response } = await api.POST('/auth/mfa/webauthn/register/finish', {
    body: { attestation: attestation as unknown as Record<string, unknown>, name },
  })
  if (data === undefined) throw new Error(registrationRefusal(error, response))

  return data
}

function registrationRefusal(error: unknown, response: Response) {
  return refusalMessage(
    error,
    `La clé d’accès n’a pas été enregistrée : le tableau de bord n’a pas obtenu de réponse (HTTP ${response.status}).`,
  )
}

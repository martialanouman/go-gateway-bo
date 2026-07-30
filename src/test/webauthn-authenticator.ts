/**
 * Un authentificateur WebAuthn logiciel, pour les tests.
 *
 * ## Pourquoi pas un doublure de la bibliothèque
 *
 * Parce que ce qu'on veut prouver est exactement ce qu'une doublure escamote : qu'une signature
 * invalide est refusée, qu'un défi rejoué ne passe pas, qu'une origine non conforme est rejetée, et
 * qu'un compteur qui n'avance plus est vu. Remplacer `verifyRegistrationResponse` par une fonction qui
 * rend `true` testerait le câblage et appellerait cela de la sécurité.
 *
 * Cet authentificateur produit donc de vraies réponses : une paire de clés ECDSA P-256, un
 * `clientDataJSON` conforme, des données d'authentificateur avec leurs drapeaux et leur compteur, et
 * une signature DER que la bibliothèque vérifie pour de bon. Les tests peuvent ensuite **mentir
 * délibérément** — signer pour une autre origine, rejouer un défi, faire reculer le compteur — et
 * constater le refus.
 *
 * ## Ce qu'il ne fait pas
 *
 * Aucune attestation (`fmt: 'none'`), ce qui est précisément ce que le serveur demande. Pas de clé
 * résidente, pas d'extension. Il ne remplace pas un test de bout en bout avec l'authentificateur
 * virtuel du navigateur — celui-là vérifie que le *navigateur* est d'accord, ce qu'aucun code Node ne
 * peut établir.
 */

import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { isoCBOR } from '@simplewebauthn/server/helpers'

/** Présence de l'utilisateur, utilisateur vérifié, et données de credential attestées. */
const FLAG_USER_PRESENT = 0x01
const FLAG_USER_VERIFIED = 0x04
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40

/** Identifiant d'un authentificateur logiciel : seize octets nuls, comme le veut `fmt: 'none'`. */
const AAGUID = Buffer.alloc(16)

const b64url = (data: Buffer | Uint8Array) => Buffer.from(data).toString('base64url')

export type SoftwareAuthenticator = {
  readonly credentialId: string
  /** Produit une réponse d'enregistrement pour le défi donné. */
  register(options: { challenge: string; rpId: string; origin: string }): RegistrationResponseJSON
  /**
   * Produit une réponse d'authentification.
   *
   * `counter` est explicite pour que les tests puissent le faire stagner ou reculer — c'est la
   * détection de clonage de la spécification, et elle ne se vérifie pas autrement.
   */
  authenticate(options: {
    challenge: string
    rpId: string
    origin: string
    counter: number
  }): AuthenticationResponseJSON
}

/** Un authentificateur neuf, avec sa propre paire de clés. */
export function createSoftwareAuthenticator(): SoftwareAuthenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const credentialIdBytes = randomBytes(32)
  const credentialId = b64url(credentialIdBytes)

  // La clé publique brute d'une EC P-256 : `04 || x(32) || y(32)` dans son export DER.
  const raw = publicKey.export({ type: 'spki', format: 'der' })
  const point = raw.subarray(raw.length - 65)
  const x = point.subarray(1, 33)
  const y = point.subarray(33, 65)

  /** La clé publique au format COSE, tel que l'attend WebAuthn : ES256 sur P-256. */
  const cosePublicKey = Buffer.from(
    isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty : EC2
        [3, -7], // alg : ES256
        [-1, 1], // crv : P-256
        [-2, new Uint8Array(x)],
        [-3, new Uint8Array(y)],
      ]),
    ),
  )

  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8')

  const authenticatorData = (rpId: string, flags: number, counter: number, extra?: Buffer) => {
    const header = Buffer.alloc(37)
    createHash('sha256').update(rpId, 'utf8').digest().copy(header, 0)
    header[32] = flags
    header.writeUInt32BE(counter, 33)
    return extra ? Buffer.concat([header, extra]) : header
  }

  return {
    credentialId,

    register({ challenge, rpId, origin }) {
      const attestedCredentialData = Buffer.concat([
        AAGUID,
        Buffer.from([credentialIdBytes.length >> 8, credentialIdBytes.length & 0xff]),
        credentialIdBytes,
        cosePublicKey,
      ])

      const authData = authenticatorData(
        rpId,
        FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_CREDENTIAL_DATA,
        0,
        attestedCredentialData,
      )

      // `fmt: 'none'` : aucune attestation, et un `attStmt` vide — c'est exactement ce que le serveur
      // demande, et cela évite d'avoir à fabriquer une chaîne de certificats.
      const attestation = new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, unknown>()],
        ['authData', new Uint8Array(authData)],
      ])

      const attestationObject = Buffer.from(
        isoCBOR.encode(attestation as Parameters<typeof isoCBOR.encode>[0]),
      )

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(clientData('webauthn.create', challenge, origin)),
          attestationObject: b64url(attestationObject),
          transports: ['internal'],
        },
      }
    },

    authenticate({ challenge, rpId, origin, counter }) {
      const authData = authenticatorData(rpId, FLAG_USER_PRESENT | FLAG_USER_VERIFIED, counter)
      const client = clientData('webauthn.get', challenge, origin)

      // La signature couvre les données d'authentificateur **et** le condensat du `clientDataJSON` :
      // c'est ce qui lie la signature au défi et à l'origine, donc ce qui rend le rejeu inopérant.
      const signature = createSign('sha256')
        .update(Buffer.concat([authData, createHash('sha256').update(client).digest()]))
        .sign(privateKey)

      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64url(client),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
        },
      }
    },
  }
}

/**
 * Remettre l'opérateur de test dans l'état « aucun second facteur ».
 *
 * ## Pourquoi ce helper existe
 *
 * `globalSetup` installe **un seul** administrateur, partagé par tous les parcours — et l'amorçage
 * refuse de s'exécuter dès qu'un opérateur existe, ce qui est une garde de production qu'on ne
 * contourne pas. Or les parcours d'authentification enrôlent : l'un pose un TOTP, l'autre une
 * passkey, et chacun laisse derrière lui un compte que le suivant ne reconnaît plus. Le second se
 * verrait alors refuser son enrôlement par un 403 parfaitement légitime, et l'échec ressemblerait à
 * un défaut du produit.
 *
 * Appelé en `beforeAll` de chaque fichier qui enrôle, il rend l'état de départ explicite plutôt
 * qu'hérité de l'ordre d'exécution.
 */

import { E2E_OPERATOR } from './global-setup'

export async function resetMfaFactors(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL est requise pour le bout en bout.')

  // Import dynamique : ces modules tirent le pilote PostgreSQL, dont un fichier de parcours n'a
  // besoin qu'au moment où il remet l'état à zéro.
  const { connect } = await import('../src/server/db/index')
  const { client } = connect(url, { poolSize: 1 })

  try {
    await client`
      UPDATE operators
         SET mfa_totp_secret = NULL,
             mfa_totp_activated_at = NULL,
             mfa_totp_last_step = NULL,
             mfa_webauthn_credentials = '[]'::jsonb
       WHERE email = ${E2E_OPERATOR.email}
    `
    // Les codes de récupération suivent le facteur qui les a produits : les laisser ferait entrer un
    // parcours avec un code d'une vie antérieure.
    await client`
      DELETE FROM operator_recovery_codes
       WHERE operator_id IN (SELECT id FROM operators WHERE email = ${E2E_OPERATOR.email})
    `
  } finally {
    await client.end({ timeout: 5 })
  }
}

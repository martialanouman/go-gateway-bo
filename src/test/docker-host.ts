/**
 * `globalSetup` du projet de tests `db`.
 *
 * Testcontainers cherche le démon Docker à `/var/run/docker.sock`. Sur les runners GitHub, il y est.
 * Sur un poste de développement, rarement : OrbStack, colima, Rancher et Podman placent chacun le
 * leur ailleurs. Sans cette résolution, chaque contributeur macOS reçoit « Could not find a working
 * container runtime strategy » alors que son Docker fonctionne parfaitement — un message qui envoie
 * chercher au mauvais endroit.
 *
 * On demande donc son adresse à la seule autorité qui la connaisse : le CLI Docker lui-même.
 *
 * Ce qu'on ne fait **pas** : sauter les tests quand rien n'est trouvé. Une suite de migrations qui
 * se saute en silence se lit exactement comme une suite qui passe.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export default function setup(): void {
  if (process.env.DOCKER_HOST) return
  if (existsSync('/var/run/docker.sock')) return

  const endpoint = dockerEndpointFromContext()
  if (!endpoint) {
    throw new Error(
      'Aucun démon Docker joignable. Les tests de migrations appliquent le SQL sur un vrai ' +
        'PostgreSQL 18 : ils ne peuvent pas être simulés, et les sauter reviendrait à ne pas les ' +
        'avoir. Démarrer Docker (ou OrbStack, colima, Rancher), puis relancer `pnpm test:db`.',
    )
  }

  process.env.DOCKER_HOST = endpoint

  // Testcontainers vérifie l'appartenance au groupe du socket avant de s'y connecter ; sur un socket
  // utilisateur, ce contrôle n'a pas de sens et refuserait une connexion qui fonctionne.
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true'
}

function dockerEndpointFromContext(): string | undefined {
  try {
    const raw = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
    const endpoint = raw.trim()
    return endpoint.length > 0 ? endpoint : undefined
  } catch {
    return undefined
  }
}

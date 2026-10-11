# step-080 — Trafic : instantané REST, widgets et graphiques — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** l'écran `/traffic` affiche six tuiles et deux graphiques sur les 5 dernières minutes, lus par
deux routes BFF relayées vers l'API Admin et gardées par une nouvelle clé `traffic:read`.

**Architecture:** deux handlers relaient `get-metrics-summary` et `get-traffic-metrics` (contrat 7.3.0)
vers des DTO déclarés ; la clé `traffic:read` (classe `GatewayRead`) garde ces routes, l'entrée du
rail et le sujet `metrics.traffic` du hub. Le client calcule tuiles et séries dans un module pur
(`web/src/lib/traffic.ts`), les rend avec un `MetricTile` et un `Chart` SVG portés du kit dans
`web/src/components/traffic/`, dont le CSS voyage dans le bloc de la route (pas dans la feuille
d'entrée, dont le budget est plein).

**Tech Stack:** Go (oapi-codegen strict server, godog, Prism), React + TanStack Router/Query, Vitest,
Playwright.

**Spec:** `tasks/steps/step-080.md`

## Global Constraints

- Contrat de la passerelle : **7.3.0**, aucun bump (sections métriques identiques en 7.6.0).
- Aucune nouvelle dépendance (ni Go, ni npm) : graphiques en SVG maison.
- `traffic:read` → tous les rôles par défaut **sauf `Audit`** ; Propriétaire la reçoit par `everyCatalogKey()`.
- Fenêtre fixe `5m` côté écran ; `window` ∈ `5m|15m|30m|1h`, `groupBy` ∈ `connector|customer|group` côté routes.
- Une valeur `null` ou absente s'affiche « non mesurée », jamais `0`.
- Feuille d'entrée : `web/cold-load.test.ts` ne doit pas rougir — aucun octet ajouté à `web/src/styles/`.
- Code en anglais, copie en français, troisième personne, conséquence d'abord ; noms de tests en anglais, Gherkin en français.
- Commentaires : seulement le « pourquoi », trois lignes au plus.
- Toujours `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock` pour godog/testcontainers ; `-count=1` sur toute mesure.
- Commiter **avant** toute mutation ; muter dans un worktree isolé.

---

### Task 1: La clé `traffic:read` et ses trois portes

**Files:**
- Modify: `internal/permissions/catalog.go` (constante + entrée catalogue, catégorie `sessions`, la plus proche : le trafic se lit avec les sessions actives ; aucune catégorie neuve)
- Modify: `internal/permissions/scopes.go` (`TrafficRead: ScopeAdminRead`)
- Modify: `internal/permissions/roles.go` (7 rôles : Exploitation, Scripts, Support, Finance, Reporting, Clientèle, Conformité ; description de Reporting)
- Modify: `internal/permissions/roles_test.go` (`specRoles` : même ajout)
- Modify: `docs/specification-technique-tableau-de-bord.md` (§6.10 : liste des clés l. ~100-111, ligne `Reporting`, phrase d'amendement)
- Modify: `internal/hub/frames.go` (feed `metrics.traffic` : `permission: permissions.TrafficRead` ; commentaire de `feed`)
- Modify: `web/src/lib/navigation.ts` (`anyOf: ['traffic:read']` ; commentaire)
- Modify: `cmd/dashboard/realtime.feature` (scénario de refus)
- Modify: `web/src/components/admin/permission-picker.test.tsx` (45 → 46)
- Generated: `web/src/lib/permissions.gen.ts` (`make generate`)

**Interfaces:**
- Produces: `permissions.TrafficRead Key = "traffic:read"` ; clé TS `'traffic:read'` dans `PermissionKey`.

- [ ] **Step 1: Scénario rouge du hub** — ajouter à `cmd/dashboard/realtime.feature` :

```gherkin
  Scénario: le trafic temps réel est refusé à qui ne détient pas traffic:read
    Étant donné l'opérateur détient le rôle "Audit"
    Et l'opérateur ouvre une session élevée
    Et la socket est ouverte
    Quand l'opérateur s'abonne à "metrics.traffic"
    Alors la socket refuse "metrics.traffic" en nommant "traffic:read"
```

- [ ] **Step 2: Le voir rouge**

Run: `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock go test -count=1 ./cmd/dashboard -run 'TestScenarios/le_trafic_temps_réel'`
Expected: FAIL (le sujet est ouvert à tous ; ou step non défini si le refus nommé n'existe que pour `billing.alerts` — alors réutiliser la step existante `la socket refuse "…" en nommant "…"`, déjà générique).

- [ ] **Step 3: Implémenter la clé**

`catalog.go`, avant `SessionsRead` dans le bloc de constantes :

```go
	TrafficRead Key = "traffic:read"
```

et dans `catalog`, avant l'entrée `SessionsRead` :

```go
	{
		Key:         TrafficRead,
		Category:    "sessions",
		Description: "Consulter le trafic : débits, taux de succès, latences et sessions actives",
	},
```

`scopes.go` : ajouter `TrafficRead: ScopeAdminRead,` dans `gatewayAccess`.

`roles.go` : ajouter `TrafficRead` aux `Keys` des 7 rôles ; Reporting devient :

```go
		Description: "Consulte les soldes, le grand livre et les plans tarifaires, reçoit les alertes de facturation, et lit le trafic — rien d'autre",
		Keys: []Key{
			BillingRead, TrafficRead,
		},
```

`roles_test.go` : `permissions.TrafficRead` dans les 7 entrées de `specRoles`.

`frames.go` : `path: "/admin/stream/metrics", topic: TrafficTopic, permission: permissions.TrafficRead,` ; le commentaire de `feed` devient « Une permission vide ouvrirait le sujet à tout opérateur authentifié ; aucun sujet n'en a plus. ».

`navigation.ts` : `{ to: '/traffic', label: 'Trafic', milestone: 'M4', anyOf: ['traffic:read'] },` ; commentaire : « CDR Explorer n'exige rien parce que le catalogue n'a aucune clé pour le lire (`cdr:read_pii` ne gouverne que les numéros en clair). »

Spec §6.10 : ajouter `traffic:read` à la liste des clés, à la ligne `Reporting` (« `billing:read` et `traffic:read` »), et une phrase *(Amendement step-080 : `traffic:read`, accordée à tous les rôles sauf `Audit`.)*

Puis `make generate` et `permission-picker.test.tsx` : `46`.

- [ ] **Step 4: Vert**

Run: `go test -count=1 ./internal/permissions ./internal/hub && DOCKER_HOST=… go test -count=1 ./cmd/dashboard -run 'TestScenarios/(le_trafic_temps_réel|un_sujet)' && pnpm -C web exec vitest run --coverage.enabled=false src/lib/navigation.test.tsx src/components/admin/permission-picker.test.tsx`
Expected: PASS. Si `navigation.test.tsx` affirme que Trafic est visible sans clé, le corriger : c'est l'affirmation que la step renverse.

- [ ] **Step 5: Commit** — `feat(step-080): clé traffic:read — routes, rail et sujet metrics.traffic`

---

### Task 2: Les deux routes relayées

**Files:**
- Modify: `api/openapi-bff.yaml` (paths `/metrics/summary`, `/metrics/traffic` ; schémas `MetricsSummary`, `TrafficMetrics`, `TrafficSeries`, `TrafficPoint`, `MetricsWindow`, `TrafficGroupBy`)
- Create: `internal/bff/metrics.go`
- Modify: `internal/bff/guard.go` (deux entrées `requires(permissions.TrafficRead)`)
- Modify: `internal/bff/contract_errors_test.go`, `internal/bff/testdata/compliant/compliant.go` (doublures)
- Create: `cmd/dashboard/traffic.feature` (+ steps si besoin dans un `traffic_test.go`)
- Generated: `internal/bff/bff.gen.go`, `web/src/lib/api.gen.ts`, `web/src/lib/contract.gen.ts`

**Interfaces:**
- Consumes: `permissions.TrafficRead` (Task 1) ; `a.Gateway.GetMetricsSummaryWithResponse`, `a.Gateway.GetTrafficMetricsWithResponse` (client engendré) ; `gateway.ErrorFrom`, `a.relayedRefusal`.
- Produces (TS, `components['schemas']`) : `MetricsSummary { window: string; submitted: number; delivered: number; failed: number; rejected: number; moReceived: number; e2eLatencyMsP50: number | null; e2eLatencyMsP99: number | null; activeSessions: number | null }` ; `TrafficMetrics { groupBy: 'connector'|'customer'|'group'; window: string; series: { key: string; points: { t: string; submitted: number; delivered: number; failed: number }[] }[] }`. Champs camelCase côté BFF ; compteurs absents de l'amont → `0` (un compteur absent est un zéro de l'amont, contrairement aux latences et sessions, qui sont `null` = non mesuré).

- [ ] **Step 1: Contrat** — dans `api/openapi-bff.yaml`, avant `/operators:` :

```yaml
  /metrics/summary:
    get:
      operationId: getMetricsSummary
      summary: Les compteurs du trafic sur une fenêtre glissante
      description: |
        Relayée vers `get-metrics-summary`. Compte les messages **soumis** dans la fenêtre, chacun avec
        son statut au moment de la lecture : sur une fenêtre courte, des messages sont encore en vol.
        Une latence ou un nombre de sessions que l'amont ne mesure pas est `null`, jamais `0`.
      parameters:
        - { name: window, in: query, required: false, schema: { $ref: '#/components/schemas/MetricsWindow' } }
      responses:
        '200': { description: Les compteurs., content: { application/json: { schema: { $ref: '#/components/schemas/MetricsSummary' } } } }
        '400': { $ref: '#/components/responses/RequeteInvalide' }
        '401': { $ref: '#/components/responses/SessionAbsente' }
        '403': { $ref: '#/components/responses/PermissionRefusee' }
        '422': { $ref: '#/components/responses/RefusDeLaPasserelle' }
        '503': { $ref: '#/components/responses/PasserelleIndisponible' }
  /metrics/traffic:
    get:
      operationId: getTrafficMetrics
      summary: Les séries du trafic, par connecteur, client ou groupe
      description: |
        Relayée vers `get-traffic-metrics`. Tranches de 10 s (5m), 30 s (15m) ou une minute (30m, 1h).
        Les 20 clés les plus actives ont leur série, le reste est sommé sous `other`. Par connecteur, un
        message jamais dispatché n'apparaît dans aucune série ; par client, chaque message figure.
      parameters:
        - { name: window, in: query, required: false, schema: { $ref: '#/components/schemas/MetricsWindow' } }
        - { name: groupBy, in: query, required: false, schema: { $ref: '#/components/schemas/TrafficGroupBy' } }
      responses:
        '200': { description: Les séries., content: { application/json: { schema: { $ref: '#/components/schemas/TrafficMetrics' } } } }
        '400': { $ref: '#/components/responses/RequeteInvalide' }
        '401': { $ref: '#/components/responses/SessionAbsente' }
        '403': { $ref: '#/components/responses/PermissionRefusee' }
        '422': { $ref: '#/components/responses/RefusDeLaPasserelle' }
        '503': { $ref: '#/components/responses/PasserelleIndisponible' }
```

Schémas (avant `CurrentOperator:`) :

```yaml
    MetricsWindow:
      type: string
      enum: [5m, 15m, 30m, 1h]
    TrafficGroupBy:
      type: string
      enum: [connector, customer, group]
    MetricsSummary:
      type: object
      additionalProperties: false
      properties:
        window: { $ref: '#/components/schemas/MetricsWindow' }
        submitted: { type: integer }
        delivered: { type: integer }
        failed: { type: integer, description: Échoués ou expirés. }
        rejected: { type: integer }
        moReceived: { type: integer }
        e2eLatencyMsP50: { type: [number, 'null'] }
        e2eLatencyMsP99: { type: [number, 'null'] }
        activeSessions: { type: [integer, 'null'] }
      required: [window, submitted, delivered, failed, rejected, moReceived, e2eLatencyMsP50, e2eLatencyMsP99, activeSessions]
    TrafficPoint:
      type: object
      additionalProperties: false
      properties:
        t: { type: string, format: date-time }
        submitted: { type: integer }
        delivered: { type: integer }
        failed: { type: integer }
      required: [t, submitted, delivered, failed]
    TrafficSeries:
      type: object
      additionalProperties: false
      properties:
        key: { type: string, description: 'Identifiant de connecteur, client ou groupe, ou les clés réservées other et ungrouped.' }
        points: { type: array, items: { $ref: '#/components/schemas/TrafficPoint' } }
      required: [key, points]
    TrafficMetrics:
      type: object
      additionalProperties: false
      properties:
        groupBy: { $ref: '#/components/schemas/TrafficGroupBy' }
        window: { $ref: '#/components/schemas/MetricsWindow' }
        series: { type: array, items: { $ref: '#/components/schemas/TrafficSeries' } }
      required: [groupBy, window, series]
```

(Vérifier que le générateur accepte `type: [number, 'null']` — `MetricsSummary` de l'amont l'emploie, et `cmd/zodgen` doit le traduire ; sinon `nullable: true` selon ce que le reste de `openapi-bff.yaml` utilise : `grep -n "'null'\|nullable" api/openapi-bff.yaml`.)

Run: `make generate && go build ./...` → Expected: FAIL `missing method GetMetricsSummary`.

- [ ] **Step 2: Scénarios rouges** — `cmd/dashboard/traffic.feature` :

```gherkin
# language: fr
Fonctionnalité: L'instantané du trafic
  Le tableau de bord relaie les compteurs et les séries de l'API Admin à qui détient traffic:read.

  Contexte:
    Étant donné une installation avec un opérateur
    Et un serveur démarré

  Scénario: les compteurs des cinq dernières minutes sont relayés tels que le contrat les décrit
    Étant donné l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/summary?window=5m"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

  Scénario: les séries par client sont relayées telles que le contrat les décrit
    Étant donné l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/traffic?window=5m&groupBy=customer"
    Alors le serveur répond 200
    Et la réponse est conforme au contrat du BFF

  Scénario: sans traffic:read, le trafic est refusé et le refus nomme la clé
    Étant donné l'opérateur détient le rôle "Audit"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/summary"
    Alors le serveur répond 403
    Et la réponse porte 'traffic:read'
    Quand le navigateur demande "/api/metrics/traffic"
    Alors le serveur répond 403

  Scénario: une fenêtre que l'amont ne sert pas est refusée avant tout appel
    Étant donné l'opérateur détient le rôle "Support"
    Et l'opérateur ouvre une session élevée
    Quand le navigateur demande "/api/metrics/summary?window=24h"
    Alors le serveur répond 400
```

- [ ] **Step 3: Handlers** — `internal/bff/metrics.go` :

```go
package bff

import (
	"context"
	"net/http"

	"github.com/martialanouman/go-gateway-bo/internal/gateway"
)

const (
	operationGetMetricsSummary = "get-metrics-summary"
	operationGetTrafficMetrics = "get-traffic-metrics"
)

func (a API) GetMetricsSummary(ctx context.Context, request GetMetricsSummaryRequestObject,
) (GetMetricsSummaryResponseObject, error) {
	var params gateway.GetMetricsSummaryParams
	if request.Params.Window != nil {
		window := string(*request.Params.Window)
		params.Window = &window
	}

	response, err := a.Gateway.GetMetricsSummaryWithResponse(ctx, &params)
	if err == nil {
		err = gateway.ErrorFrom(response.StatusCode(), response.Body)
	}

	if err == nil && response.JSON200 == nil {
		err = gateway.ErrorFrom(http.StatusBadGateway, nil)
	}

	if err != nil {
		status, body, err := a.relayedRefusal(ctx, operationGetMetricsSummary, err)

		switch status {
		case http.StatusUnprocessableEntity:
			return GetMetricsSummary422JSONResponse{RefusDeLaPasserelleJSONResponse(body)}, nil
		case http.StatusServiceUnavailable:
			return GetMetricsSummary503JSONResponse{PasserelleIndisponibleJSONResponse(body)}, nil
		default:
			return nil, err
		}
	}

	summary := response.JSON200

	return GetMetricsSummary200JSONResponse{
		Window:          MetricsWindow(summary.Window),
		Submitted:       count(summary.Submitted),
		Delivered:       count(summary.Delivered),
		Failed:          count(summary.Failed),
		Rejected:        count(summary.Rejected),
		MoReceived:      count(summary.MoReceived),
		E2eLatencyMsP50: summary.E2eLatencyMsP50,
		E2eLatencyMsP99: summary.E2eLatencyMsP99,
		ActiveSessions:  summary.ActiveSessions,
	}, nil
}

// count lit un compteur absent comme zéro : l'amont omet un compteur vide, alors qu'une latence ou
// des sessions absentes disent « non mesuré » et restent nil.
func count(value *int) int {
	if value == nil {
		return 0
	}

	return *value
}
```

`GetTrafficMetrics` suit la même forme (params `Window`, `GroupBy` convertis en `*string` / `*gateway.GetTrafficMetricsParamsGroupBy`), puis :

```go
	metrics := response.JSON200
	series := make([]TrafficSeries, 0, len(metrics.Series))
	for _, s := range metrics.Series {
		points := make([]TrafficPoint, 0, len(s.Points))
		for _, p := range s.Points {
			points = append(points, TrafficPoint{T: p.T, Submitted: count(p.Submitted),
				Delivered: count(p.Delivered), Failed: count(p.Failed)})
		}
		series = append(series, TrafficSeries{Key: s.Key, Points: points})
	}

	return GetTrafficMetrics200JSONResponse{GroupBy: TrafficGroupBy(metrics.GroupBy),
		Window: MetricsWindow(metrics.Window), Series: series}, nil
```

Les types de pointeur (`*float32`, `*int`) suivent ce que `bff.gen.go` engendre : ajuster les conversions à la compilation, jamais le contrat.

`guard.go` : `"GetMetricsSummary": requires(permissions.TrafficRead),` et `"GetTrafficMetrics": requires(permissions.TrafficRead),`.

Doublures : ajouter `GetMetricsSummary` et `GetTrafficMetrics` à `failingAPI` (`contract_errors_test.go`, même forme que `IssueGatewayToken`) et à `testdata/compliant/compliant.go` (`return nil, nil`).

- [ ] **Step 4: Vert**

Run: `go test -count=1 ./internal/bff && DOCKER_HOST=… go test -count=1 -v ./cmd/dashboard -run 'TestScenarios/(les_compteurs|les_séries|sans_traffic|une_fenêtre)'`
Expected: 4 PASS. Si Prism rend un `window` hors énumération (exemple engendré `"string"`), le DTO échoue au contrat : alors l'énumération `window` de `MetricsSummary`/`TrafficMetrics` en **sortie** devient `type: string` (on ne promet pas ce que l'amont ne promet pas) et l'énumération ne reste qu'en paramètre.

- [ ] **Step 5: Commit** — `feat(step-080): routes /api/metrics/summary et /api/metrics/traffic`

---

### Task 3: Les calculs du trafic (module pur)

**Files:**
- Create: `web/src/lib/traffic.ts`
- Test: `web/src/lib/traffic.test.ts`

**Interfaces:**
- Consumes: `components['schemas']['MetricsSummary' | 'TrafficMetrics']` (Task 2).
- Produces:
  - `WINDOW_SECONDS = 300`
  - `perSecond(count: number): string` — `'27,4'` (une décimale, `fr-FR`)
  - `successRate(summary: MetricsSummary): string | null` — `null` quand aucune issue connue
  - `latency(ms: number | null): string | null` — `null` → non mesurée ; `'212 ms'` sous 1 000, `'1,24 s'` au-delà
  - `totals(metrics: TrafficMetrics): { t: string; submitted: number; delivered: number; failed: number }[]` — somme de **toutes** les séries par `t`, triée par `t`
  - `failureRatios(points: ReturnType<typeof totals>): number[]` — `failed/submitted`, `0` quand `submitted = 0`

- [ ] **Step 1: Tests rouges** — `traffic.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { failureRatios, latency, perSecond, successRate, totals } from './traffic'

const summary = {
  window: '5m', submitted: 9000, delivered: 8000, failed: 150, rejected: 50, moReceived: 600,
  e2eLatencyMsP50: 180, e2eLatencyMsP99: 1240, activeSessions: null,
} as const

describe('traffic figures', () => {
  it('turns a five-minute count into a per-second rate', () => {
    expect(perSecond(9000)).toBe('30,0')
  })

  it('rates success among the messages whose outcome is known', () => {
    expect(successRate(summary)).toBe('97,6')
  })

  it('has no success rate while no outcome is known', () => {
    expect(successRate({ ...summary, delivered: 0, failed: 0, rejected: 0 })).toBeNull()
  })

  it('keeps an unmeasured latency unmeasured instead of zero', () => {
    expect(latency(null)).toBeNull()
    expect(latency(212)).toBe('212 ms')
    expect(latency(1240)).toBe('1,24 s')
  })

  it('sums every series, other included, per bucket', () => {
    const points = totals({
      groupBy: 'customer', window: '5m',
      series: [
        { key: 'a', points: [{ t: '2026-10-10T10:00:10Z', submitted: 3, delivered: 2, failed: 1 }, { t: '2026-10-10T10:00:00Z', submitted: 1, delivered: 1, failed: 0 }] },
        { key: 'other', points: [{ t: '2026-10-10T10:00:10Z', submitted: 5, delivered: 4, failed: 0 }] },
      ],
    })
    expect(points).toEqual([
      { t: '2026-10-10T10:00:00Z', submitted: 1, delivered: 1, failed: 0 },
      { t: '2026-10-10T10:00:10Z', submitted: 8, delivered: 6, failed: 1 },
    ])
    expect(failureRatios(points)).toEqual([0, 0.125])
  })
})
```

- [ ] **Step 2: Rouge** — `pnpm -C web exec vitest run --coverage.enabled=false src/lib/traffic.test.ts` → FAIL (module absent).

- [ ] **Step 3: Implémenter** — `traffic.ts` :

```ts
import type { components } from '~/lib/api.gen'

type Summary = components['schemas']['MetricsSummary']
type Metrics = components['schemas']['TrafficMetrics']
export type TrafficPoint = components['schemas']['TrafficPoint']

export const WINDOW_SECONDS = 300

const oneDecimal = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const twoDecimals = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function perSecond(count: number) {
  return oneDecimal.format(count / WINDOW_SECONDS)
}

export function successRate({ delivered, failed, rejected }: Summary) {
  const known = delivered + failed + rejected
  return known === 0 ? null : oneDecimal.format((delivered / known) * 100)
}

export function latency(ms: number | null) {
  if (ms === null) return null
  return ms < 1000 ? `${Math.round(ms)} ms` : `${twoDecimals.format(ms / 1000)} s`
}

export function totals(metrics: Metrics): TrafficPoint[] {
  const byTime = new Map<string, TrafficPoint>()
  for (const series of metrics.series) {
    for (const point of series.points) {
      const sum = byTime.get(point.t) ?? { t: point.t, submitted: 0, delivered: 0, failed: 0 }
      byTime.set(point.t, {
        t: point.t,
        submitted: sum.submitted + point.submitted,
        delivered: sum.delivered + point.delivered,
        failed: sum.failed + point.failed,
      })
    }
  }
  return [...byTime.values()].sort((a, b) => a.t.localeCompare(b.t))
}

export function failureRatios(points: readonly TrafficPoint[]) {
  return points.map(({ submitted, failed }) => (submitted === 0 ? 0 : failed / submitted))
}
```

- [ ] **Step 4: Vert** — même commande → PASS.
- [ ] **Step 5: Commit** — `feat(step-080): calculs du trafic — débits, succès, latences, séries`

---

### Task 4: `MetricTile` et `Chart` (portés du kit)

**Files:**
- Create: `web/src/components/traffic/metric-tile.tsx`, `web/src/components/traffic/chart.tsx`, `web/src/components/traffic/traffic.css`
- Test: `web/src/components/traffic/chart.test.tsx`

**Interfaces:**
- Produces:
  - `MetricTile({ label: string; value: string | null; unit?: string; tone?: 'mt' | 'mo' })` — `value === null` → « non mesurée » en `text-faint`, sans unité.
  - `Chart({ label: string; primary: readonly number[]; secondary?: readonly number[]; height?: number })` — `role="img"`, `aria-label={label}` ; moins de deux points → rien de tracé (un `div` de même hauteur, pour ne pas faire sauter la mise en page).

Sources : `.claude/skills/sms-gateway-design/components/data/MetricTile.jsx` et `ui_kits/admin-console/AppShell.jsx` (`function Chart`, l. 67-83). Lire d'abord `MetricTile.prompt.md` (mémoire « maquette du kit avant un écran »).

- [ ] **Step 1: Test rouge** — `chart.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Chart } from './chart'
import { MetricTile } from './metric-tile'

describe('traffic primitives', () => {
  it('names the chart for assistive technologies and draws both series', () => {
    const { container } = render(<Chart label="Débit MT, soumis et remis" primary={[1, 3, 2]} secondary={[1, 2, 2]} />)
    expect(screen.getByRole('img', { name: 'Débit MT, soumis et remis' })).toBeVisible()
    expect(container.querySelectorAll('path')).toHaveLength(3)
  })

  it('draws nothing from a single point rather than a flat lie', () => {
    const { container } = render(<Chart label="Taux d’échec" primary={[0.1]} />)
    expect(container.querySelector('path')).toBeNull()
  })

  it('says unmeasured instead of zero', () => {
    render(<MetricTile label="Sessions actives" value={null} />)
    expect(screen.getByText('non mesurée')).toBeVisible()
    expect(screen.queryByText('0')).toBeNull()
  })
})
```

- [ ] **Step 2: Rouge** → FAIL (modules absents).

- [ ] **Step 3: Implémenter**

`chart.tsx` :

```tsx
import './traffic.css'

function path(values: readonly number[], max: number) {
  return values
    .map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 100).toFixed(2)},${(100 - (v / max) * 100).toFixed(2)}`)
    .join(' ')
}

export function Chart({ label, primary, secondary, height = 104 }: {
  readonly label: string
  readonly primary: readonly number[]
  readonly secondary?: readonly number[]
  readonly height?: number
}) {
  if (primary.length < 2) return <div aria-label={label} role="img" style={{ height }} />
  const max = Math.max(...primary, ...(secondary ?? []), 1) * 1.14
  const line = path(primary, max)
  return (
    <div aria-label={label} role="img" style={{ height }}>
      <svg aria-hidden="true" className="traffic-chart" preserveAspectRatio="none" viewBox="0 0 100 100">
        <line className="traffic-chart__grid" x1="0" x2="100" y1="33" y2="33" />
        <line className="traffic-chart__grid" x1="0" x2="100" y1="66" y2="66" />
        <path className="traffic-chart__area" d={`${line} L100,100 L0,100 Z`} />
        <path className="traffic-chart__line" d={line} />
        {secondary && secondary.length > 1 ? <path className="traffic-chart__secondary" d={path(secondary, max)} /> : null}
      </svg>
    </div>
  )
}
```

`metric-tile.tsx` (sans `delta` ni `live` : step-081) :

```tsx
import './traffic.css'

export function MetricTile({ label, value, unit, tone }: {
  readonly label: string
  readonly value: string | null
  readonly unit?: string
  readonly tone?: 'mt' | 'mo'
}) {
  return (
    <div className={tone ? `metric-tile metric-tile--${tone}` : 'metric-tile'}>
      <div className="metric-tile__label">{label}</div>
      {value === null ? (
        <div className="metric-tile__unmeasured">non mesurée</div>
      ) : (
        <div className="metric-tile__value">
          {value}
          {unit ? <span className="metric-tile__unit">{unit}</span> : null}
        </div>
      )}
    </div>
  )
}
```

`traffic.css` — jetons de data-viz **locaux** (pas dans `styles/tokens`, qui est la feuille d'entrée) ; reprendre les valeurs de `.claude/skills/sms-gateway-design/tokens/colors.css` l. 114-117 et les règles `.pl-metric*` de `components/components.css` l. 184-193 renommées `metric-tile*` :

```css
.traffic {
  --viz-primary: var(--teal-500);
  --viz-primary-area: color-mix(in srgb, var(--teal-500) 18%, transparent);
  --viz-secondary: var(--blue-500);
  --viz-grid: color-mix(in srgb, var(--n-50) 6%, transparent);
}
.traffic-chart { display: block; width: 100%; height: 100%; }
.traffic-chart__grid { stroke: var(--viz-grid); stroke-width: 0.4; }
.traffic-chart__area { fill: var(--viz-primary-area); }
.traffic-chart__line { fill: none; stroke: var(--viz-primary); stroke-width: 1.4; vector-effect: non-scaling-stroke; }
.traffic-chart__secondary { fill: none; stroke: var(--viz-secondary); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
.metric-tile { display: flex; flex-direction: column; gap: var(--sp-4); min-width: 0; padding: var(--sp-7); background: var(--surface-card); border: 1px solid var(--border-default); border-radius: var(--radius-card); }
.metric-tile__label { color: var(--text-faint); font: var(--text-overline); letter-spacing: var(--ls-caps); text-transform: uppercase; }
.metric-tile__value { display: flex; align-items: baseline; gap: var(--sp-3); color: var(--text-primary); font: var(--text-metric); letter-spacing: var(--ls-tight); white-space: nowrap; }
.metric-tile__unit { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-13); font-weight: var(--fw-regular); }
.metric-tile__unmeasured { color: var(--text-faint); font: var(--text-body); }
.metric-tile--mt .metric-tile__value { color: var(--mt-accent); }
.metric-tile--mo .metric-tile__value { color: var(--mo-accent); }
```

Vérifier que chaque variable utilisée existe dans `web/src/styles/tokens/*.css` (`grep -n -- '--text-metric\|--mt-accent\|--mo-accent\|--ls-caps\|--blue-500' web/src/styles/tokens/*.css`) ; une variable absente se remplace par la plus proche existante, jamais en ajoutant un jeton à la feuille d'entrée.

- [ ] **Step 4: Vert** — `pnpm -C web exec vitest run --coverage.enabled=false src/components/traffic` → PASS.
- [ ] **Step 5: Commit** — `feat(step-080): MetricTile et Chart, portés du kit`

---

### Task 5: L'écran `/traffic`

**Files:**
- Create: `web/src/components/traffic/traffic-screen.tsx`
- Modify: `web/src/routes/_shell.traffic.tsx`
- Modify: `web/test/session.ts` (réponses `GET /api/metrics/summary` et `GET /api/metrics/traffic`)
- Test: `web/src/routes/_shell.traffic.test.tsx`
- Generated: `web/src/routeTree.gen.ts` si l'arbre change (il ne devrait pas : la route existe)

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: `TrafficScreen()`.

- [ ] **Step 1: Décor** — `web/test/session.ts` : `AuthReplies` gagne `metricsSummary?` et `trafficMetrics?` ; deux `case` rendent par défaut un résumé (`submitted: 9000, delivered: 8000, failed: 150, rejected: 50, moReceived: 600, e2eLatencyMsP50: 180, e2eLatencyMsP99: 1240, activeSessions: null`) et deux séries de trois points. Les `case` matchent `GET /api/metrics/summary` et `GET /api/metrics/traffic` sur le `pathname` (la query n'y est pas).

- [ ] **Step 2: Tests rouges** — `_shell.traffic.test.tsx`, sur le modèle de `visitAccount` dans `_shell.account.test.tsx` (route `/traffic`, permissions `['traffic:read']`) :

```tsx
describe('the traffic screen', () => {
  it('shows the five figures of the last five minutes', async () => {
    await visitTraffic()
    expect(await screen.findByText('30,0')).toBeVisible()          // MT/s
    expect(screen.getByText('2,0')).toBeVisible()                  // MO/s
    expect(screen.getByText('97,6')).toBeVisible()                 // succès
    expect(screen.getByText('1,24 s')).toBeVisible()               // p99
    expect(screen.getByText('non mesurée')).toBeVisible()          // sessions
    expect(screen.getByRole('img', { name: /Débit MT/ })).toBeVisible()
    expect(screen.getByRole('img', { name: /Taux d’échec/ })).toBeVisible()
  })

  it('asks the gateway for the five-minute window, per customer', async () => {
    const { fetch } = await visitTraffic()
    await screen.findByText('30,0')
    const urls = fetch.mock.calls.map(([request]) => request.url)
    expect(urls.some((u) => u.endsWith('/api/metrics/summary?window=5m'))).toBe(true)
    expect(urls.some((u) => u.includes('/api/metrics/traffic?') && u.includes('groupBy=customer') && u.includes('window=5m'))).toBe(true)
  })

  it('says the window is empty rather than drawing zeros', async () => {
    await visitTraffic({ metricsSummary: { status: 200, body: { ...EMPTY_SUMMARY } } })
    expect(await screen.findByText('Aucun message soumis sur les cinq dernières minutes')).toBeVisible()
  })

  it('names the failure and offers a retry when the gateway is unavailable', async () => {
    await visitTraffic({ metricsSummary: { status: 503, body: { code: 'service_unavailable', message: 'La passerelle est indisponible.' } } })
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeVisible()
  })
})
```

- [ ] **Step 3: Rouge** → FAIL.

- [ ] **Step 4: Implémenter** — `traffic-screen.tsx` : `PageHeader title="Trafic"` ; deux `useQuery` (`queryKey: ['metrics', 'summary', '5m']` et `['metrics', 'traffic', '5m', 'customer']`, `refetchInterval: 10_000`, `queryFn` via `orRefusal(api.GET('/metrics/summary', { params: { query: { window: '5m' } } }), 'Le trafic n’a pas pu être lu')`) ; grille de cinq `MetricTile` (`MT / s` tone `mt`, `MO / s` tone `mo`, `Taux de succès` unit `%`, `Latence p50` / `Latence p99` — la maquette n'a que p99 : la spec §6.3 demande p50 et p99, donc **six** tuiles, `Sessions actives`) ; deux `Card` (`title="Débit MT"`, `title="Taux d’échec"`, sous-titre « 5 dernières minutes · tranches de 10 s ») contenant `Chart`. Racine `<div className="page traffic">` (porte les jetons locaux). États :
  - `isPending` → `LoadingState` + `Skeleton` à la hauteur des tuiles et des graphiques ;
  - `isError` sans données → `ErrorState` (`onRetry` refetch les deux) ; avec données en cache → `Banner` d'erreur au-dessus des valeurs conservées (« Les dernières valeurs restent affichées »), conformément à §1.9 ;
  - `submitted === 0` → `EmptyState title="Aucun message soumis sur les cinq dernières minutes"`, `description="Les compteurs reprennent dès le prochain message."`.
  Libellés accessibles des graphiques : `Débit MT, soumis et remis, ${n} tranches` et `Taux d’échec par tranche, maximum ${pct} %`.

  `_shell.traffic.tsx` :

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { TrafficScreen } from '~/components/traffic/traffic-screen'

export const Route = createFileRoute('/_shell/traffic')({ component: TrafficScreen })
```

- [ ] **Step 5: Vert + budget** — `pnpm -C web exec vitest run --coverage.enabled=false src/routes/_shell.traffic.test.tsx cold-load.test.ts` → PASS. Si `cold-load` rougit sur la feuille d'entrée, `traffic.css` y a fusionné : vérifier que **seul** `traffic-screen.tsx` (importé par le composant de route, que `autoCodeSplitting` diffère) importe `chart.tsx`/`metric-tile.tsx`, et qu'aucun fichier de l'entrée ne les importe. Ne **jamais** relever le budget.
- [ ] **Step 6: Commit** — `feat(step-080): écran Trafic — tuiles, graphiques, états`

---

### Task 6: Parcours e2e et faux amont

**Files:**
- Modify: `internal/fakegateway/` (nouveau fichier `metrics.go` : `MetricsSummaryPath = "/admin/metrics/summary"`, `TrafficMetricsPath = "/admin/metrics/traffic"`, deux handlers JSON fixes, conformes au contrat de l'amont)
- Modify: `scripts/fakegateway/main.go` (deux `mux.HandleFunc`)
- Modify: `web/e2e/shell.spec.ts` (après la section du jeton personnel)

- [ ] **Step 1: e2e rouge** — dans `shell.spec.ts` :

```ts
  // ── Le trafic des cinq dernières minutes ─────────────────────────────────────────────────────
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Trafic' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trafic')
  await expect(page.getByText('MT / s')).toBeVisible()
  await expect(page.getByRole('img', { name: /Débit MT/ })).toBeVisible()
```

Run: `DOCKER_HOST=… DASHBOARD_REDIS_NAMESPACE=e2e-local make e2e` (après `docker compose up -d`) → FAIL (le faux amont rend 404).

- [ ] **Step 2: Faux amont** — `internal/fakegateway/metrics.go` : deux `http.HandlerFunc` qui écrivent un JSON fixe (`{"window":"5m","submitted":9000,…}` et deux séries de trois points espacés de 10 s, `t` calculés depuis `time.Now().Truncate(10*time.Second)`), branchés dans `scripts/fakegateway/main.go`.
- [ ] **Step 3: Vert** — même commande → PASS.
- [ ] **Step 4: Commit** — `test(step-080): parcours e2e jusqu'à l'écran Trafic`

---

### Task 7: Le secret de `SecretShown` passe à la ligne

**Files:**
- Modify: `web/src/components/secret-shown.tsx`
- Test: `web/src/components/account-credentials.test.tsx` ou `web/src/routes/_shell.account.test.tsx` (là où `SecretShown` est déjà rendu)

- [ ] **Step 1: Test rouge** — dans `_shell.account.test.tsx`, test « shows the token once… » : `expect(within(dialog).getByText(GATEWAY_TOKEN)).toHaveStyle({ overflowWrap: 'anywhere' })`.
- [ ] **Step 2: Rouge** → FAIL.
- [ ] **Step 3: Implémenter** — `<p className="mono" style={{ overflowWrap: 'anywhere' }}>{secret}</p>` avec un commentaire d'une ligne : « En style porté : la feuille d'entrée n'a plus d'octet libre (`cold-load.test.ts`). »
- [ ] **Step 4: Vert** → PASS ; puis vérification navigateur (agent-browser, procédure de la session du 10/10/2026 : base e2e neuve, binaire sur :3101, enrôlement TOTP, « Délivrer ») : `scrollWidth ≤ clientWidth` sur `.ui-modal__body`.
- [ ] **Step 5: Commit** — `fix(step-080): le secret de SecretShown passe à la ligne`

---

### Task 8: Clôture

**Files:**
- Modify: `tasks/plan.md` §9 (« Nouvelles dépendances : virtualisation — version relevée à l'ajout, §1.2. Pas de bibliothèque de graphiques : SVG maison (step-080). »)
- Modify: `tasks/steps/step-080.md` (`Statut : FAIT`, emplacement `components/traffic/` au lieu de `components/ui`, tableau des mutations) puis `git mv` vers `done/`
- Modify: `tasks/todo.md` (case cochée)
- Delete: `debts/067-…` **si** `gh pr view 294 -R martialanouman/go-gateway --json state` rend `MERGED`, sinon porteur reporté sur step-081
- Delete: mémoire `cesure-secret-a-inclure-step-080` et sa ligne dans `MEMORY.md` (payée)

- [ ] **Step 1: Mutations** (worktree isolé, `web/node_modules` lié par symlink) — chacune doit rougir le test nommé :

| Mutation | Test attendu rouge |
|---|---|
| garde des deux routes sur `audit:read` (qu'Audit détient) | « sans traffic:read… » |
| permission retirée du feed `metrics.traffic` | « le trafic temps réel est refusé… » |
| `anyOf: []` remis sur l'entrée Trafic | `navigation.test.tsx` |
| `latency` rend `'0 ms'` pour `null` | `traffic.test.ts` « keeps an unmeasured latency… » |
| `totals` ne lit que `series[0]` | `traffic.test.ts` « sums every series… » |
| `successRate` sans `rejected` au dénominateur | `traffic.test.ts` « rates success… » |
| `MetricTile` affiche `'0'` pour `null` | `chart.test.tsx` « says unmeasured… » |
| `window: '1h'` dans l'écran | `_shell.traffic.test.tsx` « asks the gateway… » |
| `style` retiré de `SecretShown` | test de Task 7 |

- [ ] **Step 2: DoD** — `DOCKER_HOST=… make check` (sans pipe : lire le RC), e2e vert.
- [ ] **Step 3: Commit** — `docs(step-080): mutations, fiche close` ; puis revue en sous-agent lecture seule, rebouclée jusqu'à zéro bloquant ; PR ; merge **seulement** avec l'accord de l'utilisateur.

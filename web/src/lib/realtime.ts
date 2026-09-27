import type { components } from './api.gen'

type Schemas = components['schemas']

export type Topic = Schemas['RealtimeTopic']
export type TopicData = {
  'metrics.traffic': Schemas['TrafficSnapshot']
  'sessions.events': Schemas['SessionEvent']
  'billing.alerts': Schemas['BillingAlert']
}
export type TopicState<T extends Topic> = {
  readonly data?: TopicData[T]
  readonly ts?: string
  readonly isLive: boolean
  readonly isStale: boolean
  readonly since?: Date
  readonly error?: Schemas['Error']
}
export type Phase = 'connecting' | 'open' | 'closed' | 'ended'
export type Summary = { readonly phase: Phase; readonly topics: readonly TopicState<Topic>[] }

export const STALE_AFTER_MS = 3000
export const FIRST_BACKOFF_MS = 1000
export const MAX_BACKOFF_MS = 30_000
const SESSION_ENDED = 4401

type Listener = (data: TopicData[Topic], ts: string) => void
type Incoming = Schemas['RealtimeData'] | Schemas['RealtimeStatus'] | Schemas['RealtimeRefusal']

type Entry = {
  count: number
  readonly listeners: Set<Listener>
  status?: Schemas['RealtimeStatus']['status']
  since?: Date
  data?: TopicData[Topic]
  ts?: string
  error?: Schemas['Error']
  // Un sujet refusé pour de bon n'est pas réabonné à l'ouverture : le serveur le refuserait à chaque fois.
  denied: boolean
  snapshot?: TopicState<Topic>
}

const UNSUBSCRIBED: TopicState<Topic> = Object.freeze({ isLive: false, isStale: false })
const DEFINITIVE_REFUSALS = new Set(['permission_denied', 'unknown_topic'])

export function realtimeURL(location: Pick<Location, 'protocol' | 'host'>) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
}

export class RealtimeConnection {
  readonly #url: string
  readonly #onSessionEnded: () => void
  readonly #random: () => number
  readonly #entries = new Map<Topic, Entry>()
  readonly #watchers = new Set<() => void>()
  #socket: WebSocket | null = null
  #phase: Phase = 'closed'
  #summary: Summary | null = null
  #attempt = 0
  #reconnectTimer?: ReturnType<typeof setTimeout>
  #staleTimer?: ReturnType<typeof setTimeout>

  constructor(url: string, onSessionEnded: () => void, random: () => number = Math.random) {
    this.#url = url
    this.#onSessionEnded = onSessionEnded
    this.#random = random
  }

  start() {
    if (this.#socket) return
    clearTimeout(this.#reconnectTimer)
    const socket = new WebSocket(this.#url)
    socket.onopen = () => this.#onOpen()
    socket.onmessage = (event: MessageEvent<string>) =>
      this.#onMessage(JSON.parse(event.data) as Incoming)
    socket.onclose = (event: CloseEvent) => this.#onClose(event.code)
    this.#socket = socket
    this.#setPhase('connecting')
  }

  stop() {
    clearTimeout(this.#reconnectTimer)
    clearTimeout(this.#staleTimer)
    const socket = this.#socket
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = null
    socket.close(1000)
    this.#socket = null
    this.#forgetStatuses()
    this.#setPhase('closed')
  }

  subscribe<T extends Topic>(topic: T, onMessage?: (data: TopicData[T], ts: string) => void) {
    let entry = this.#entries.get(topic)
    if (!entry) {
      entry = { count: 0, listeners: new Set(), denied: false }
      this.#entries.set(topic, entry)
    }
    const listener = onMessage as Listener | undefined
    if (listener) entry.listeners.add(listener)
    entry.count += 1
    if (entry.count === 1) {
      this.#send('subscribe', [topic])
      this.#changed([entry])
    }

    let left = false
    return () => {
      if (left) return
      left = true
      if (listener) entry.listeners.delete(listener)
      entry.count -= 1
      if (entry.count > 0) return
      this.#send('unsubscribe', [topic])
      this.#entries.delete(topic)
      this.#changed([])
    }
  }

  topic<T extends Topic>(topic: T): TopicState<T> {
    const entry = this.#entries.get(topic)
    if (!entry) return UNSUBSCRIBED as TopicState<T>
    entry.snapshot ??= Object.freeze({
      data: entry.data,
      ts: entry.ts,
      isLive: this.#phase === 'open' && entry.status === 'live',
      isStale: entry.status === 'stale',
      since: entry.since,
      error: entry.error,
    })
    return entry.snapshot as TopicState<T>
  }

  summary(): Summary {
    this.#summary ??= Object.freeze({
      phase: this.#phase,
      topics: Object.freeze([...this.#entries.keys()].map((topic) => this.topic(topic))),
    })
    return this.#summary
  }

  watch(listener: () => void) {
    this.#watchers.add(listener)
    return () => {
      this.#watchers.delete(listener)
    }
  }

  #onOpen() {
    this.#attempt = 0
    clearTimeout(this.#staleTimer)
    this.#setPhase('open')
    const topics = [...this.#entries].filter(([, entry]) => !entry.denied).map(([topic]) => topic)
    if (topics.length > 0) this.#send('subscribe', topics)
  }

  #onClose(code: number) {
    this.#socket = null
    // Seule la perte d'une socket ouverte date la coupure : une tentative de reconnexion qui échoue
    // ne la fait pas recommencer.
    const wasOpen = this.#phase === 'open'
    if (wasOpen) this.#forgetStatuses()
    if (code === SESSION_ENDED) {
      this.#setPhase('ended')
      this.#onSessionEnded()
      return
    }
    if (wasOpen) {
      const closedAt = new Date()
      this.#staleTimer = setTimeout(() => this.#markStale(closedAt), STALE_AFTER_MS)
    }
    this.#setPhase('closed')
    // Gigue pleine : des navigateurs coupés ensemble ne reviennent pas ensemble.
    const delay = this.#random() * Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** this.#attempt)
    this.#attempt += 1
    this.#reconnectTimer = setTimeout(() => this.start(), delay)
  }

  // Un sujet déjà périmé garde son `since` : « périmé depuis » ne doit jamais rajeunir la donnée.
  #forgetStatuses() {
    for (const entry of this.#entries.values()) {
      if (entry.status === 'stale') continue
      entry.status = undefined
      entry.since = undefined
    }
  }

  #markStale(closedAt: Date) {
    const unknown = [...this.#entries.values()].filter(
      (entry) => entry.status === undefined && !entry.denied,
    )
    for (const entry of unknown) {
      entry.status = 'stale'
      entry.since = closedAt
    }
    this.#changed(unknown)
  }

  #onMessage(message: Incoming) {
    const entry = message.topic ? this.#entries.get(message.topic as Topic) : undefined
    if (!entry) return
    if ('error' in message) {
      entry.error = message.error
      entry.denied ||= DEFINITIVE_REFUSALS.has(message.error.code)
    } else if ('status' in message) {
      entry.status = message.status
      entry.since = message.since ? new Date(message.since) : undefined
    } else {
      entry.data = message.data
      entry.ts = message.ts
      for (const listener of entry.listeners) listener(message.data, message.ts)
    }
    this.#changed([entry])
  }

  #send(action: Schemas['RealtimeRequest']['action'], topics: Topic[]) {
    if (this.#socket?.readyState !== WebSocket.OPEN) return
    this.#socket.send(JSON.stringify({ action, topics } satisfies Schemas['RealtimeRequest']))
  }

  #setPhase(phase: Phase) {
    this.#phase = phase
    this.#changed(this.#entries.values())
  }

  #changed(entries: Iterable<Entry>) {
    for (const entry of entries) entry.snapshot = undefined
    this.#summary = null
    for (const watcher of this.#watchers) watcher()
  }
}

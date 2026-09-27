import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeWebSocket } from '../../test/websocket'
import {
  FIRST_BACKOFF_MS,
  MAX_BACKOFF_MS,
  RealtimeConnection,
  realtimeURL,
  STALE_AFTER_MS,
  useRealtimeSummary,
  useTopic,
} from './realtime'

const alert = {
  customerId: 'c1',
  ownerType: 'account',
  ownerId: 'a1',
  alert: 'mo_floor_reached',
  balance: 12,
}

function openConnection(onSessionEnded = () => {}, random = () => 0.5) {
  const connection = new RealtimeConnection('wss://bo.example/ws', onSessionEnded, random)
  connection.start()
  const socket = FakeWebSocket.latest()
  socket.open()
  return { connection, socket }
}

describe('realtimeURL', () => {
  it('targets /ws on the origin that served the page, secure when the page is', () => {
    expect(realtimeURL({ protocol: 'https:', host: 'bo.example' })).toBe('wss://bo.example/ws')
    expect(realtimeURL({ protocol: 'http:', host: 'localhost:8080' })).toBe(
      'ws://localhost:8080/ws',
    )
  })
})

describe('RealtimeConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends a single subscribe for two subscribers of one topic', () => {
    const { connection, socket } = openConnection()

    connection.subscribe('billing.alerts')
    connection.subscribe('billing.alerts')

    expect(socket.sent).toEqual([{ action: 'subscribe', topics: ['billing.alerts'] }])
  })

  it('unsubscribes only when the last subscriber leaves', () => {
    const { connection, socket } = openConnection()
    const leaveFirst = connection.subscribe('billing.alerts')
    const leaveSecond = connection.subscribe('billing.alerts')

    leaveFirst()
    leaveFirst()
    expect(socket.sent).toEqual([{ action: 'subscribe', topics: ['billing.alerts'] }])

    leaveSecond()
    expect(socket.sent.at(-1)).toEqual({ action: 'unsubscribe', topics: ['billing.alerts'] })
    expect(socket.sent).toHaveLength(2)
  })

  it('subscribes pending topics in one message once the socket opens', () => {
    const connection = new RealtimeConnection('wss://bo.example/ws', () => {})
    connection.start()
    const socket = FakeWebSocket.latest()
    connection.subscribe('billing.alerts')
    connection.subscribe('metrics.traffic')
    connection.subscribe('sessions.events')()

    socket.open()

    expect(socket.url).toBe('wss://bo.example/ws')
    expect(socket.sent).toEqual([
      { action: 'subscribe', topics: ['billing.alerts', 'metrics.traffic'] },
    ])
  })

  it('keeps the last frame and hands each frame to the listeners', () => {
    const { connection, socket } = openConnection()
    const onMessage = vi.fn()
    connection.subscribe('billing.alerts', onMessage)
    const second = { ...alert, balance: 3 }

    socket.receive({ topic: 'billing.alerts', ts: '2026-09-27T10:00:00Z', data: alert })
    socket.receive({ topic: 'billing.alerts', ts: '2026-09-27T10:00:05Z', data: second })

    expect(onMessage.mock.calls).toEqual([
      [alert, '2026-09-27T10:00:00Z'],
      [second, '2026-09-27T10:00:05Z'],
    ])
    expect(connection.topic('billing.alerts')).toMatchObject({
      data: second,
      ts: '2026-09-27T10:00:05Z',
    })
  })

  it('reports live only while the socket is open and the server says live', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('metrics.traffic')
    expect(connection.topic('metrics.traffic')).toMatchObject({ isLive: false, isStale: false })

    socket.receive({ topic: 'metrics.traffic', status: 'live' })
    expect(connection.topic('metrics.traffic')).toMatchObject({ isLive: true, isStale: false })
    expect(connection.summary().phase).toBe('open')

    socket.receive({ topic: 'metrics.traffic', status: 'stale', since: '2026-09-27T09:58:00Z' })
    expect(connection.topic('metrics.traffic')).toMatchObject({
      isLive: false,
      isStale: true,
      since: new Date('2026-09-27T09:58:00Z'),
    })

    socket.receive({ topic: 'metrics.traffic', status: 'live' })
    socket.close(1001)
    expect(connection.topic('metrics.traffic').isLive).toBe(false)
    expect(connection.summary().phase).toBe('closed')
  })

  it('records a permission refusal and does not resubscribe the topic', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('billing.alerts')
    connection.subscribe('metrics.traffic')
    const refusal = { code: 'permission_denied', message: 'La permission billing:read manque.' }

    socket.receive({ topic: 'billing.alerts', error: refusal })
    socket.close(1008)
    vi.advanceTimersByTime(FIRST_BACKOFF_MS)
    const next = FakeWebSocket.latest()
    next.open()

    expect(connection.topic('billing.alerts').error).toEqual(refusal)
    expect(next.sent).toEqual([{ action: 'subscribe', topics: ['metrics.traffic'] }])
  })

  it('forgets the refusal once the topic has no subscriber left', () => {
    const { connection, socket } = openConnection()
    const leave = connection.subscribe('billing.alerts')
    socket.receive({
      topic: 'billing.alerts',
      error: { code: 'unknown_topic', message: 'Sujet inconnu.' },
    })

    leave()
    connection.subscribe('billing.alerts')

    expect(socket.sent.at(-1)).toEqual({ action: 'subscribe', topics: ['billing.alerts'] })
    expect(connection.topic('billing.alerts').error).toBeUndefined()
  })

  it('keeps snapshots identical until something changes, then notifies watchers', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('metrics.traffic')
    const watcher = vi.fn()
    const unwatch = connection.watch(watcher)
    const topicBefore = connection.topic('metrics.traffic')
    const summaryBefore = connection.summary()

    expect(connection.topic('metrics.traffic')).toBe(topicBefore)
    expect(connection.summary()).toBe(summaryBefore)
    expect(connection.topic('billing.alerts')).toBe(connection.topic('billing.alerts'))

    socket.receive({ topic: 'metrics.traffic', status: 'live' })

    expect(watcher).toHaveBeenCalledTimes(1)
    expect(connection.topic('metrics.traffic')).not.toBe(topicBefore)
    expect(connection.summary()).not.toBe(summaryBefore)
    expect(connection.summary().topics).toEqual([connection.topic('metrics.traffic')])

    unwatch()
    socket.receive({ topic: 'metrics.traffic', status: 'stale' })
    expect(watcher).toHaveBeenCalledTimes(1)
  })

  it('closes the socket on stop and ignores what arrives after', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('billing.alerts')

    connection.stop()
    socket.receive({ topic: 'billing.alerts', ts: '2026-09-27T10:00:00Z', data: alert })

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED)
    expect(connection.summary().phase).toBe('closed')
    expect(connection.topic('billing.alerts').data).toBeUndefined()
  })

  it('reconnects after an abnormal close and resubscribes live topics only', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('metrics.traffic')
    connection.subscribe('billing.alerts')
    connection.subscribe('sessions.events')()
    socket.receive({
      topic: 'billing.alerts',
      error: { code: 'permission_denied', message: 'La permission billing:read manque.' },
    })

    socket.close(1006)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(FIRST_BACKOFF_MS)
    expect(FakeWebSocket.instances).toHaveLength(2)
    const next = FakeWebSocket.latest()
    next.open()

    expect(connection.summary().phase).toBe('open')
    expect(next.sent).toEqual([{ action: 'subscribe', topics: ['metrics.traffic'] }])
  })

  it('never reconnects after 4401 and reports the session ended', () => {
    const onSessionEnded = vi.fn()
    const { connection, socket } = openConnection(onSessionEnded)
    connection.subscribe('metrics.traffic')

    socket.close(4401)
    vi.advanceTimersByTime(60_000)

    expect(onSessionEnded).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(connection.summary().phase).toBe('ended')
    expect(connection.topic('metrics.traffic').isStale).toBe(false)
  })

  it('reconnects after 1008', () => {
    const onSessionEnded = vi.fn()
    const { socket } = openConnection(onSessionEnded)

    socket.close(1008)
    vi.advanceTimersByTime(FIRST_BACKOFF_MS)

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(onSessionEnded).not.toHaveBeenCalled()
  })

  it('is not stale 2999 ms after a close, and stale at 3000 ms, keeping its data', () => {
    const closedAt = new Date('2026-09-27T10:00:00Z')
    const { connection, socket } = openConnection()
    connection.subscribe('billing.alerts')
    socket.receive({ topic: 'billing.alerts', status: 'live' })
    socket.receive({ topic: 'billing.alerts', ts: '2026-09-27T09:59:00Z', data: alert })

    vi.setSystemTime(closedAt)
    socket.close(1006)
    expect(connection.topic('billing.alerts')).toMatchObject({ isLive: false, isStale: false })

    vi.advanceTimersByTime(STALE_AFTER_MS - 1)
    expect(connection.topic('billing.alerts').isStale).toBe(false)

    vi.advanceTimersByTime(1)
    expect(connection.topic('billing.alerts')).toMatchObject({
      isLive: false,
      isStale: true,
      since: closedAt,
      data: alert,
      ts: '2026-09-27T09:59:00Z',
    })
  })

  it('does not go stale when the socket reopens within the tolerance, after a failed retry', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('metrics.traffic')
    socket.receive({ topic: 'metrics.traffic', status: 'live' })

    socket.close(1006)
    vi.advanceTimersByTime(FIRST_BACKOFF_MS)
    FakeWebSocket.latest().close(1006)
    vi.advanceTimersByTime(FIRST_BACKOFF_MS)
    FakeWebSocket.latest().open()
    vi.advanceTimersByTime(STALE_AFTER_MS)

    expect(connection.topic('metrics.traffic')).toMatchObject({ isLive: false, isStale: false })
  })

  it('keeps the original cut while reconnect attempts fail', () => {
    const cutAt = new Date('2026-09-27T10:00:00Z')
    const { connection, socket } = openConnection()
    connection.subscribe('metrics.traffic')
    socket.receive({ topic: 'metrics.traffic', status: 'live' })

    vi.setSystemTime(cutAt)
    socket.close(1006)
    vi.advanceTimersByTime(FIRST_BACKOFF_MS)
    FakeWebSocket.latest().close(1006)
    vi.advanceTimersByTime(STALE_AFTER_MS - FIRST_BACKOFF_MS)
    expect(connection.topic('metrics.traffic')).toMatchObject({ isStale: true, since: cutAt })
    for (let failure = 0; failure < 2; failure++) {
      FakeWebSocket.latest().close(1006)
      expect(connection.topic('metrics.traffic')).toMatchObject({ isStale: true, since: cutAt })
      vi.advanceTimersByTime(MAX_BACKOFF_MS)
    }

    expect(FakeWebSocket.instances).toHaveLength(5)
    expect(connection.topic('metrics.traffic')).toMatchObject({ isStale: true, since: cutAt })
  })

  it('never marks a refused topic stale', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('billing.alerts')
    socket.receive({
      topic: 'billing.alerts',
      error: { code: 'permission_denied', message: 'La permission billing:read manque.' },
    })

    socket.close(1006)
    vi.advanceTimersByTime(STALE_AFTER_MS)

    expect(connection.topic('billing.alerts').isStale).toBe(false)
  })

  it('keeps the earlier since of a topic the server already reported stale', () => {
    const staleSince = new Date('2026-09-27T09:58:00Z')
    const { connection, socket } = openConnection()
    connection.subscribe('metrics.traffic')
    socket.receive({ topic: 'metrics.traffic', status: 'stale', since: staleSince.toISOString() })

    vi.setSystemTime(new Date('2026-09-27T10:00:00Z'))
    socket.close(1006)
    expect(connection.topic('metrics.traffic')).toMatchObject({ isStale: true, since: staleSince })

    vi.advanceTimersByTime(STALE_AFTER_MS)
    expect(connection.topic('metrics.traffic')).toMatchObject({ isStale: true, since: staleSince })
  })

  it('exposes no since once a live status is forgotten', () => {
    const { connection, socket } = openConnection()
    connection.subscribe('metrics.traffic')
    socket.receive({ topic: 'metrics.traffic', status: 'live', since: '2026-09-27T09:00:00Z' })

    socket.close(1006)

    expect(connection.topic('metrics.traffic')).toMatchObject({ isStale: false, since: undefined })
  })

  it('caps the backoff at 30 s and resets it after an open', () => {
    const random = () => 0.999
    openConnection(() => {}, random)

    function expectReconnectAfter(delay: number) {
      const before = FakeWebSocket.instances.length
      FakeWebSocket.latest().close(1006)
      vi.advanceTimersByTime(Math.ceil(delay) - 1)
      expect(FakeWebSocket.instances).toHaveLength(before)
      vi.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(before + 1)
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      expectReconnectAfter(random() * Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** attempt))
    }
    expectReconnectAfter(random() * MAX_BACKOFF_MS)

    FakeWebSocket.latest().open()
    expectReconnectAfter(random() * FIRST_BACKOFF_MS)
  })

  it('leaves no timer behind and never reconnects once stopped', () => {
    const onSessionEnded = vi.fn()
    const { connection, socket } = openConnection(onSessionEnded)
    connection.subscribe('metrics.traffic')
    socket.close(1006)
    connection.start()
    const next = FakeWebSocket.latest()
    next.open()
    next.close(1011)

    connection.stop()

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(onSessionEnded).not.toHaveBeenCalled()
  })
})

describe('the realtime hooks', () => {
  it('refuse to run outside the provider the shell mounts', () => {
    expect(() => renderHook(() => useTopic('billing.alerts'))).toThrow(/RealtimeProvider/)
    expect(() => renderHook(() => useRealtimeSummary())).toThrow(/RealtimeProvider/)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { FakeWebSocket } from '../../test/websocket'
import { RealtimeConnection, realtimeURL } from './realtime'

const alert = {
  customerId: 'c1',
  ownerType: 'account',
  ownerId: 'a1',
  alert: 'mo_floor_reached',
  balance: 12,
}

function openConnection() {
  const connection = new RealtimeConnection('wss://bo.example/ws')
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
    const connection = new RealtimeConnection('wss://bo.example/ws')
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
    connection.start()
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
})

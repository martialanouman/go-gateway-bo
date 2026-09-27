/**
 * Le `WebSocket` du navigateur, remplacé à la frontière : jsdom n'a pas de BFF. Il ne se connecte
 * jamais seul — le test décide de l'ouverture, des trames et de la fermeture.
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly sent: unknown[] = []
  readyState = FakeWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(message: string) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('envoi sur une socket non ouverte')
    this.sent.push(JSON.parse(message))
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  receive(message: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close', { code }))
  }

  static latest() {
    const socket = FakeWebSocket.instances.at(-1)
    if (!socket) throw new Error('aucune socket ouverte')
    return socket
  }
}

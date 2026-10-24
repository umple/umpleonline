import { describe, it, expect } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import { getCollabStats, setupWSConnection } from '../src/sync'

class Client extends EventEmitter {
  readyState = 1
  binaryType = ''
  send(_message: unknown, _options: unknown, callback: () => void) { callback() }
  close() { this.readyState = 3; this.emit('close') }
  ping() {}
}

describe('collaboration session metrics', () => {
  it('counts room lifetimes, collaboration once per room and the peak per room', () => {
    const before = getCollabStats()
    const clients: Client[] = []
    const connect = (room: string) => {
      const client = new Client()
      clients.push(client)
      setupWSConnection(client as unknown as WebSocket, {} as IncomingMessage, { docName: room })
      return client
    }
    try {
      const first = connect('metrics-a')
      connect('metrics-a')
      connect('metrics-b')
      let stats = getCollabStats()
      expect(stats.numberOfActiveUsers).toBe(3)
      expect(stats.numberOfActiveSessions).toBe(2)
      expect(stats.sessionsInitiatedSinceStart - before.sessionsInitiatedSinceStart).toBe(2)
      expect(stats.sessionsCollaboratedSinceStart - before.sessionsCollaboratedSinceStart).toBe(1)
      expect(stats.maxConcurrentCollaborators).toBe(2)
      first.close()
      connect('metrics-a')
      stats = getCollabStats()
      expect(stats.sessionsCollaboratedSinceStart - before.sessionsCollaboratedSinceStart).toBe(1)
      clients.forEach(client => client.close())
      expect(getCollabStats().numberOfActiveSessions).toBe(0)
      connect('metrics-a')
      expect(getCollabStats().sessionsInitiatedSinceStart - before.sessionsInitiatedSinceStart).toBe(3)
    } finally { clients.forEach(client => client.close()) }
  })
})

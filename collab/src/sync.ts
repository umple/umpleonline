import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

const WS_READY_STATE_CONNECTING = 0
const WS_READY_STATE_OPEN = 1

const PING_TIMEOUT = 30_000

const gcEnabled = process.env.GC !== 'false' && process.env.GC !== '0'

// ── Shared doc with connection tracking ─────────────────────────

class WSSharedDoc extends Y.Doc {
  name: string
  collaborated = false
  conns = new Map<WebSocket, Set<number>>()
  awareness: awarenessProtocol.Awareness

  constructor(name: string) {
    super({ gc: gcEnabled })
    this.name = name
    this.awareness = new awarenessProtocol.Awareness(this)
    this.awareness.setLocalState(null)

    this.awareness.on('update', ({ added, updated, removed }: {
      added: number[]; updated: number[]; removed: number[]
    }, conn: WebSocket | null) => {
      const changed = added.concat(updated, removed)
      if (conn !== null) {
        const ids = this.conns.get(conn)
        if (ids) {
          added.forEach((id) => ids.add(id))
          removed.forEach((id) => ids.delete(id))
        }
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      )
      const msg = encoding.toUint8Array(encoder)
      this.conns.forEach((_, c) => send(this, c, msg))
    })

    this.on('update', (update: Uint8Array, _origin: unknown) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      const msg = encoding.toUint8Array(encoder)
      this.conns.forEach((_, c) => send(this, c, msg))
    })
  }
}

// ── Doc registry ────────────────────────────────────────────────

const docs = new Map<string, WSSharedDoc>()
let sessionsInitiatedSinceStart = 0
let sessionsCollaboratedSinceStart = 0
let maxConcurrentCollaborators = 0

function getOrCreateDoc(name: string): WSSharedDoc {
  let doc = docs.get(name)
  if (doc) return doc
  doc = new WSSharedDoc(name)
  docs.set(name, doc)
  sessionsInitiatedSinceStart += 1
  return doc
}

// ── Message handling ────────────────────────────────────────────

function onMessage(conn: WebSocket, doc: WSSharedDoc, data: Uint8Array) {
  try {
    const encoder = encoding.createEncoder()
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder))
        }
        break
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        )
        break
      }
    }
  } catch (err) {
    console.error('[collab] message error:', err)
  }
}

// ── Connection helpers ──────────────────────────────────────────

function closeConn(doc: WSSharedDoc, conn: WebSocket) {
  const ids = doc.conns.get(conn)
  if (!ids) return
  doc.conns.delete(conn)
  awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(ids), null)
  if (doc.conns.size === 0) {
    doc.destroy()
    docs.delete(doc.name)
  }
  conn.close()
}

function send(doc: WSSharedDoc, conn: WebSocket, msg: Uint8Array) {
  if (conn.readyState !== WS_READY_STATE_CONNECTING && conn.readyState !== WS_READY_STATE_OPEN) {
    closeConn(doc, conn)
    return
  }
  try {
    conn.send(msg, {}, (err) => { if (err) closeConn(doc, conn) })
  } catch {
    closeConn(doc, conn)
  }
}

// ── Public API ──────────────────────────────────────────────────

export function setupWSConnection(
  conn: WebSocket,
  _req: IncomingMessage,
  opts: { docName: string },
) {
  conn.binaryType = 'arraybuffer'
  const doc = getOrCreateDoc(opts.docName)
  doc.conns.set(conn, new Set())
  if (doc.conns.size > 1 && !doc.collaborated) {
    doc.collaborated = true
    sessionsCollaboratedSinceStart += 1
  }
  maxConcurrentCollaborators = Math.max(maxConcurrentCollaborators, doc.conns.size)

  conn.on('message', (raw: ArrayBuffer) => onMessage(conn, doc, new Uint8Array(raw)))

  // Ping/pong liveness
  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) closeConn(doc, conn)
      clearInterval(pingInterval)
    } else if (doc.conns.has(conn)) {
      pongReceived = false
      try { conn.ping() } catch { closeConn(doc, conn); clearInterval(pingInterval) }
    }
  }, PING_TIMEOUT)

  conn.on('close', () => { closeConn(doc, conn); clearInterval(pingInterval) })
  conn.on('pong', () => { pongReceived = true })

  // Send sync step 1
  {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, doc)
    send(doc, conn, encoding.toUint8Array(encoder))
  }

  // Send current awareness states
  const states = doc.awareness.getStates()
  if (states.size > 0) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())),
    )
    send(doc, conn, encoding.toUint8Array(encoder))
  }
}

export function getCollabStats() {
  let activeConnections = 0
  let awarenessStates = 0

  docs.forEach((doc) => {
    activeConnections += doc.conns.size
    awarenessStates += doc.awareness.getStates().size
  })

  return {
    activeRooms: docs.size,
    activeConnections,
    awarenessStates,
    numberOfActiveUsers: activeConnections,
    numberOfActiveSessions: docs.size,
    sessionsInitiatedSinceStart,
    sessionsCollaboratedSinceStart,
    maxConcurrentCollaborators,
  }
}

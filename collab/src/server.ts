import http from 'node:http'
import { WebSocketServer } from 'ws'
import { getCollabStats, setupWSConnection } from './sync.js'

const PORT = parseInt(process.env.PORT ?? '3002', 10)
const startedAt = Date.now()
let totalConnectionsStarted = 0
let maxConcurrentConnections = 0

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  if (req.url === '/status') {
    const stats = getCollabStats()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      nodeVersion: process.version,
      hostname: process.env.HOSTNAME,
      sessionDefinition: 'A room lifetime; users are connected clients; peak collaborators is per room',
      port: PORT,
      pid: process.pid,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      totalConnectionsStarted,
      maxConcurrentConnections,
      ...stats,
    }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const match = url.pathname.match(/^\/ws\/collab\/(.+)$/)
  let roomId: string
  try {
    roomId = decodeURIComponent(match?.[1] ?? 'default')
  } catch {
    roomId = match?.[1] ?? 'default'
  }

  console.log(`[collab] client connected to room "${roomId}" (url: ${req.url})`)
  totalConnectionsStarted += 1

  setupWSConnection(ws, req, { docName: roomId })
  maxConcurrentConnections = Math.max(maxConcurrentConnections, getCollabStats().activeConnections)

  ws.on('close', () => {
    console.log(`[collab] client disconnected from room "${roomId}"`)
  })
})

server.listen(PORT, () => {
  console.log(`Collab server listening on port ${PORT}`)
})

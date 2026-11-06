"use strict";

const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const url = require("url");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const LSP_PORT = parseInt(process.env.LSP_PORT || "9999", 10);
const UMP_BASE_DIR = process.env.UMP_BASE_DIR || "/data/models";
const LSP_COMMAND = process.env.LSP_COMMAND || "umple-lsp-server";
const UMPLESYNC_JAR_PATH = process.env.UMPLESYNC_JAR_PATH || "";
const LSP_DEBUG = process.env.LSP_DEBUG === "1";
const MAX_PROCESSES_GLOBAL = parseInt(process.env.LSP_MAX_PROCESSES || "20", 10);

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Active sessions: one LSP process per WebSocket connection
// ---------------------------------------------------------------------------
const activeSessions = new Map();
let connectionCounter = 0;
let totalSessionsStarted = 0;
let rejectedConnections = 0;
let maxConcurrentSessions = 0;
const startedAt = Date.now();

function log(msg) {
  console.log(`[lsp-proxy] ${new Date().toISOString()} ${msg}`);
}

function warn(msg) {
  console.warn(`[lsp-proxy] ${new Date().toISOString()} WARN: ${msg}`);
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------
function resolveModelDir(modelId) {
  const candidate = path.join(UMP_BASE_DIR, modelId);
  if (!fs.existsSync(candidate)) return null;

  const resolved = fs.realpathSync(candidate);
  const base = fs.realpathSync(UMP_BASE_DIR);

  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    return null;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// LSP stdio framing (Content-Length header protocol)
// ---------------------------------------------------------------------------
function createLspFramer() {
  let buffer = Buffer.alloc(0);

  return {
    feed(data) {
      buffer = Buffer.concat([buffer, data]);
      const messages = [];

      while (true) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;

        const header = buffer.slice(0, headerEnd).toString("ascii");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }

        const contentLength = parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        const messageEnd = bodyStart + contentLength;

        if (buffer.length < messageEnd) break;

        const body = buffer.slice(bodyStart, messageEnd).toString("utf-8");
        messages.push(body);
        buffer = buffer.slice(messageEnd);
      }

      return messages;
    },

    frame(json) {
      const content = Buffer.from(json, "utf-8");
      return `Content-Length: ${content.length}\r\n\r\n${json}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
function killSession(modelId, reason) {
  const entry = activeSessions.get(modelId);
  if (!entry || entry.cleanedUp) return;
  entry.cleanedUp = true;
  activeSessions.delete(modelId);

  log(`Killing session for model=${modelId}: ${reason}`);

  try {
    entry.process.kill("SIGTERM");
    // SIGKILL fallback if the process doesn't exit within 5 seconds
    setTimeout(() => {
      try { entry.process.kill("SIGKILL"); } catch { /* already dead */ }
    }, 5000).unref();
  } catch { /* already dead */ }

  if (entry.ws && entry.ws.readyState <= 1) {
    entry.ws.close(4006, reason);
  }
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const pathname = new url.URL(req.url, "http://localhost").pathname;
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      port: LSP_PORT,
      pid: process.pid,
      nodeVersion: process.version,
      hostname: process.env.HOSTNAME,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      command: LSP_COMMAND,
      baseDir: UMP_BASE_DIR,
      umplesyncJarPath: UMPLESYNC_JAR_PATH,
      activeSessions: activeSessions.size,
      totalSessionsStarted,
      rejectedConnections,
      maxConcurrentSessions,
      processLimit: MAX_PROCESSES_GLOBAL,
      debug: LSP_DEBUG,
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

server.on("listening", () => {
  log(`WebSocket server listening on 0.0.0.0:${LSP_PORT}`);
});

wss.on("connection", (ws, req) => {
  const params = new url.URL(req.url, "http://localhost").searchParams;
  const modelId = params.get("session") || "";

  if (!SESSION_ID_RE.test(modelId)) {
    warn(`Invalid session ID: ${modelId}`);
    rejectedConnections++;
    ws.close(4001, "Invalid session ID");
    return;
  }

  let modelDir;
  try {
    modelDir = resolveModelDir(modelId);
  } catch {
    modelDir = null;
  }
  if (!modelDir) {
    warn(`Model directory not found or path traversal: ${modelId}`);
    rejectedConnections++;
    ws.close(4002, "Model directory not found");
    return;
  }

  if (activeSessions.size >= MAX_PROCESSES_GLOBAL) {
    warn(`Global process limit reached (${MAX_PROCESSES_GLOBAL})`);
    rejectedConnections++;
    ws.close(4005, "Server capacity reached");
    return;
  }

  // Spawn LSP process
  const env = Object.assign({}, process.env, {
    UMPLE_SESSION_DIR: modelDir,
  });
  if (UMPLESYNC_JAR_PATH) {
    env.UMPLESYNC_JAR_PATH = UMPLESYNC_JAR_PATH;
  }

  const cmdParts = LSP_COMMAND.split(/\s+/);
  const lspExe = cmdParts[0];
  const lspArgs = [...cmdParts.slice(1), "--stdio"];

  const lspProcess = spawn(lspExe, lspArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });

  const connId = `${modelId}:${++connectionCounter}`;
  const framer = createLspFramer();
  const entry = { process: lspProcess, framer, ws, cleanedUp: false };

  activeSessions.set(connId, entry);
  totalSessionsStarted++;
  maxConcurrentSessions = Math.max(maxConcurrentSessions, activeSessions.size);
  log(`Session started for model=${modelId} conn=${connId} (pid=${lspProcess.pid})`);

  // LSP stdout → WebSocket
  lspProcess.stdout.on("data", (data) => {
    const messages = framer.feed(data);
    for (const msg of messages) {
      if (LSP_DEBUG) {
        try {
          const parsed = JSON.parse(msg);
          log(`[lsp→client:${connId}] ${parsed.method || `response:${parsed.id}`}`);
        } catch { /* ignore */ }
      }
      if (entry.ws && entry.ws.readyState === entry.ws.OPEN) {
        entry.ws.send(msg);
      }
    }
  });

  lspProcess.stderr.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      log(`[lsp:${connId}] ${line}`);
    }
  });

  lspProcess.on("exit", (code, signal) => {
    log(`LSP process exited for conn=${connId} (code=${code}, signal=${signal})`);
    killSession(connId, "LSP process exited");
  });

  lspProcess.on("error", (err) => {
    warn(`LSP process error for conn=${connId}: ${err.message}`);
    killSession(connId, "LSP process error");
  });

  // WebSocket → LSP stdin
  let socketCleanedUp = false;

  ws.on("message", (data) => {
    const json = data.toString();
    try {
      if (LSP_DEBUG) {
        const parsed = JSON.parse(json);
        log(`[client→lsp:${connId}] ${parsed.method || `response:${parsed.id}`}`);
      }
      const framed = entry.framer.frame(json);
      if (entry.process.stdin.writable) {
        entry.process.stdin.write(framed);
      }
    } catch (e) {
      warn(`Invalid JSON from client: ${e.message}`);
    }
  });

  function onSocketDone(reason) {
    if (socketCleanedUp) return;
    socketCleanedUp = true;
    log(`Socket closed for conn=${connId}: ${reason}`);
    killSession(connId, "client disconnected");
  }

  ws.on("close", () => onSocketDone("close"));
  ws.on("error", (err) => {
    warn(`WebSocket error for conn=${connId}: ${err.message}`);
    onSocketDone("error");
  });
});

wss.on("error", (err) => {
  warn(`WebSocket server error: ${err.message}`);
});

server.listen(LSP_PORT, "0.0.0.0");

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  log(`${signal} received — shutting down`);
  wss.close();
  for (const [modelId] of activeSessions) {
    killSession(modelId, signal);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

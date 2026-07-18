/**
 * HTTP + WebSocket server. Serves the web dashboard, exposes the REST API, and
 * receives hook/heartbeat POSTs. The WS channel streams every store event to
 * connected dashboards so the UI is live without polling.
 */
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SessionStore } from "../core/store.js";
import type { AgentDeckConfig } from "../core/config.js";
import type { SessionEvent } from "../core/types.js";
import { applyHeartbeat, mapClaudeMode, statusForHookEvent } from "../collectors/heartbeat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startServer(store: SessionStore, config: AgentDeckConfig) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // --- Static dashboard ---
  app.use(express.static(join(__dirname, "public")));

  // --- REST API ---
  app.get("/api/sessions", (_req, res) => res.json(store.all()));
  app.get("/api/summary", (_req, res) => res.json(store.summary()));

  // Generic heartbeat (custom agents + SDK).
  app.post("/api/heartbeat", (req, res) => {
    try {
      const s = applyHeartbeat(store, req.body);
      res.json({ ok: true, id: s.id });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  // Claude Code hook intake. The bundled hook script forwards the hook JSON here.
  app.post("/api/hook", (req, res) => {
    try {
      const b = req.body ?? {};
      const event = b.hook_event_name;
      const status = statusForHookEvent(event);
      const id = b.session_id || b.sessionId;
      if (!id) return res.status(400).json({ ok: false, error: "missing session_id" });
      const cwd = b.cwd;
      const label = cwd ? String(cwd).split(/[\\/]/).pop() : "claude-code";
      applyHeartbeat(store, {
        id,
        tool: "claude-code",
        label,
        cwd,
        status,
        mode: mapClaudeMode(b.permission_mode),
        waitingReason: event === "Notification" ? b.message : undefined,
        currentAction:
          event === "PreToolUse" && b.tool_name ? `using ${b.tool_name}` : b.message,
        ttlSec: 600,
      });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/session/:id/remove", (req, res) => {
    store.remove(req.params.id);
    res.json({ ok: true });
  });

  // --- WebSocket live stream ---
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    // Send a snapshot on connect.
    ws.send(JSON.stringify({ type: "snapshot", sessions: store.all(), summary: store.summary() }));
    const onEvent = (ev: SessionEvent) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ ...ev, summary: store.summary() }));
      }
    };
    store.on("event", onEvent);
    ws.on("close", () => store.off("event", onEvent));
  });

  httpServer.listen(config.port, () => {
    console.log(`\n  AgentDeck dashboard  →  http://127.0.0.1:${config.port}`);
    console.log(`  Heartbeat / hook API →  http://127.0.0.1:${config.port}/api/heartbeat\n`);
  });

  return httpServer;
}

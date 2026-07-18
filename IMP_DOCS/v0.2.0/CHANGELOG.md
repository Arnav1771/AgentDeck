# Changelog — v0.2.0

## v0.2.0 — 2026-07-19
Adds the MCP server, historical burn charts, and one-command phone push.

### Added
- **MCP server** (`agentdeck mcp` / `agentdeck-mcp` bin) — stdio Model Context
  Protocol server so Claude Code can *query* the deck and act on it. Tools:
  `list_agents`, `get_summary`, `get_waiting_input`, `get_history`, `report_status`.
  Talks to a running `agentdeck serve` over its REST API. See `MCP.md`.
- **Historical charts** — `HistoryRecorder` snapshots the summary every 60s to
  `~/.agentdeck/history.jsonl` (self-trimming, survives restarts). New
  `GET /api/history?minutes=N` endpoint. The dashboard now shows a live
  cumulative **spend & token burn** area chart (canvas), seeded from history and
  updated live, with emphasized endpoints.
- **`agentdeck set-push [topicUrl]`** — writes an ntfy topic into
  `agentdeck.config.json` (generates a random one if omitted) and prints the
  phone-subscribe steps. Wires up the "alert me on my phone" path in one command.

### Changed
- Dashboard UI: added the burn-chart strip under the summary bar; topbar now
  mirrors the live cost/token totals into the chart header.
- `startServer()` now accepts an optional `HistoryRecorder` for `/api/history`.
- Version bump 0.1.0 → 0.2.0; new deps `@modelcontextprotocol/sdk`, `zod`.

### Still open
- Cost/token history is per-machine and time-bucketed only (no per-session
  history persistence yet).
- MCP is read-plus-report; no pause/kill control tools yet.

# Changelog

## v0.1.0 — 2026-07-19
Initial release. Control tower for AI coding agents.

### Added
- Core engine: `SessionStore` (normalize, cost, alert-transition detection, sweep/reap),
  pricing table + cost math, zero-config config loader.
- Collectors: Claude Code transcript parser, generic AI-CLI process scanner,
  optional Anthropic usage/cost row, heartbeat/hook intake + TTL reaper.
- Alerts: desktop notification, ntfy phone push, terminal bell, dashboard highlight,
  with per-session de-dupe.
- Web dashboard (Express + WebSocket, live cards, red flash + beep + tab badge).
- Terminal TUI (blessed, live table + red banner + bell).
- Claude Code hook installer/uninstaller (`install-hooks` / `uninstall-hooks`).
- Heartbeat SDK (`AgentDeckReporter`) for custom agents + runnable example.
- CLI: `serve`, `tui`, `install-hooks`, `uninstall-hooks`, `doctor`.
- Docs: README, architecture notes.

### Known limitations
- In-memory only (no persistence across restarts).
- Process-scanned tools have no token attribution.
- MCP server planned but not yet implemented.

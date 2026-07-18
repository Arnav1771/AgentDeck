# AgentDeck — Architecture (v0.1.0)

## Purpose
One live view of every AI coding agent running on the machine: status, autonomy
mode, token/credit burn, and — above all — an unmissable signal when an agent is
blocked waiting for the human.

## Data model
Everything normalizes to `AgentSession` (`src/core/types.ts`): id, tool, source,
label, cwd/pid, `status`, `mode`, `currentAction`/`waitingReason`, `usage`
(tokens), derived `costUsd`, timestamps, `meta`.

- **status**: running | waiting_input | idle | done | error | unknown
- **mode**: auto | manual | plan | unknown

## Components

### Core (`src/core`)
- `store.ts` — `SessionStore`: in-memory map + `EventEmitter`. `upsert()` merges
  partial reports, recomputes cost, and — crucially — detects status *transitions*
  and emits `alert` events (into waiting_input / error). `sweep()` auto-idles
  stale pull-based sessions and reaps old ones. `all()` sorts waiting_input first.
- `cost.ts` — pricing table (USD/1M tokens) + `costOf()`; fuzzy model-family match.
- `config.ts` — zero-config defaults, JSON overrides via `agentdeck.config.json`.

### Collectors (`src/collectors`) — the input side
All implement `Collector { start?, poll?, stop? }`.
- `claudeCode.ts` — parses newest `~/.claude/projects/*/*.jsonl` transcript per
  project for **accurate tokens/model/last-activity**. Status here is heuristic and
  deliberately yields to the hook signal (`meta.hookOwned`).
- `heartbeat.ts` — the **push** path. `applyHeartbeat()` is called by the server for
  both custom-agent heartbeats and Claude Code hooks. Owns accurate status/mode.
  `HeartbeatCollector` reaps sessions whose TTL lapsed.
- `processScan.ts` — `ps`-based detection of other AI CLIs (coarse status only).
- `usage.ts` — optional Anthropic org cost report → a "billed today" account row.

### Alerts (`src/alerts`) — the attention side
`Alerter` subscribes to store `alert` events and fans out to enabled channels with
per-(session,kind) de-dupe: `desktop.ts` (notify-send/toast/osascript),
`push.ts` (ntfy phone push), `bell.ts` (terminal BEL). Dashboard highlight is done
client-side from the same WS `alert` event.

### Server (`src/server`)
Express + `ws`. Serves the static dashboard, REST (`/api/sessions`, `/api/summary`),
intake (`/api/heartbeat`, `/api/hook`), and a `/ws` stream (snapshot on connect,
then every store event with a fresh summary).

### Front-ends
- **Web** (`src/server/public`) — vanilla JS, WS-live cards, red flash + WebAudio
  beep + tab-title badge on waiting_input.
- **TUI** (`src/tui/tui.ts`) — blessed list-table + red banner + bell; connects to
  the server over WS. Good for a spare WSL pane.

### Hooks (`src/hooks/install.ts`)
`install-hooks` edits `~/.claude/settings.json` adding a `curl … /api/hook` command
for Notification / UserPromptSubmit / PreToolUse / Stop / SessionEnd. Idempotent and
tagged with an `# agentdeck` marker so `uninstall-hooks` removes only ours.

### SDK (`src/sdk/heartbeat.ts`)
`AgentDeckReporter` — dependency-free fetch client for custom agents: `running()`,
`waitingInput()`, `addTokens()`, `done()`, auto-heartbeat keep-alive with TTL.

## Flow
```
collectors ─► SessionStore.upsert ─► (cost + transition detection)
                     │                        │
                     ├─► WS/REST ─► web + TUI  └─► Alerter ─► desktop/push/bell
```

## Design choices
- **Push beats poll for correctness.** Transcript parsing gives exact tokens but can't
  reliably tell "waiting"; Claude Code hooks can, so hook-owned sessions win on status.
- **Fail soft.** Every alert channel and the usage API are best-effort; a missing tool
  or key degrades to no-op, never crashes the deck.
- **One store, many faces.** Alert-transition logic lives in the store so web, TUI, and
  every channel agree on what counts as "needs attention".

## Known limitations (v0.1.0)
- Token/cost persistence is in-memory only (resets on restart).
- Process scan can't attribute tokens.
- MCP server not yet implemented (roadmap).

# ◈ AgentDeck — a control tower for AI coding agents

You live in the terminal and run a lot of AI at once: Claude Code in three panes, an
`aider` here, a LangGraph swarm there. Two problems keep biting:

1. **A prompt gets buried.** One agent quietly stops and waits for your input while
   you're heads-down elsewhere. You notice ten minutes later.
2. **You can't see the spend.** How many tokens / how much money have these sessions
   burned this session? No single place tells you.

**AgentDeck** is one live pane that answers *"what AI is running right now?"* across your
whole machine — per session: **status**, **mode (auto / manual / plan)**, **tokens &
estimated cost**, and a big flashing **"needs your input"** signal that also pushes to
your phone.

> Built to run inside WSL. Web dashboard **and** a terminal TUI, sharing one core engine.

---

## What it shows

| | |
|---|---|
| **Status** | `running` · `waiting_input` · `idle` · `done` · `error` |
| **Mode** | `auto` (bypass/accept-edits) · `manual` (default) · `plan` |
| **Credits** | live token counts + estimated USD cost per session and in total |
| **Attention** | waiting-for-input agents float to the top, flash red, ring a bell, push to your phone |
| **Provenance** | which tool + which project/cwd each session belongs to |

## What it watches (collectors)

- **Claude Code** — reads `~/.claude/projects/*` transcripts for accurate token/cost, and
  (once you run `install-hooks`) gets exact status + mode straight from Claude Code's hooks.
- **Other AI CLIs** — a process scanner detects `aider`, `codex`, `gemini`, `cursor-agent`,
  `opencode`, `goose`, … so they appear even without any integration.
- **Provider usage** — optional: pull real billed spend from the Anthropic org cost report
  (needs an admin key) and show "credits burned today".
- **Custom agents** — a tiny heartbeat SDK so your own scripts/swarms/bots report in.

---

## Quick start (WSL)

```bash
cd ~/repos/AgentDeck
npm install

# 1) start the dashboard + API
npm run serve            # → http://127.0.0.1:4317

# 2) (recommended) wire Claude Code to report accurate status
npx tsx src/index.ts install-hooks
#    restart open Claude Code sessions afterwards

# 3) optional terminal view, in any other pane
npm run tui
```

Open **http://127.0.0.1:4317** in Windows' browser (WSL forwards localhost) — or watch the TUI.

### Build & install as a command

```bash
npm run build
npm link                 # now `agentdeck` is on your PATH
agentdeck serve
agentdeck tui
agentdeck install-hooks
```

---

## The "waiting for input" signal

This is the headline feature. When any agent blocks on you:

- its card jumps to the top and **flashes red** (web) / a **red banner + bell** (TUI),
- a **desktop notification** fires (WSLg toast on Win11),
- and if you set `alerts.ntfyTopicUrl`, a **push hits your phone** (via the free
  [ntfy](https://ntfy.sh) app — subscribe to your topic, no account needed).

For Claude Code this is exact (driven by its `Notification` hook). For other tools it's
inferred from process/heartbeat signals.

---

## Make your own agent show up

```ts
import { AgentDeckReporter } from "agentdeck/sdk"; // or ../src/sdk/heartbeat.js in-repo

const deck = new AgentDeckReporter({ id: "wfm-swarm-1", tool: "langgraph", label: "RCA swarm" });
deck.setMode("auto");
await deck.running("classifying tickets");
await deck.addTokens({ input: 1200, output: 340 });
await deck.waitingInput("Approve the proposed RCA?");   // ← flashes + alerts
await deck.done();
```

See `examples/custom-agent-heartbeat.ts` for a runnable demo.

---

## Configuration

Copy `agentdeck.config.example.json` → `agentdeck.config.json` and edit. Everything has a
default; the file only overrides what you set. Notable keys:

- `port`, `pollIntervalMs`
- `collectors.{claudeCode,processScan,usage,heartbeat}` — toggle each
- `alerts.{desktop,bell,dashboard,ntfyTopicUrl}`
- `usage.anthropicAdminKey` — enables the real billed-spend row
- `pricing` — override per-1M-token prices used for cost estimates

---

## CLI

```
agentdeck serve            start dashboard + API (default command)
agentdeck tui              terminal dashboard (connects to a running server)
agentdeck install-hooks    wire Claude Code hooks → AgentDeck
agentdeck uninstall-hooks  remove them
agentdeck doctor           environment + connectivity check
```

## API

- `GET  /api/sessions` → all sessions
- `GET  /api/summary`  → roll-up (counts, total tokens, total cost)
- `POST /api/heartbeat` → custom-agent report (see SDK)
- `POST /api/hook` → Claude Code hook intake
- `WS   /ws` → live event stream (snapshot + upserts/removes/alerts)

---

## Architecture

```
collectors ──►  SessionStore (normalize + cost + alert transitions)  ──►  WS/REST ──► web + TUI
(claude-code,        │
 process-scan,       └─► Alerter ──► desktop / ntfy push / bell
 usage, heartbeat)
```

See `IMP_DOCS/` for the versioned design notes and changelog.

## Roadmap

- Native **MCP server** so Claude Code can *ask* the deck "what's running?" and act on it.
- Historical token/cost charts (sparklines) and per-day rollups.
- Pause/resume/kill controls from the dashboard.

MIT © 2026 Arnav Bhargava

# ◈ AgentDeck — a control tower for AI coding agents

You live in the terminal and run a lot of AI at once: Claude Code in three panes, an
`aider` here, a LangGraph swarm there. Two problems keep biting:

1. **A prompt gets buried.** One agent quietly stops and waits for your input while
   you're heads-down elsewhere. You notice ten minutes later.
2. **You can't see the spend.** How many tokens / how much money have these sessions
   burned this session? No single place tells you.

**AgentDeck** is one live pane that answers *"what AI is running right now?"* across your
whole machine — per session: **status**, **mode (auto / manual / plan)**, **tokens &
estimated cost**, a live **spend/burn chart**, and a big flashing **"needs your input"**
signal that also pushes to your phone. It even ships an **MCP server** so Claude Code can
*ask* the deck what's running.

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

## MCP server — let Claude Code query the deck

AgentDeck ships an MCP server so, inside a Claude Code session, you can ask *"which of
my agents is waiting for input?"* or *"how much have I spent?"* and it answers from the
live deck. Tools: `list_agents`, `get_summary`, `get_waiting_input`, `get_history`,
`report_status`.

```bash
agentdeck serve                                            # keep the deck running
claude mcp add agentdeck -- node "$PWD/dist/mcp/server.js" # register with Claude Code
```

Full setup (incl. `.mcp.json`) in `IMP_DOCS/v0.2.0/MCP.md`.

## Spend & burn chart

The dashboard draws a live cumulative **cost + token** area chart, seeded from history and
updated as you go. History is snapshotted every 60s to `~/.agentdeck/history.jsonl` and
survives restarts; query it at `GET /api/history?minutes=N`.

## Phone push in one command

```bash
agentdeck set-push                 # generates an ntfy topic + writes config + prints steps
agentdeck set-push https://ntfy.sh/my-own-topic   # or use your own
```
Install the free **ntfy** app, subscribe to the printed topic, and every "needs input"
alert lands on your phone.

## CLI

```
agentdeck serve            start dashboard + API (default command)
agentdeck tui              terminal dashboard (connects to a running server)
agentdeck mcp              run the MCP server (stdio) for Claude Code
agentdeck install-hooks    wire Claude Code hooks → AgentDeck
agentdeck uninstall-hooks  remove them
agentdeck set-push [url]   configure phone push (ntfy)
agentdeck doctor           environment + connectivity check
```

## API

- `GET  /api/sessions` → all sessions
- `GET  /api/summary`  → roll-up (counts, total tokens, total cost)
- `GET  /api/history?minutes=N` → token/cost time series for the chart
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

## Landing page (for selling it)

A polished, self-contained marketing page lives at [`landing/index.html`](landing/index.html) —
hero with a live dashboard mock, problem/features/how-it-works, an MCP demo, pricing tiers
(Open Source / Pro / Team), and FAQ. It's a single file with everything inlined (no build,
no external fonts/CDN), so you can host it anywhere:

```bash
# GitHub Pages (needs a public repo or GitHub Pro):
cp landing/index.html docs/index.html   # then Settings → Pages → main /docs

# or any static host — just point it at the file:
npx serve landing        # local preview at http://localhost:3000
#   Netlify / Vercel / Cloudflare Pages: drag-drop landing/ or set publish dir = landing
```

Edit the pricing, email CTAs, and copy to taste before you ship it.

## Roadmap

- ~~Native MCP server~~ ✓ shipped in v0.2.0
- ~~Historical token/cost charts~~ ✓ shipped in v0.2.0
- Per-session history + per-day rollups.
- Pause/resume/kill controls from the dashboard (and matching MCP tools).

MIT © 2026 Arnav Bhargava

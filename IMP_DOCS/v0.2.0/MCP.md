# AgentDeck MCP server

Lets Claude Code (or any MCP client) **ask the deck what's running** and act on it,
right inside a coding session:

> "Which of my agents is waiting for input?"
> "How much have I spent across all sessions today?"
> "Mark this background job as blocked."

## How it works

The MCP server is a thin **stdio** process that calls a running `agentdeck serve`
over its REST API. So the flow is:

```
Claude Code ──stdio(MCP)──► agentdeck mcp ──HTTP──► agentdeck serve ──► SessionStore
```

Start the dashboard server first (it holds the live state):

```bash
agentdeck serve            # http://127.0.0.1:4317
```

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `list_agents` | — | every session: status, mode, tokens, cost, action, cwd |
| `get_summary` | — | totals: sessions, running, waiting, tokens, cost |
| `get_waiting_input` | — | only agents blocked on you, with each one's prompt |
| `get_history` | `minutes` | recent token/cost time series |
| `report_status` | `id`, `status`, `mode`, … | upsert a custom session (heartbeat) |

## Register with Claude Code

**Option A — CLI:**
```bash
claude mcp add agentdeck -- node /home/dell/repos/AgentDeck/dist/mcp/server.js
```

**Option B — `.mcp.json`** (project or user scope):
```json
{
  "mcpServers": {
    "agentdeck": {
      "command": "node",
      "args": ["/home/dell/repos/AgentDeck/dist/mcp/server.js"],
      "env": { "AGENTDECK_URL": "http://127.0.0.1:4317" }
    }
  }
}
```

If you `npm link` the package, you can use the `agentdeck-mcp` bin instead of the
absolute path.

## Point it at a non-default server

Set `AGENTDECK_URL` in the MCP server's env (e.g. a different port or host).

## Try it without Claude

Drive it over raw stdio JSON-RPC:
```bash
AGENTDECK_URL=http://127.0.0.1:4317 node dist/mcp/server.js
# then paste:
# {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}
# {"jsonrpc":"2.0","method":"notifications/initialized"}
# {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_summary","arguments":{}}}
```

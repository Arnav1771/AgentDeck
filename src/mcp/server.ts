#!/usr/bin/env node
/**
 * AgentDeck MCP server (stdio).
 *
 * Lets Claude Code (or any MCP client) *ask* the deck what's happening and act
 * on it: "which of my agents is waiting?", "how much have I spent?", "mark this
 * session as blocked". It talks to a running `agentdeck serve` over its REST API,
 * so start the server first (default http://127.0.0.1:4317).
 *
 * Register with Claude Code:
 *   claude mcp add agentdeck -- node /path/to/AgentDeck/dist/mcp/server.js
 * or add to .mcp.json (see IMP_DOCS/v0.2.0/MCP.md).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";

const BASE = (process.env.AGENTDECK_URL ?? "http://127.0.0.1:4317").replace(/\/$/, "");

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`AgentDeck API ${path} → HTTP ${res.status}`);
  return res.json();
}

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function unreachable(e: any) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Could not reach AgentDeck at ${BASE}. Is it running? Start it with ` +
          `\`agentdeck serve\`. (${e?.message ?? e})`,
      },
    ],
    isError: true,
  };
}

export async function runMcp() {
  const server = new McpServer({ name: "agentdeck", version: "0.2.0" });

  server.tool(
    "list_agents",
    "List every AI agent/session AgentDeck currently sees on this machine, with status, mode (auto/manual/plan), token usage, estimated cost, and current action.",
    async () => {
      try {
        const sessions = await api("/api/sessions");
        const slim = (sessions as any[]).map((s) => ({
          label: s.label,
          tool: s.tool,
          status: s.status,
          mode: s.mode,
          tokens: s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheWrite,
          costUsd: s.costUsd,
          currentAction: s.currentAction,
          waitingReason: s.waitingReason,
          cwd: s.cwd,
        }));
        return text({ count: slim.length, agents: slim });
      } catch (e) {
        return unreachable(e);
      }
    },
  );

  server.tool(
    "get_summary",
    "Get the machine-wide roll-up: total sessions, how many running / waiting for input, total tokens, and total estimated cost (USD).",
    async () => {
      try {
        return text(await api("/api/summary"));
      } catch (e) {
        return unreachable(e);
      }
    },
  );

  server.tool(
    "get_waiting_input",
    "Return only the agents that are BLOCKED waiting for human input right now, with the prompt/question each is waiting on. Use this to tell the user what needs their attention.",
    async () => {
      try {
        const sessions = (await api("/api/sessions")) as any[];
        const waiting = sessions
          .filter((s) => s.status === "waiting_input")
          .map((s) => ({ label: s.label, tool: s.tool, mode: s.mode, waitingReason: s.waitingReason, cwd: s.cwd }));
        return text({ count: waiting.length, waiting });
      } catch (e) {
        return unreachable(e);
      }
    },
  );

  server.tool(
    "get_history",
    "Get the recent time series of total tokens and estimated cost, for spend/burn trends.",
    { minutes: z.number().min(1).max(10080).default(120).describe("look-back window in minutes") },
    async ({ minutes }) => {
      try {
        return text(await api(`/api/history?minutes=${minutes}`));
      } catch (e) {
        return unreachable(e);
      }
    },
  );

  server.tool(
    "report_status",
    "Report or update a custom agent's state on the deck (heartbeat). Use to make a script/agent visible, or mark it waiting_input / done.",
    {
      id: z.string().describe("stable unique id for the session"),
      label: z.string().optional(),
      tool: z.string().optional().describe("e.g. langgraph, script, custom"),
      status: z.enum(["running", "waiting_input", "idle", "done", "error"]).optional(),
      mode: z.enum(["auto", "manual", "plan"]).optional(),
      currentAction: z.string().optional(),
      waitingReason: z.string().optional(),
    },
    async (args) => {
      try {
        const r = await api("/api/heartbeat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args),
        });
        return text({ ok: true, ...r });
      } catch (e) {
        return unreachable(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so we don't corrupt the stdio protocol on stdout.
  console.error(`[agentdeck-mcp] connected · talking to ${BASE}`);
}

// Allow running directly as a bin (`node dist/mcp/server.js`).
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  runMcp().catch((e) => {
    console.error("[agentdeck-mcp] fatal:", e);
    process.exit(1);
  });
}

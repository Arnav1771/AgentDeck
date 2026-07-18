/**
 * Heartbeat + hook intake.
 *
 * This is the PUSH path: Claude Code hooks and custom agents POST their state to
 * the server, which calls `applyHeartbeat()`. This is the accurate source of
 * status ("waiting_input"), mode (auto/manual/plan), and current action.
 *
 * Payload is intentionally forgiving so a two-line curl from a shell hook works.
 */
import type { Collector } from "./collector.js";
import type { SessionStore } from "../core/store.js";
import type { AgentMode, AgentStatus, TokenUsage } from "../core/types.js";

export interface HeartbeatPayload {
  id: string;
  tool?: string;
  label?: string;
  cwd?: string;
  pid?: number;
  status?: AgentStatus;
  mode?: AgentMode;
  currentAction?: string;
  waitingReason?: string;
  model?: string;
  usage?: Partial<TokenUsage>;
  /** seconds until this session is considered stale/gone (default 120). */
  ttlSec?: number;
}

/** Map a Claude Code permission_mode string to our AgentMode. */
export function mapClaudeMode(permissionMode?: string): AgentMode {
  switch (permissionMode) {
    case "bypassPermissions":
    case "acceptEdits":
      return "auto";
    case "plan":
      return "plan";
    case "default":
      return "manual";
    default:
      return "unknown";
  }
}

/** Map a Claude Code hook event name to a status. */
export function statusForHookEvent(event?: string): AgentStatus | undefined {
  switch (event) {
    case "Notification":
      return "waiting_input"; // Claude Code fires Notification when it needs input
    case "UserPromptSubmit":
    case "PreToolUse":
    case "PostToolUse":
      return "running";
    case "Stop":
    case "SubagentStop":
      return "idle";
    case "SessionEnd":
      return "done";
    default:
      return undefined;
  }
}

export function applyHeartbeat(store: SessionStore, p: HeartbeatPayload) {
  if (!p.id) throw new Error("heartbeat requires an id");
  const ttlMs = (p.ttlSec ?? 120) * 1000;
  const usage: TokenUsage | undefined = p.usage
    ? {
        input: p.usage.input ?? 0,
        output: p.usage.output ?? 0,
        cacheRead: p.usage.cacheRead ?? 0,
        cacheWrite: p.usage.cacheWrite ?? 0,
      }
    : undefined;

  return store.upsert({
    id: p.id,
    tool: p.tool ?? "custom",
    source: "heartbeat",
    label: p.label ?? p.id,
    cwd: p.cwd,
    pid: p.pid,
    status: p.status,
    mode: p.mode,
    currentAction: p.currentAction,
    waitingReason: p.waitingReason,
    model: p.model,
    usage,
    meta: { hookOwned: true, expiresAt: Date.now() + ttlMs },
  });
}

/** Reaps heartbeat sessions whose TTL lapsed (agent died without saying goodbye). */
export class HeartbeatCollector implements Collector {
  name = "heartbeat";

  poll(store: SessionStore) {
    const now = Date.now();
    for (const s of store.all()) {
      if (s.source !== "heartbeat") continue;
      const exp = s.meta?.expiresAt as number | undefined;
      if (exp && now > exp && s.status !== "done" && s.status !== "error") {
        store.upsert({
          id: s.id,
          tool: s.tool,
          source: s.source,
          status: "idle",
          currentAction: "(no heartbeat — assumed stalled)",
        });
      }
    }
  }
}

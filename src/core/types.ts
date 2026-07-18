/**
 * AgentDeck core domain types.
 *
 * Everything the dashboard shows is normalized into an `AgentSession`, no matter
 * which tool produced it (Claude Code, another AI CLI, a custom heartbeat agent,
 * or a provider usage feed).
 */

/** High-level lifecycle state of an agent session. */
export type AgentStatus =
  | "running" // actively working (thinking / calling tools)
  | "waiting_input" // BLOCKED on the human — the thing we most want to surface
  | "idle" // process alive but nothing happening
  | "done" // finished cleanly
  | "error" // crashed / errored out
  | "unknown";

/**
 * How autonomously the agent is operating. Mapped from a tool's permission model
 * (e.g. Claude Code: bypassPermissions/acceptEdits => auto, default => manual,
 * plan => plan).
 */
export type AgentMode = "auto" | "manual" | "plan" | "unknown";

/** Token accounting for a session. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/** A single normalized AI agent session. */
export interface AgentSession {
  /** Stable unique id (session id from the tool, or a synthesized one). */
  id: string;
  /** Which tool produced this: "claude-code", "aider", "codex", custom name, ... */
  tool: string;
  /** Which collector reported it (for debugging / provenance). */
  source: string;
  /** Human label — usually the project/folder name. */
  label: string;
  /** Working directory / project path if known. */
  cwd?: string;
  /** OS process id if known. */
  pid?: number;

  status: AgentStatus;
  mode: AgentMode;

  /** Short description of what it's doing right now ("editing server.ts", "running tests"). */
  currentAction?: string;
  /** If waiting_input: the question/prompt text if the tool provided one. */
  waitingReason?: string;

  usage: TokenUsage;
  /** Estimated cost in USD, derived from usage + pricing table. */
  costUsd: number;
  /** Model id if known (drives pricing). */
  model?: string;

  /** ms epoch of first sighting. */
  startedAt: number;
  /** ms epoch of most recent activity. */
  lastActivity: number;

  /** Free-form extras a collector wants to attach. */
  meta?: Record<string, unknown>;
}

/** Event emitted whenever a session's state changes. */
export interface SessionEvent {
  type: "upsert" | "remove" | "alert";
  session: AgentSession;
  /** For "alert": what triggered it. */
  alert?: AlertPayload;
  at: number;
}

export interface AlertPayload {
  kind: "waiting_input" | "error" | "done";
  sessionId: string;
  title: string;
  body: string;
}

/** Aggregate roll-up for the whole machine (top bar / summary API). */
export interface DeckSummary {
  totalSessions: number;
  running: number;
  waitingInput: number;
  idle: number;
  totalTokens: number;
  totalCostUsd: number;
  updatedAt: number;
}

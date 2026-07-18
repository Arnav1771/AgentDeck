/**
 * The in-memory session store + event bus. Collectors push normalized sessions
 * in via `upsert()`; the server/TUI subscribe to changes. Alert transitions
 * (anything -> waiting_input, or -> error) are detected here so every front-end
 * and alert channel sees them consistently.
 */
import { EventEmitter } from "node:events";
import type {
  AgentSession,
  AlertPayload,
  DeckSummary,
  SessionEvent,
} from "./types.js";
import { costOf, DEFAULT_PRICING, type ModelPricing } from "./cost.js";

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, AgentSession>();
  private pricing: Record<string, ModelPricing>;
  private idleAfterMs: number;
  private reapAfterMs: number;

  constructor(opts: {
    pricing?: Record<string, ModelPricing>;
    idleAfterMs: number;
    reapAfterMs: number;
  }) {
    super();
    this.pricing = { ...DEFAULT_PRICING, ...(opts.pricing ?? {}) };
    this.idleAfterMs = opts.idleAfterMs;
    this.reapAfterMs = opts.reapAfterMs;
  }

  /**
   * Insert or update a session. Partial updates are merged onto any existing
   * record so a collector can report just what changed.
   */
  upsert(partial: Partial<AgentSession> & { id: string; tool: string; source: string }): AgentSession {
    const now = Date.now();
    const existing = this.sessions.get(partial.id);
    const prevStatus = existing?.status;

    const merged: AgentSession = {
      label: partial.label ?? existing?.label ?? partial.id,
      cwd: partial.cwd ?? existing?.cwd,
      pid: partial.pid ?? existing?.pid,
      status: partial.status ?? existing?.status ?? "unknown",
      mode: partial.mode ?? existing?.mode ?? "unknown",
      currentAction: partial.currentAction ?? existing?.currentAction,
      waitingReason: partial.waitingReason ?? existing?.waitingReason,
      usage: partial.usage ?? existing?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      model: partial.model ?? existing?.model,
      startedAt: existing?.startedAt ?? partial.startedAt ?? now,
      lastActivity: partial.lastActivity ?? now,
      meta: { ...(existing?.meta ?? {}), ...(partial.meta ?? {}) },
      id: partial.id,
      tool: partial.tool,
      source: partial.source,
      costUsd: 0,
    };
    merged.costUsd = costOf(merged.usage, merged.model, this.pricing);

    this.sessions.set(merged.id, merged);
    this.emit("event", { type: "upsert", session: merged, at: now } as SessionEvent);

    // Fire an alert on a transition INTO a state that needs attention.
    if (prevStatus !== merged.status) {
      if (merged.status === "waiting_input") {
        this.fireAlert(merged, {
          kind: "waiting_input",
          sessionId: merged.id,
          title: `${merged.label} needs your input`,
          body: merged.waitingReason || `${merged.tool} is waiting (${merged.mode} mode).`,
        });
      } else if (merged.status === "error") {
        this.fireAlert(merged, {
          kind: "error",
          sessionId: merged.id,
          title: `${merged.label} hit an error`,
          body: merged.currentAction || `${merged.tool} errored.`,
        });
      }
    }
    return merged;
  }

  private fireAlert(session: AgentSession, alert: AlertPayload) {
    this.emit("event", { type: "alert", session, alert, at: Date.now() } as SessionEvent);
  }

  remove(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.emit("event", { type: "remove", session: s, at: Date.now() } as SessionEvent);
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  all(): AgentSession[] {
    return [...this.sessions.values()].sort((a, b) => {
      // waiting_input first, then running, then most-recent activity.
      const rank = (s: AgentSession) =>
        s.status === "waiting_input" ? 0 : s.status === "running" ? 1 : 2;
      const r = rank(a) - rank(b);
      return r !== 0 ? r : b.lastActivity - a.lastActivity;
    });
  }

  summary(): DeckSummary {
    const all = this.all();
    let totalTokens = 0;
    let totalCostUsd = 0;
    let running = 0;
    let waitingInput = 0;
    let idle = 0;
    for (const s of all) {
      totalTokens += s.usage.input + s.usage.output + s.usage.cacheRead + s.usage.cacheWrite;
      totalCostUsd += s.costUsd;
      if (s.status === "running") running++;
      else if (s.status === "waiting_input") waitingInput++;
      else if (s.status === "idle") idle++;
    }
    return {
      totalSessions: all.length,
      running,
      waitingInput,
      idle,
      totalTokens,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      updatedAt: Date.now(),
    };
  }

  /**
   * Housekeeping run on the poll tick: mark stale running/idle sessions as idle,
   * and reap long-finished ones so the deck doesn't grow forever.
   */
  sweep() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      const age = now - s.lastActivity;
      if ((s.status === "running" || s.status === "waiting_input") && age > this.idleAfterMs) {
        // Only auto-idle pull-based sources; heartbeat sources report their own end.
        if (s.source !== "heartbeat") {
          this.upsert({ id: s.id, tool: s.tool, source: s.source, status: "idle" });
        }
      }
      if ((s.status === "done" || s.status === "error" || s.status === "idle") && age > this.reapAfterMs) {
        this.remove(s.id);
      }
    }
  }
}

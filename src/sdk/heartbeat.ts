/**
 * AgentDeck heartbeat SDK — drop this into your own agent/script (LangGraph
 * swarm, Discord bot, cron job) so it shows up on the deck with live status,
 * mode, and token usage.
 *
 *   import { AgentDeckReporter } from "agentdeck/sdk";
 *   const deck = new AgentDeckReporter({ id: "wfm-swarm-1", tool: "langgraph", label: "WFM RCA swarm" });
 *   await deck.running("classifying tickets");
 *   await deck.addTokens({ input: 1200, output: 340 });
 *   await deck.waitingInput("Approve the proposed RCA?");   // turns the card red
 *   await deck.done();
 *
 * No dependency on the rest of the package — pure fetch.
 */
import type { AgentMode, AgentStatus, TokenUsage } from "../core/types.js";

export interface ReporterOptions {
  id: string;
  tool?: string;
  label?: string;
  cwd?: string;
  model?: string;
  /** Base URL of the AgentDeck server. Default http://127.0.0.1:4317 */
  serverUrl?: string;
  /** Seconds between auto-heartbeats to keep the session fresh. Default 30. */
  heartbeatSec?: number;
}

export class AgentDeckReporter {
  private base: string;
  private usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  private mode: AgentMode = "auto";
  private timer?: ReturnType<typeof setInterval>;
  private lastStatus: AgentStatus = "running";
  private lastAction?: string;

  constructor(private opts: ReporterOptions) {
    this.base = (opts.serverUrl ?? process.env.AGENTDECK_URL ?? "http://127.0.0.1:4317").replace(
      /\/$/,
      "",
    );
    const sec = opts.heartbeatSec ?? 30;
    // Keep the session alive even if the agent is quietly thinking.
    this.timer = setInterval(() => void this.send(this.lastStatus, this.lastAction), sec * 1000);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  setMode(mode: AgentMode) {
    this.mode = mode;
  }

  async addTokens(delta: Partial<TokenUsage>) {
    this.usage.input += delta.input ?? 0;
    this.usage.output += delta.output ?? 0;
    this.usage.cacheRead += delta.cacheRead ?? 0;
    this.usage.cacheWrite += delta.cacheWrite ?? 0;
    await this.send(this.lastStatus, this.lastAction);
  }

  running(action?: string) {
    return this.send("running", action);
  }
  idle(action?: string) {
    return this.send("idle", action);
  }
  waitingInput(reason?: string) {
    return this.send("waiting_input", this.lastAction, reason);
  }
  error(action?: string) {
    return this.send("error", action);
  }
  async done(action?: string) {
    await this.send("done", action);
    this.stop();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async send(status: AgentStatus, action?: string, waitingReason?: string) {
    this.lastStatus = status;
    if (action !== undefined) this.lastAction = action;
    const body = {
      id: this.opts.id,
      tool: this.opts.tool ?? "custom",
      label: this.opts.label ?? this.opts.id,
      cwd: this.opts.cwd,
      model: this.opts.model,
      status,
      mode: this.mode,
      currentAction: this.lastAction,
      waitingReason,
      usage: this.usage,
      ttlSec: (this.opts.heartbeatSec ?? 30) * 3,
    };
    try {
      await fetch(`${this.base}/api/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* deck may be down; agent keeps running regardless */
    }
  }
}

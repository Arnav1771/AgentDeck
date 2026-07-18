/**
 * Lightweight time-series recorder. Snapshots the deck summary on an interval to
 * a JSONL file so the dashboard can draw cost/token burn over time and survive
 * restarts. Deliberately tiny: append-only, self-trimming, no external deps.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { SessionStore } from "./store.js";

export interface HistoryPoint {
  t: number; // ms epoch
  tokens: number;
  costUsd: number;
  running: number;
  waiting: number;
  sessions: number;
}

const DEFAULT_FILE = join(homedir(), ".agentdeck", "history.jsonl");
const MAX_LINES = 5000; // ~ a few days at 1/min; trimmed when exceeded

export class HistoryRecorder {
  private file: string;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private store: SessionStore, file = DEFAULT_FILE) {
    this.file = file;
    mkdirSync(dirname(this.file), { recursive: true });
  }

  start(intervalMs = 60_000) {
    this.snapshot();
    this.timer = setInterval(() => this.snapshot(), intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  snapshot(): HistoryPoint {
    const s = this.store.summary();
    const point: HistoryPoint = {
      t: Date.now(),
      tokens: s.totalTokens,
      costUsd: s.totalCostUsd,
      running: s.running,
      waiting: s.waitingInput,
      sessions: s.totalSessions,
    };
    try {
      appendFileSync(this.file, JSON.stringify(point) + "\n");
      this.maybeTrim();
    } catch {
      /* best-effort */
    }
    return point;
  }

  /** Return points within the last `minutes` (default 120). */
  recent(minutes = 120): HistoryPoint[] {
    if (!existsSync(this.file)) return [];
    const cutoff = Date.now() - minutes * 60_000;
    const out: HistoryPoint[] = [];
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line) as HistoryPoint;
        if (p.t >= cutoff) out.push(p);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }

  private maybeTrim() {
    try {
      const lines = readFileSync(this.file, "utf8").split("\n").filter((l) => l.trim());
      if (lines.length > MAX_LINES) {
        writeFileSync(this.file, lines.slice(lines.length - MAX_LINES).join("\n") + "\n");
      }
    } catch {
      /* ignore */
    }
  }
}

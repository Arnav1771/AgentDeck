/**
 * Config loading. AgentDeck runs with sane defaults and zero config; a
 * `agentdeck.config.json` in the cwd (or path via AGENTDECK_CONFIG) overrides.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelPricing } from "./cost.js";

export interface AgentDeckConfig {
  /** HTTP/WS port for the web dashboard + heartbeat intake. */
  port: number;
  /** How often (ms) the pull collectors run. */
  pollIntervalMs: number;
  /** Enable/disable individual collectors. */
  collectors: {
    claudeCode: boolean;
    processScan: boolean;
    usage: boolean;
    heartbeat: boolean;
  };
  /** Alert channels. */
  alerts: {
    desktop: boolean;
    bell: boolean;
    dashboard: boolean;
    /** ntfy.sh topic URL for phone push, e.g. https://ntfy.sh/agentdeck-arnav */
    ntfyTopicUrl?: string;
  };
  /** Optional provider usage API config. */
  usage?: {
    anthropicAdminKey?: string;
    openaiKey?: string;
  };
  /** Session considered idle after this many ms with no activity. */
  idleAfterMs: number;
  /** Drop finished sessions from the deck after this many ms. */
  reapAfterMs: number;
  /** Optional pricing overrides (per-1M-token). */
  pricing?: Record<string, ModelPricing>;
}

export const DEFAULT_CONFIG: AgentDeckConfig = {
  port: 4317,
  pollIntervalMs: 3000,
  collectors: {
    claudeCode: true,
    processScan: true,
    usage: false,
    heartbeat: true,
  },
  alerts: {
    desktop: true,
    bell: true,
    dashboard: true,
    ntfyTopicUrl: undefined,
  },
  idleAfterMs: 90_000,
  reapAfterMs: 30 * 60_000,
};

export function loadConfig(): AgentDeckConfig {
  const explicit = process.env.AGENTDECK_CONFIG;
  const candidates = [explicit, resolve(process.cwd(), "agentdeck.config.json")].filter(
    Boolean,
  ) as string[];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        return deepMerge(DEFAULT_CONFIG, raw);
      } catch (err) {
        console.error(`[agentdeck] failed to parse config ${path}:`, err);
      }
    }
  }
  return { ...DEFAULT_CONFIG };
}

/** Path we write user config to (cwd/agentdeck.config.json, or AGENTDECK_CONFIG). */
export function configPath(): string {
  return process.env.AGENTDECK_CONFIG || resolve(process.cwd(), "agentdeck.config.json");
}

/**
 * Merge a partial patch into the on-disk config (creating it if absent) and
 * return the path written. Used by CLI helpers like `set-push`.
 */
export function writeConfigPatch(patch: Record<string, any>): string {
  const path = configPath();
  let current: any = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* start fresh if unreadable */
    }
  }
  const merged = deepMerge(current, patch);
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  return path;
}

/** Generate a hard-to-guess ntfy topic URL. */
export function randomNtfyTopic(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `https://ntfy.sh/agentdeck-${rand}`;
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof (out as any)[k] === "object") {
      out[k] = deepMerge((out as any)[k], v as any);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Claude Code collector.
 *
 * Two signals are combined:
 *   1. Transcript parsing (accurate tokens + last activity): Claude Code writes
 *      a JSONL transcript per session under ~/.claude/projects/<encoded-cwd>/.
 *      We read the newest transcript per project and sum token usage.
 *   2. The hook reporter (accurate status + mode): the bundled hooks POST to the
 *      /api/hook endpoint on Notification / Stop / UserPromptSubmit events. That
 *      is what turns a card red with "waiting for input". See src/hooks/.
 *
 * This collector owns signal (1). Signal (2) arrives via the heartbeat/hook
 * intake in the server and is merged by session id.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Collector } from "./collector.js";
import type { SessionStore } from "../core/store.js";
import { emptyUsage, type AgentSession, type TokenUsage } from "../core/types.js";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

interface TranscriptScan {
  sessionId: string;
  cwd?: string;
  usage: TokenUsage;
  model?: string;
  lastActivity: number;
  lastAssistantText?: string;
}

/** Decode Claude Code's project folder name back to a filesystem path. */
function decodeProjectDir(name: string): string {
  // Claude Code replaces path separators and dots with dashes; we can't fully
  // invert it, but the label just needs to be human-recognizable.
  return name.replace(/^-/, "/").replace(/-/g, "/");
}

function scanTranscript(file: string): TranscriptScan | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const usage = emptyUsage();
  let sessionId = "";
  let cwd: string | undefined;
  let model: string | undefined;
  let lastActivity = 0;
  let lastAssistantText: string | undefined;

  for (const line of lines) {
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.sessionId) sessionId = ev.sessionId;
    if (ev.cwd) cwd = ev.cwd;
    if (ev.timestamp) {
      const t = Date.parse(ev.timestamp);
      if (!Number.isNaN(t)) lastActivity = Math.max(lastActivity, t);
    }
    const msg = ev.message;
    if (msg?.usage) {
      usage.input += msg.usage.input_tokens ?? 0;
      usage.output += msg.usage.output_tokens ?? 0;
      usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;
    }
    if (msg?.model) model = msg.model;
    if (ev.type === "assistant" && Array.isArray(msg?.content)) {
      const textPart = msg.content.find((c: any) => c.type === "text");
      if (textPart?.text) lastAssistantText = String(textPart.text).slice(0, 200);
    }
  }

  if (!sessionId) {
    // Fall back to filename (session id) if no event carried it.
    const base = file.split(/[\\/]/).pop() ?? file;
    sessionId = base.replace(/\.jsonl$/, "");
  }
  return { sessionId, cwd, usage, model, lastActivity, lastAssistantText };
}

/** Newest transcript file per project folder. */
function newestTranscripts(): string[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  const out: string[] = [];
  for (const proj of readdirSync(PROJECTS_DIR)) {
    const dir = join(PROJECTS_DIR, proj);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    let newest: { file: string; mtime: number } | null = null;
    for (const f of files) {
      const full = join(dir, f);
      try {
        const m = statSync(full).mtimeMs;
        if (!newest || m > newest.mtime) newest = { file: full, mtime: m };
      } catch {
        /* ignore */
      }
    }
    if (newest) out.push(newest.file);
  }
  return out;
}

export class ClaudeCodeCollector implements Collector {
  name = "claude-code";

  poll(store: SessionStore) {
    const now = Date.now();
    for (const file of newestTranscripts()) {
      const scan = scanTranscript(file);
      if (!scan) continue;

      // Only surface sessions with recent-ish activity (last 6h) so we don't
      // resurrect ancient transcripts on every launch.
      if (scan.lastActivity && now - scan.lastActivity > 6 * 3600_000) continue;

      const label = scan.cwd
        ? scan.cwd.split(/[\\/]/).pop() || scan.cwd
        : decodeProjectDir(file.split(/[\\/]/).slice(-2, -1)[0] ?? "claude");

      // Status here is a heuristic from the transcript alone; the hook reporter
      // overrides it with the accurate value when installed.
      const recentlyActive = scan.lastActivity && now - scan.lastActivity < 60_000;

      const patch: Partial<AgentSession> & { id: string; tool: string; source: string } = {
        id: scan.sessionId,
        tool: "claude-code",
        source: "claude-code",
        label,
        cwd: scan.cwd,
        usage: scan.usage,
        model: scan.model,
        lastActivity: scan.lastActivity || now,
        currentAction: scan.lastAssistantText,
      };

      // Do NOT clobber a status/mode already set by the hook reporter.
      const existing = store.get(scan.sessionId);
      const hookOwned = existing?.meta?.hookOwned === true;
      if (!hookOwned) {
        patch.status = recentlyActive ? "running" : "idle";
      }
      store.upsert(patch);
    }
  }
}

/**
 * Generic AI-CLI process scanner. Detects other AI coding tools running on the
 * machine by matching their process command lines. Gives visibility even for
 * tools that don't emit hooks/heartbeats — status is coarse (running/idle),
 * tokens unknown, but at least they appear on the deck.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Collector } from "./collector.js";
import type { SessionStore } from "../core/store.js";

const pexec = promisify(execFile);

interface Signature {
  tool: string;
  /** RegExp tested against the process command line. */
  match: RegExp;
}

/** Known AI CLI signatures. Extend freely. */
const SIGNATURES: Signature[] = [
  { tool: "aider", match: /(^|\/|\s)aider(\s|$)/ },
  { tool: "codex", match: /(^|\/|\s)codex(\s|$)/ },
  { tool: "gemini-cli", match: /(^|\/|\s)gemini(\s|$)/ },
  { tool: "cursor-agent", match: /cursor-agent/ },
  { tool: "opencode", match: /(^|\/|\s)opencode(\s|$)/ },
  { tool: "goose", match: /(^|\/|\s)goose(\s|$)/ },
  { tool: "claude-code", match: /(^|\/|\s)claude(\s|$)/ },
];

interface ProcRow {
  pid: number;
  cmd: string;
}

async function listProcesses(): Promise<ProcRow[]> {
  // Linux/WSL/macOS: `ps -eo pid=,args=`. On Windows we'd shell out differently,
  // but AgentDeck's target is the WSL account, so ps is the right primitive.
  try {
    const { stdout } = await pexec("ps", ["-eo", "pid=,args="], { maxBuffer: 8 * 1024 * 1024 });
    const rows: ProcRow[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sp = trimmed.indexOf(" ");
      if (sp < 0) continue;
      const pid = Number(trimmed.slice(0, sp));
      const cmd = trimmed.slice(sp + 1).trim();
      if (!Number.isNaN(pid)) rows.push({ pid, cmd });
    }
    return rows;
  } catch {
    return [];
  }
}

/** Extract a working-dir-ish label from a command line if it carries a path. */
function guessLabel(cmd: string, tool: string): string {
  const m = cmd.match(/(?:\/[\w.\-]+)+/);
  if (m) {
    const parts = m[0].split("/").filter(Boolean);
    return `${tool}:${parts[parts.length - 1]}`;
  }
  return tool;
}

export class ProcessScanCollector implements Collector {
  name = "process-scan";
  private seen = new Set<number>();

  async poll(store: SessionStore) {
    const procs = await listProcesses();
    const alive = new Set<number>();

    for (const p of procs) {
      const sig = SIGNATURES.find((s) => s.match.test(p.cmd));
      if (!sig) continue;
      // Skip AgentDeck itself and obvious noise.
      if (/agentdeck/i.test(p.cmd)) continue;
      alive.add(p.pid);

      const id = `${sig.tool}#${p.pid}`;
      // Claude Code is better served by its own collector/hooks; only use the
      // process scan for it as a last-resort presence signal (no hook-owned id).
      const existing = store.get(id);
      if (existing?.meta?.hookOwned) continue;

      store.upsert({
        id,
        tool: sig.tool,
        source: "process-scan",
        label: guessLabel(p.cmd, sig.tool),
        pid: p.pid,
        status: "running",
        mode: "unknown",
        currentAction: p.cmd.length > 120 ? p.cmd.slice(0, 117) + "..." : p.cmd,
      });
    }

    // Anything we saw before via process-scan that is now gone => done.
    for (const pid of this.seen) {
      if (!alive.has(pid)) {
        for (const s of store.all()) {
          if (s.source === "process-scan" && s.pid === pid && s.status !== "done") {
            store.upsert({ id: s.id, tool: s.tool, source: s.source, status: "done" });
          }
        }
      }
    }
    this.seen = alive;
  }
}

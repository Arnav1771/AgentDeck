/**
 * Installs Claude Code hooks that report session state to AgentDeck. This is
 * what makes "waiting for input" and auto/manual mode accurate rather than
 * heuristic. It edits ~/.claude/settings.json, adding hooks that POST the hook
 * JSON to the local AgentDeck server.
 *
 * Idempotent: re-running updates the AgentDeck hooks and leaves your others
 * untouched. `agentdeck uninstall-hooks` removes only what we added.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const SETTINGS = join(homedir(), ".claude", "settings.json");
const MARKER = "agentdeck"; // we tag our hook commands so we can find/remove them

/** Events we care about and the curl command each runs. */
const HOOK_EVENTS = ["Notification", "UserPromptSubmit", "PreToolUse", "Stop", "SessionEnd"];

function curlCommand(port: number): string {
  // Claude Code pipes the hook JSON to the command on stdin. We forward it
  // verbatim to AgentDeck. `# agentdeck` marker lets us identify our entry.
  return `curl -s -m 2 -X POST http://127.0.0.1:${port}/api/hook -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 # ${MARKER}`;
}

function loadSettings(): any {
  if (!existsSync(SETTINGS)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS, "utf8"));
  } catch {
    console.error(`[agentdeck] ${SETTINGS} is not valid JSON — aborting to avoid clobbering it.`);
    process.exit(1);
  }
}

function isOurs(entry: any): boolean {
  return JSON.stringify(entry).includes(MARKER);
}

export function installHooks(port: number) {
  const settings = loadSettings();
  settings.hooks = settings.hooks ?? {};
  const cmd = curlCommand(port);

  for (const event of HOOK_EVENTS) {
    const arr = (settings.hooks[event] = settings.hooks[event] ?? []);
    // Remove any prior agentdeck entry for this event, then add fresh.
    const filtered = arr.filter((g: any) => !isOurs(g));
    filtered.push({ hooks: [{ type: "command", command: cmd }] });
    settings.hooks[event] = filtered;
  }

  mkdirSync(dirname(SETTINGS), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`✔ Installed AgentDeck hooks for: ${HOOK_EVENTS.join(", ")}`);
  console.log(`  → ${SETTINGS}`);
  console.log(`  Claude Code will now report status to http://127.0.0.1:${port}`);
  console.log(`  Restart any open Claude Code sessions to pick up the hooks.`);
}

export function uninstallHooks() {
  const settings = loadSettings();
  if (!settings.hooks) {
    console.log("No hooks configured — nothing to remove.");
    return;
  }
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const arr = settings.hooks[event];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((g: any) => {
      if (isOurs(g)) { removed++; return false; }
      return true;
    });
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`✔ Removed ${removed} AgentDeck hook(s) from ${SETTINGS}`);
}

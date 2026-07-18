/**
 * Terminal dashboard. Connects to a running AgentDeck server over WebSocket and
 * renders a live table. A red banner + bell fires whenever an agent needs input,
 * so it's useful in a spare WSL pane while you work.
 *
 * Usage: `agentdeck tui`  (start `agentdeck serve` first, or in another pane).
 */
import blessed from "blessed";
import WebSocket from "ws";
import type { AgentSession, DeckSummary } from "../core/types.js";

const STATUS_COLOR: Record<string, string> = {
  running: "green",
  waiting_input: "red",
  idle: "yellow",
  done: "gray",
  error: "red",
  unknown: "gray",
};

export function runTui(serverUrl: string) {
  const wsUrl = serverUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";

  const screen = blessed.screen({ smartCSR: true, title: "AgentDeck" });
  screen.key(["q", "C-c"], () => process.exit(0));

  const header = blessed.box({
    top: 0, left: 0, width: "100%", height: 3,
    tags: true, border: "line",
    style: { border: { fg: "blue" } },
    content: "{bold}◈ AgentDeck{/bold}  — connecting…",
  });

  const banner = blessed.box({
    top: 3, left: 0, width: "100%", height: 3, tags: true, hidden: true,
    style: { bg: "red", fg: "white", bold: true }, align: "center", valign: "middle",
  });

  const table = blessed.listtable({
    top: 3, left: 0, width: "100%", bottom: 1,
    tags: true, border: "line", align: "left",
    style: {
      border: { fg: "blue" },
      header: { fg: "cyan", bold: true },
      cell: { fg: "white" },
    },
  });

  const foot = blessed.box({
    bottom: 0, left: 0, width: "100%", height: 1, tags: true,
    content: " q quit  •  live view of every AI agent on this machine",
    style: { fg: "gray" },
  });

  screen.append(header);
  screen.append(banner);
  screen.append(table);
  screen.append(foot);
  screen.render();

  let sessions = new Map<string, AgentSession>();

  function fmtNum(n: number) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }
  function tokensOf(u: AgentSession["usage"]) {
    return u.input + u.output + u.cacheRead + u.cacheWrite;
  }
  function ago(ts: number) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    return Math.floor(s / 3600) + "h";
  }

  function draw(summary?: DeckSummary) {
    const list = [...sessions.values()].sort((a, b) => {
      const rank = (s: AgentSession) =>
        s.status === "waiting_input" ? 0 : s.status === "running" ? 1 : 2;
      return rank(a) - rank(b) || b.lastActivity - a.lastActivity;
    });

    const rows: string[][] = [["", "AGENT", "TOOL", "STATUS", "MODE", "TOKENS", "COST", "AGE", "ACTION"]];
    for (const s of list) {
      const color = STATUS_COLOR[s.status] ?? "white";
      const dot = `{${color}-fg}●{/}`;
      const action =
        s.status === "waiting_input" && s.waitingReason
          ? `{red-fg}${s.waitingReason}{/}`
          : (s.currentAction ?? "").slice(0, 40);
      rows.push([
        dot,
        s.label.slice(0, 22),
        s.tool.slice(0, 12),
        `{${color}-fg}${s.status.replace("_", " ")}{/}`,
        s.mode,
        fmtNum(tokensOf(s.usage)),
        s.meta?.account ? `$${Number(s.meta.billedUsdToday).toFixed(2)}` : `$${s.costUsd.toFixed(3)}`,
        ago(s.lastActivity),
        action,
      ]);
    }
    table.setData(rows);

    const waiting = list.filter((s) => s.status === "waiting_input");
    if (waiting.length) {
      banner.show();
      banner.setContent(
        `⚠  ${waiting.length} AGENT(S) WAITING FOR INPUT: ${waiting.map((s) => s.label).join(", ")}`,
      );
      table.top = 6;
      table.height = (screen.height as number) - 7;
    } else {
      banner.hide();
      table.top = 3;
      table.height = (screen.height as number) - 4;
    }

    if (summary) {
      header.setContent(
        `{bold}◈ AgentDeck{/bold}   sessions {bold}${summary.totalSessions}{/}  ` +
          `{green-fg}running ${summary.running}{/}  {red-fg}need input ${summary.waitingInput}{/}  ` +
          `tokens {bold}${fmtNum(summary.totalTokens)}{/}  {blue-fg}est \$${summary.totalCostUsd.toFixed(2)}{/}`,
      );
    }
    screen.render();
  }

  let lastWaiting = 0;
  function connect() {
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      (header.style as any).border = { fg: "green" };
      screen.render();
    });
    ws.on("close", () => {
      header.setContent("{bold}◈ AgentDeck{/bold}  — disconnected, retrying…");
      screen.render();
      setTimeout(connect, 2000);
    });
    ws.on("error", () => {});
    ws.on("message", (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "snapshot") sessions = new Map(msg.sessions.map((s: AgentSession) => [s.id, s]));
      else if (msg.type === "upsert") sessions.set(msg.session.id, msg.session);
      else if (msg.type === "remove") sessions.delete(msg.session.id);

      const waitingNow = [...sessions.values()].filter((s) => s.status === "waiting_input").length;
      if (waitingNow > lastWaiting) process.stdout.write(String.fromCharCode(7)); // bell on new wait
      lastWaiting = waitingNow;

      draw(msg.summary);
    });
  }

  // Repaint every second to keep the age column fresh.
  setInterval(() => draw(), 1000);
  connect();
}

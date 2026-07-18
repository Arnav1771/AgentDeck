#!/usr/bin/env node
/**
 * AgentDeck CLI entrypoint.
 *
 *   agentdeck serve            start the dashboard + API server (default)
 *   agentdeck tui              open the terminal dashboard (needs a running server)
 *   agentdeck install-hooks    wire Claude Code hooks -> AgentDeck (accurate status)
 *   agentdeck uninstall-hooks  remove those hooks
 *   agentdeck doctor           check environment and connectivity
 */
import { Command } from "commander";
import { loadConfig, writeConfigPatch, randomNtfyTopic } from "./core/config.js";
import { SessionStore } from "./core/store.js";
import { HistoryRecorder } from "./core/history.js";
import { startServer } from "./server/server.js";
import { Alerter } from "./alerts/alerter.js";
import { ClaudeCodeCollector } from "./collectors/claudeCode.js";
import { ProcessScanCollector } from "./collectors/processScan.js";
import { UsageCollector } from "./collectors/usage.js";
import { HeartbeatCollector } from "./collectors/heartbeat.js";
import type { Collector } from "./collectors/collector.js";
import { installHooks, uninstallHooks } from "./hooks/install.js";
import { runTui } from "./tui/tui.js";

const program = new Command();
program.name("agentdeck").description("Control tower for AI coding agents").version("0.1.0");

program
  .command("serve", { isDefault: true })
  .description("Start the dashboard + heartbeat/hook API")
  .option("-p, --port <port>", "override port")
  .action(async (opts) => {
    const config = loadConfig();
    if (opts.port) config.port = Number(opts.port);

    const store = new SessionStore({
      pricing: config.pricing,
      idleAfterMs: config.idleAfterMs,
      reapAfterMs: config.reapAfterMs,
    });

    new Alerter(store, config).start();

    const collectors: Collector[] = [];
    if (config.collectors.claudeCode) collectors.push(new ClaudeCodeCollector());
    if (config.collectors.processScan) collectors.push(new ProcessScanCollector());
    if (config.collectors.usage) collectors.push(new UsageCollector());
    if (config.collectors.heartbeat) collectors.push(new HeartbeatCollector());

    for (const c of collectors) await c.start?.(store, config);

    const history = new HistoryRecorder(store);
    history.start(60_000);

    startServer(store, config, history);

    const tick = async () => {
      for (const c of collectors) {
        try {
          await c.poll?.(store, config);
        } catch (e: any) {
          console.error(`[collector:${c.name}]`, e?.message ?? e);
        }
      }
      store.sweep();
    };
    await tick();
    setInterval(tick, config.pollIntervalMs);

    console.log(
      `  Collectors: ${collectors.map((c) => c.name).join(", ")} · poll ${config.pollIntervalMs}ms`,
    );
    if (config.alerts.ntfyTopicUrl) console.log(`  Phone push → ${config.alerts.ntfyTopicUrl}`);
  });

program
  .command("tui")
  .description("Open the terminal dashboard (connects to a running server)")
  .option("-u, --url <url>", "server url", "http://127.0.0.1:4317")
  .action((opts) => {
    const config = loadConfig();
    const url = opts.url ?? `http://127.0.0.1:${config.port}`;
    runTui(url);
  });

program
  .command("install-hooks")
  .description("Install Claude Code hooks so it reports accurate status to AgentDeck")
  .option("-p, --port <port>", "server port the hooks post to")
  .action((opts) => {
    const config = loadConfig();
    installHooks(opts.port ? Number(opts.port) : config.port);
  });

program
  .command("uninstall-hooks")
  .description("Remove AgentDeck's Claude Code hooks")
  .action(() => uninstallHooks());

program
  .command("mcp")
  .description("Run the AgentDeck MCP server (stdio) so Claude Code can query the deck")
  .action(async () => {
    const { runMcp } = await import("./mcp/server.js");
    await runMcp();
  });

program
  .command("set-push")
  .description("Configure phone push (ntfy). Pass a topic URL, or omit to generate one.")
  .argument("[topicUrl]", "ntfy topic URL, e.g. https://ntfy.sh/agentdeck-xyz")
  .action((topicUrl?: string) => {
    const url = topicUrl || randomNtfyTopic();
    const path = writeConfigPatch({ alerts: { ntfyTopicUrl: url } });
    const topic = url.split("/").pop();
    console.log(`✔ Phone push configured → ${url}`);
    console.log(`  Written to ${path}`);
    console.log(`\n  To receive alerts on your phone:`);
    console.log(`   1. Install the free "ntfy" app (iOS / Android).`);
    console.log(`   2. Subscribe to topic:  ${topic}`);
    console.log(`   3. Restart \`agentdeck serve\`. You'll get a push whenever an agent needs input.`);
    console.log(`\n  Test it now:  curl -d "hello from AgentDeck" ${url}`);
  });

program
  .command("doctor")
  .description("Diagnose environment + connectivity")
  .action(async () => {
    const config = loadConfig();
    const { homedir } = await import("node:os");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    console.log("AgentDeck doctor\n----------------");
    console.log("node:", process.version);
    console.log("platform:", process.platform);
    console.log("port:", config.port);
    const claudeDir = join(homedir(), ".claude", "projects");
    console.log(".claude/projects present:", existsSync(claudeDir) ? "yes" : "no");
    console.log("collectors:", JSON.stringify(config.collectors));
    console.log("alerts:", JSON.stringify(config.alerts));
    try {
      const res = await fetch(`http://127.0.0.1:${config.port}/api/summary`);
      const sm = await res.json();
      console.log("server reachable: yes", sm);
    } catch {
      console.log("server reachable: no (start it with `agentdeck serve`)");
    }
  });

program.parseAsync(process.argv);

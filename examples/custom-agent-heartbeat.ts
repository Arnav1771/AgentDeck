/**
 * Example: make your own agent/script show up on AgentDeck.
 * Run `agentdeck serve` first, then: `npx tsx examples/custom-agent-heartbeat.ts`
 */
import { AgentDeckReporter } from "../src/sdk/heartbeat.js";

async function main() {
  const deck = new AgentDeckReporter({
    id: "demo-swarm-1",
    tool: "langgraph",
    label: "WFM RCA swarm (demo)",
    model: "claude-sonnet",
  });

  deck.setMode("auto");
  await deck.running("loading tickets");
  await sleep(1500);

  await deck.addTokens({ input: 4200, output: 800 });
  await deck.running("classifying root causes");
  await sleep(1500);

  // Ask the human something — this flashes the card red + fires alerts.
  await deck.waitingInput("Approve proposed RCA for ticket #33394?");
  await sleep(4000);

  deck.setMode("manual");
  await deck.running("applying approved fix");
  await deck.addTokens({ input: 1100, output: 1900 });
  await sleep(1500);

  await deck.done("finished");
  console.log("demo complete");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
main();

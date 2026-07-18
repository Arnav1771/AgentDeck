/**
 * Provider usage / subscription-spend collector.
 *
 * Surfaces real billed spend (not just local token estimates) as a special
 * "account" pseudo-session so the deck can show "credits burned this period".
 * Anthropic exposes an Admin usage/cost API; OpenAI exposes usage endpoints.
 * Both require keys and are OFF by default (config.collectors.usage).
 *
 * This is intentionally defensive: if a key is missing or the endpoint shape
 * changes, it degrades to a no-op rather than crashing the deck.
 */
import type { Collector } from "./collector.js";
import type { SessionStore } from "../core/store.js";
import type { AgentDeckConfig } from "../core/config.js";

export class UsageCollector implements Collector {
  name = "usage";

  async poll(store: SessionStore, config: AgentDeckConfig) {
    const anthropicKey = config.usage?.anthropicAdminKey || process.env.ANTHROPIC_ADMIN_KEY;
    if (anthropicKey) {
      await this.pollAnthropic(store, anthropicKey).catch((e) =>
        console.error("[usage] anthropic poll failed:", e?.message ?? e),
      );
    }
  }

  private async pollAnthropic(store: SessionStore, key: string) {
    // Anthropic Admin cost report: sum of amounts for the current UTC day.
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const url =
      "https://api.anthropic.com/v1/organizations/cost_report" +
      `?starting_at=${encodeURIComponent(start.toISOString())}`;
    const res = await fetch(url, {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      throw new Error(`cost_report HTTP ${res.status}`);
    }
    const data: any = await res.json();
    let totalUsd = 0;
    for (const bucket of data?.data ?? []) {
      for (const item of bucket?.results ?? []) {
        totalUsd += Number(item?.amount ?? 0);
      }
    }
    const now = Date.now();
    store.upsert({
      id: "account:anthropic",
      tool: "anthropic-account",
      source: "usage",
      label: "Anthropic spend (today)",
      status: "running",
      mode: "auto",
      currentAction: `$${totalUsd.toFixed(2)} billed today (org cost report)`,
      lastActivity: now,
      // costUsd is derived from tokens for real sessions; for the account row we
      // stash the billed number in meta and mirror it in currentAction.
      meta: { billedUsdToday: totalUsd, account: true },
    });
  }
}

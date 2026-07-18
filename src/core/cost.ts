/**
 * Pricing table + cost math. Prices are USD per 1M tokens and are approximate;
 * they exist so the dashboard can show "credits burned" as a live number.
 * Override any of these via config (`pricing` key).
 */
import type { TokenUsage } from "./types.js";

export interface ModelPricing {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
  cacheRead: number; // USD per 1M cache-read tokens
  cacheWrite: number; // USD per 1M cache-write tokens
}

/** Default per-1M-token prices. Update as provider pricing changes. */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Anthropic (Claude)
  "claude-opus": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  // OpenAI-ish fallbacks
  "gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  // Generic fallback used when the model is unknown.
  default: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

/** Pick a pricing row for a model id via fuzzy family match. */
export function pricingFor(
  model: string | undefined,
  table: Record<string, ModelPricing>,
): ModelPricing {
  if (!model) return table.default;
  const m = model.toLowerCase();
  if (m.includes("opus")) return table["claude-opus"] ?? table.default;
  if (m.includes("sonnet")) return table["claude-sonnet"] ?? table.default;
  if (m.includes("haiku")) return table["claude-haiku"] ?? table.default;
  if (m.includes("4o-mini") || m.includes("mini"))
    return table["gpt-4o-mini"] ?? table.default;
  if (m.includes("gpt-4o") || m.includes("gpt-4")) return table["gpt-4o"] ?? table.default;
  // exact key hit?
  if (table[m]) return table[m];
  return table.default;
}

/** Compute USD cost for a usage bundle under a given model. */
export function costOf(
  usage: TokenUsage,
  model: string | undefined,
  table: Record<string, ModelPricing> = DEFAULT_PRICING,
): number {
  const p = pricingFor(model, table);
  const cost =
    (usage.input * p.input +
      usage.output * p.output +
      usage.cacheRead * p.cacheRead +
      usage.cacheWrite * p.cacheWrite) /
    1_000_000;
  return Math.round(cost * 10000) / 10000; // 4dp
}

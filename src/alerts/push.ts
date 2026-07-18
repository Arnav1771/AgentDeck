/**
 * Phone push via ntfy.sh (or a self-hosted ntfy). Zero-account: publish to a
 * topic URL and subscribe on your phone with the ntfy app. Configure with
 * alerts.ntfyTopicUrl, e.g. "https://ntfy.sh/agentdeck-<something-random>".
 */
import type { AlertPayload } from "../core/types.js";

export async function ntfyPush(topicUrl: string, alert: AlertPayload): Promise<void> {
  try {
    await fetch(topicUrl, {
      method: "POST",
      headers: {
        Title: alert.title,
        Priority: alert.kind === "waiting_input" ? "urgent" : "high",
        Tags: alert.kind === "waiting_input" ? "bell,keyboard" : "warning",
      },
      body: alert.body,
    });
  } catch (e: any) {
    console.error("[push] ntfy failed:", e?.message ?? e);
  }
}

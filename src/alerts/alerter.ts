/**
 * Alert dispatcher. Subscribes to the store's event bus and fans "alert" events
 * out to every enabled channel. De-dupes so a flapping session doesn't spam.
 */
import type { SessionStore } from "../core/store.js";
import type { AgentDeckConfig } from "../core/config.js";
import type { AlertPayload, SessionEvent } from "../core/types.js";
import { desktopNotify } from "./desktop.js";
import { ntfyPush } from "./push.js";
import { terminalBell } from "./bell.js";

export class Alerter {
  private lastFired = new Map<string, number>();
  private minGapMs = 15_000;

  constructor(private store: SessionStore, private config: AgentDeckConfig) {}

  start() {
    this.store.on("event", (ev: SessionEvent) => {
      if (ev.type !== "alert" || !ev.alert) return;
      this.dispatch(ev.alert);
    });
  }

  private dispatch(alert: AlertPayload) {
    const key = `${alert.sessionId}:${alert.kind}`;
    const now = Date.now();
    const last = this.lastFired.get(key) ?? 0;
    if (now - last < this.minGapMs) return;
    this.lastFired.set(key, now);

    const { alerts } = this.config;
    if (alerts.bell) terminalBell();
    if (alerts.desktop) void desktopNotify(alert.title, alert.body);
    if (alerts.ntfyTopicUrl) void ntfyPush(alerts.ntfyTopicUrl, alert);
    // dashboard highlight is handled by the web/TUI client reading the alert
    // event over WS; nothing to do here.
  }
}

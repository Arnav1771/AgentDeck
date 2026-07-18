/** A collector observes the system and pushes sessions into the store. */
import type { SessionStore } from "../core/store.js";
import type { AgentDeckConfig } from "../core/config.js";

export interface Collector {
  name: string;
  /** Called once at startup (register watchers, endpoints, etc.). */
  start?(store: SessionStore, config: AgentDeckConfig): void | Promise<void>;
  /** Called every poll tick for pull-based collectors. May be omitted. */
  poll?(store: SessionStore, config: AgentDeckConfig): void | Promise<void>;
  /** Cleanup. */
  stop?(): void | Promise<void>;
}

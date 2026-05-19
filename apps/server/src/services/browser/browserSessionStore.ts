import { randomUUID } from "node:crypto";
import type { BrowserSession } from "../../types/browserAutomation.js";
import { browserSessionSchema } from "../../types/browserAutomation.js";

type BrowserSessionStoreOptions = {
  now?: () => Date;
};

export class BrowserSessionStore {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly now: () => Date;

  constructor(options: BrowserSessionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createSession(args: {
    allowedDomains: string[];
    state?: BrowserSession["state"];
    notes?: string[];
    ttlMinutes?: number | null;
  }) {
    const createdAt = this.now();
    const expiresAt =
      typeof args.ttlMinutes === "number"
        ? new Date(createdAt.getTime() + args.ttlMinutes * 60_000).toISOString()
        : null;
    const session = browserSessionSchema.parse({
      sessionId: `browser-session::${randomUUID()}`,
      state: args.state ?? "proposed",
      allowedDomains: args.allowedDomains,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      expiresAt,
      notes: args.notes ?? []
    });
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  stopSession(sessionId: string, note = "Session stopped by governance policy.") {
    const current = this.sessions.get(sessionId);
    if (!current) {
      return null;
    }
    const next = browserSessionSchema.parse({
      ...current,
      state: "stopped",
      updatedAt: this.now().toISOString(),
      notes: [...current.notes, note].slice(-8)
    });
    this.sessions.set(sessionId, next);
    return next;
  }

  listSessions() {
    return [...this.sessions.values()];
  }
}

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExecutionAuditEvent,
  ExecutionAuditStat,
  ExecutionAuditSummary
} from "../../types/execution.js";
import {
  executionAuditEventSchema,
  executionAuditSummarySchema
} from "../../types/execution.js";

type ExecutionAuditStoreOptions = {
  filePath?: string | null;
  maxEvents?: number;
};

export type ExecutionAuditListOptions = {
  limit?: number;
  since?: string | Date | null;
  until?: string | Date | null;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../../");
export const defaultExecutionAuditFile = resolve(
  projectRoot,
  "storage",
  "observability",
  "execution-audit-events-v1.jsonl"
);

const sensitiveHeaderPattern =
  /^(set-cookie|cookie|authorization|proxy-authorization|x-api-key|x-hydria-api-key|api-key)$/i;

function normalizeDateInput(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeListOptions(options: number | ExecutionAuditListOptions = 100) {
  if (typeof options === "number") {
    return {
      limit: Math.max(1, Math.round(options)),
      since: null,
      until: null
    };
  }
  return {
    limit: Math.max(1, Math.round(options.limit ?? 100)),
    since: normalizeDateInput(options.since),
    until: normalizeDateInput(options.until)
  };
}

function emptyStat(): ExecutionAuditStat {
  return {
    count: 0,
    allowedCount: 0,
    deniedCount: 0,
    disabledCount: 0,
    requiresReviewCount: 0,
    rollbackRequiredCount: 0
  };
}

function addToStat(stat: ExecutionAuditStat, event: ExecutionAuditEvent) {
  stat.count += 1;
  if (event.permissionDecision.allowed) {
    stat.allowedCount += 1;
  }
  if (event.permissionDecision.state === "denied") {
    stat.deniedCount += 1;
  }
  if (event.permissionDecision.state === "disabled") {
    stat.disabledCount += 1;
  }
  if (event.permissionDecision.state === "requires_review") {
    stat.requiresReviewCount += 1;
  }
  if (event.rollbackHint.required) {
    stat.rollbackRequiredCount += 1;
  }
}

function groupStats(events: readonly ExecutionAuditEvent[], key: (event: ExecutionAuditEvent) => string) {
  const grouped: Record<string, ExecutionAuditStat> = {};
  for (const event of events) {
    const groupKey = key(event);
    grouped[groupKey] ??= emptyStat();
    addToStat(grouped[groupKey], event);
  }
  return grouped;
}

function sanitizeHeaders(headers: Record<string, string> | undefined) {
  if (!headers) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => !sensitiveHeaderPattern.test(key))
      .slice(0, 24)
      .map(([key, value]) => [key.toLowerCase(), String(value).slice(0, 240)])
  );
}

export function sanitizeExecutionAuditEvent(input: ExecutionAuditEvent) {
  const parsed = executionAuditEventSchema.parse(input);
  return executionAuditEventSchema.parse({
    ...parsed,
    acquisitionScore: parsed.acquisitionScore
      ? {
          ...parsed.acquisitionScore,
          responseHeaders: sanitizeHeaders(parsed.acquisitionScore.responseHeaders)
        }
      : null
  });
}

function hasSensitiveHeaderLeak(event: ExecutionAuditEvent) {
  return Object.keys(event.acquisitionScore?.responseHeaders ?? {}).some((header) =>
    sensitiveHeaderPattern.test(header)
  );
}

function realExecutionStepCount(events: readonly ExecutionAuditEvent[]) {
  return events.reduce(
    (count, event) => count + event.dryRunPlan.steps.filter((step) => step.wouldExecute).length,
    0
  );
}

export class ExecutionAuditStore {
  private readonly events: ExecutionAuditEvent[] = [];
  private readonly filePath: string | null;
  private readonly maxEvents: number;

  constructor(options: ExecutionAuditStoreOptions = {}) {
    this.filePath = options.filePath ?? null;
    this.maxEvents = Math.max(100, Math.round(options.maxEvents ?? 5000));
  }

  static persistent(options: Omit<ExecutionAuditStoreOptions, "filePath"> & { filePath?: string } = {}) {
    return new ExecutionAuditStore({
      ...options,
      filePath: options.filePath ?? defaultExecutionAuditFile
    });
  }

  async record(event: ExecutionAuditEvent) {
    const parsed = sanitizeExecutionAuditEvent(event);
    this.events.push(parsed);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    if (this.filePath) {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(parsed)}\n`, "utf8");
      await this.compactIfNeeded();
    }
    return parsed;
  }

  async list(options: number | ExecutionAuditListOptions = 100) {
    const normalized = normalizeListOptions(options);
    const events = this.filePath ? await this.readFileEvents() : [...this.events];
    return events
      .filter((event) => {
        const createdAt = new Date(event.createdAt).getTime();
        if (!Number.isFinite(createdAt)) {
          return false;
        }
        if (normalized.since && createdAt < normalized.since.getTime()) {
          return false;
        }
        if (normalized.until && createdAt > normalized.until.getTime()) {
          return false;
        }
        return true;
      })
      .slice(-normalized.limit);
  }

  async getById(auditId: string) {
    const events = await this.list({ limit: this.maxEvents });
    return events.find((event) => event.auditId === auditId) ?? null;
  }

  async writeEventsForTest(events: ExecutionAuditEvent[]) {
    const sanitized = events.map(sanitizeExecutionAuditEvent);
    this.events.splice(0, this.events.length, ...sanitized.slice(-this.maxEvents));
    if (this.filePath) {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(
        this.filePath,
        `${this.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8"
      );
    }
    return this.events;
  }

  async buildSummary(options: number | ExecutionAuditListOptions = 100): Promise<ExecutionAuditSummary> {
    const normalized = normalizeListOptions(options);
    const events = await this.list(normalized);
    const totals = emptyStat();
    for (const event of events) {
      addToStat(totals, event);
    }

    return executionAuditSummarySchema.parse({
      version: "hydria-execution-audit-v1",
      generatedAt: new Date().toISOString(),
      window: {
        eventLimit: normalized.limit,
        eventCount: events.length,
        since: normalized.since?.toISOString() ?? null,
        until: normalized.until?.toISOString() ?? null
      },
      totals: {
        ...totals,
        dryRunOnlyCount: events.filter((event) => event.permissionDecision.state === "dry_run_only").length,
        sensitiveHeaderLeakCount: events.filter(hasSensitiveHeaderLeak).length,
        realExecutionStepCount: realExecutionStepCount(events)
      },
      byCapability: groupStats(events, (event) => event.capability),
      byActionKind: groupStats(events, (event) => event.actionKind),
      byRiskLevel: groupStats(events, (event) => event.permissionDecision.riskLevel),
      recentEvents: events.slice(-25).reverse()
    });
  }

  private async readFileEvents() {
    if (!this.filePath) {
      return [];
    }
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return sanitizeExecutionAuditEvent(JSON.parse(line));
          } catch {
            return null;
          }
        })
        .filter((event): event is ExecutionAuditEvent => Boolean(event));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async compactIfNeeded() {
    if (!this.filePath) {
      return;
    }
    const events = await this.readFileEvents();
    if (events.length <= this.maxEvents) {
      return;
    }
    const compacted = events.slice(-this.maxEvents);
    await writeFile(
      this.filePath,
      `${compacted.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8"
    );
  }
}

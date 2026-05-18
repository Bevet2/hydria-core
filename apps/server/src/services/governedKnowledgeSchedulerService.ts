import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { KnowledgeConsolidationService } from "./knowledgeConsolidationService.js";
import { KnowledgeQualityGateService } from "./knowledgeQualityGateService.js";
import { KnowledgePromotionGovernanceService } from "./knowledgePromotionGovernanceService.js";
import { SourceAcquisitionService } from "./sourceAcquisitionService.js";
import { TrainingQueueValidationService } from "./trainingQueueValidationService.js";
import { WatcherKernel, type WatcherScope } from "./watchers/watcherKernel.js";
import { env } from "../utils/env.js";
import type { SourceAcquisitionFile } from "../types/sourceAcquisition.js";

const schedulerStepStatusSchema = z.enum(["passed", "failed", "skipped"]);
const schedulerStatusSchema = z.enum(["completed", "partial", "failed", "skipped"]);

export const governedKnowledgeSchedulerStepSchema = z.object({
  stepId: z.enum([
    "watchers",
    "source_acquisition",
    "knowledge_quality_gate",
    "knowledge_consolidation",
    "promotion_dry_run",
    "training_queue_validation"
  ]),
  status: schedulerStepStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  summary: z.record(z.string(), z.unknown()).default({}),
  error: z.string().min(1).max(500).nullable().default(null)
});

export const governedKnowledgeSchedulerReportSchema = z.object({
  version: z.literal("hydria-governed-knowledge-scheduler-v1"),
  generatedAt: z.string().datetime(),
  runId: z.string().min(1).max(180),
  status: schedulerStatusSchema,
  reason: z.string().min(1).max(500),
  lastCompletedRunAt: z.string().datetime().nullable().default(null),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  options: z.object({
    networkEnabled: z.boolean(),
    watcherScope: z.enum(["internal", "external", "all"]),
    interactionLimit: z.number().int().positive(),
    minIntervalMinutes: z.number().int().nonnegative(),
    maxRuntimeMinutes: z.number().int().positive(),
    sourceBudget: z.object({
      maxPacks: z.number().int().positive(),
      maxSourcesPerPack: z.number().int().positive(),
      maxItemsPerSource: z.number().int().positive(),
      timeoutMs: z.number().int().positive()
    })
  }),
  safety: z.object({
    noModelExecution: z.literal(true),
    noTraining: z.literal(true),
    noActivePromotion: z.literal(true),
    lockEnabled: z.literal(true),
    boundedNetwork: z.literal(true)
  }),
  sourceStats: z.object({
    stepCount: z.number().int().nonnegative(),
    passedStepCount: z.number().int().nonnegative(),
    failedStepCount: z.number().int().nonnegative(),
    skippedStepCount: z.number().int().nonnegative()
  }),
  steps: z.array(governedKnowledgeSchedulerStepSchema)
});

type SchedulerStep = z.infer<typeof governedKnowledgeSchedulerStepSchema>;
export type GovernedKnowledgeSchedulerReport = z.infer<typeof governedKnowledgeSchedulerReportSchema>;

type GovernedKnowledgeSchedulerOptions = {
  watcherKernel?: Pick<WatcherKernel, "run">;
  sourceAcquisitionService?: Pick<SourceAcquisitionService, "run">;
  knowledgeQualityGateService?: Pick<KnowledgeQualityGateService, "evaluateAndPersist">;
  knowledgeConsolidationService?: Pick<KnowledgeConsolidationService, "buildAndPersist">;
  promotionGovernanceService?: Pick<KnowledgePromotionGovernanceService, "evaluateAndPersist">;
  trainingQueueValidationService?: Pick<TrainingQueueValidationService, "validateAndPersist">;
  reportFile?: string;
  lockFile?: string;
  now?: () => Date;
};

export type GovernedKnowledgeSchedulerRunOptions = {
  force?: boolean;
  networkEnabled?: boolean;
  watcherScope?: WatcherScope;
  rebuildInteractions?: boolean;
  interactionLimit?: number;
  minIntervalMinutes?: number;
  maxRuntimeMinutes?: number;
  maxPacks?: number;
  maxSourcesPerPack?: number;
  maxItemsPerSource?: number;
  timeoutMs?: number;
};

type SchedulerLock = {
  version: "hydria-governed-knowledge-scheduler-lock-v1";
  runId: string;
  startedAt: string;
  maxRuntimeMinutes: number;
  pid: number;
};

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function compact(value: string, maxChars = 500) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return normalized.slice(0, maxChars);
  }

  return `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function elapsedMs(startedAt: string, now: Date) {
  return Math.max(0, now.getTime() - new Date(startedAt).getTime());
}

function defaultReportFile() {
  return env.KNOWLEDGE_SCHEDULER_REPORT_FILE;
}

function defaultLockFile() {
  return env.KNOWLEDGE_SCHEDULER_LOCK_FILE;
}

function stepStats(steps: SchedulerStep[]) {
  return {
    stepCount: steps.length,
    passedStepCount: steps.filter((step) => step.status === "passed").length,
    failedStepCount: steps.filter((step) => step.status === "failed").length,
    skippedStepCount: steps.filter((step) => step.status === "skipped").length
  };
}

function statusFor(steps: SchedulerStep[]): GovernedKnowledgeSchedulerReport["status"] {
  if (steps.length === 0) {
    return "skipped";
  }
  if (steps.some((step) => step.status === "failed")) {
    return steps.some((step) => step.status === "passed") ? "partial" : "failed";
  }
  if (steps.some((step) => step.status === "skipped")) {
    return "partial";
  }
  return "completed";
}

export class GovernedKnowledgeSchedulerService {
  private readonly watcherKernel: Pick<WatcherKernel, "run">;
  private readonly sourceAcquisitionService: Pick<SourceAcquisitionService, "run">;
  private readonly knowledgeQualityGateService: Pick<KnowledgeQualityGateService, "evaluateAndPersist">;
  private readonly knowledgeConsolidationService: Pick<KnowledgeConsolidationService, "buildAndPersist">;
  private readonly promotionGovernanceService: Pick<KnowledgePromotionGovernanceService, "evaluateAndPersist">;
  private readonly trainingQueueValidationService: Pick<TrainingQueueValidationService, "validateAndPersist">;
  private readonly reportFile: string;
  private readonly lockFile: string;
  private readonly now: () => Date;

  constructor(options: GovernedKnowledgeSchedulerOptions = {}) {
    this.watcherKernel = options.watcherKernel ?? new WatcherKernel();
    this.sourceAcquisitionService = options.sourceAcquisitionService ?? new SourceAcquisitionService();
    this.knowledgeQualityGateService =
      options.knowledgeQualityGateService ?? new KnowledgeQualityGateService();
    this.knowledgeConsolidationService =
      options.knowledgeConsolidationService ?? new KnowledgeConsolidationService();
    this.promotionGovernanceService =
      options.promotionGovernanceService ?? new KnowledgePromotionGovernanceService();
    this.trainingQueueValidationService =
      options.trainingQueueValidationService ?? new TrainingQueueValidationService();
    this.reportFile = options.reportFile ?? defaultReportFile();
    this.lockFile = options.lockFile ?? defaultLockFile();
    this.now = options.now ?? (() => new Date());
  }

  async run(options: GovernedKnowledgeSchedulerRunOptions = {}) {
    const normalized = this.normalizeOptions(options);
    const started = this.now();
    const startedAt = started.toISOString();
    const runId = `knowledge-scheduler::${stableShortHash(`${startedAt}:${process.pid}`)}`;
    const cooldownReport = await this.maybeSkipForCooldown({
      runId,
      startedAt,
      options: normalized,
      force: options.force ?? false
    });
    if (cooldownReport) {
      return cooldownReport;
    }

    const lock = await this.acquireLock({
      runId,
      startedAt,
      maxRuntimeMinutes: normalized.maxRuntimeMinutes
    });
    if (!lock.acquired) {
      const previous = await this.loadReport();
      return this.persistReport(
        this.buildReport({
          runId,
          startedAt,
          options: normalized,
          steps: [],
          status: "skipped",
          reason: lock.reason,
          lastCompletedRunAt: this.lastCompletedRunAt(previous)
        })
      );
    }

    const steps: SchedulerStep[] = [];
    let sourceAcquisition: SourceAcquisitionFile | null = null;
    try {
      steps.push(await this.runStep("watchers", startedAt, normalized, async () => {
        const result = await this.watcherKernel.run({
          scope: normalized.watcherScope,
          limit: normalized.interactionLimit,
          rebuildInteractionDigest: options.rebuildInteractions ?? true
        });
        return {
          scope: result.scope,
          runCount: result.runs.length,
          candidates: result.state?.sourceStats.candidateCount ?? 0,
          acquisitionTasks: result.state?.sourceStats.acquisitionTaskCount ?? 0
        };
      }));

      steps.push(await this.runStep("source_acquisition", startedAt, normalized, async () => {
        const result = await this.sourceAcquisitionService.run({
          networkEnabled: normalized.networkEnabled,
          persistMode: "replace",
          maxPacks: normalized.sourceBudget.maxPacks,
          maxSourcesPerPack: normalized.sourceBudget.maxSourcesPerPack,
          maxItemsPerSource: normalized.sourceBudget.maxItemsPerSource,
          timeoutMs: normalized.sourceBudget.timeoutMs
        });
        sourceAcquisition = result;
        return {
          dryRun: result.dryRun,
          ...result.sourceStats
        };
      }));

      let downstreamBlocked = false;
      if (steps.at(-1)?.status === "failed") {
        steps.push(this.skippedStep("knowledge_quality_gate", "source_acquisition_failed"));
        downstreamBlocked = true;
      } else {
        steps.push(await this.runStep("knowledge_quality_gate", startedAt, normalized, async () => {
          const report = await this.knowledgeQualityGateService.evaluateAndPersist({
            sourceAcquisition
          });
          return {
            gatePassed: report.gate.passed,
            evaluatedItemCount: report.sourceStats.evaluatedItemCount,
            rejectedCount: report.sourceStats.rejectedCount,
            guardedCount: report.sourceStats.guardedCount,
            promotableCount: report.sourceStats.promotableCount,
            genericRejectedCount: report.sourceStats.genericRejectedCount,
            liveGuardedCount: report.sourceStats.liveGuardedCount
          };
        }));
        downstreamBlocked =
          steps.at(-1)?.status === "failed" || steps.at(-1)?.summary.gatePassed === false;
      }

      if (downstreamBlocked) {
        steps.push(this.skippedStep("knowledge_consolidation", "knowledge_quality_gate_failed"));
        steps.push(this.skippedStep("promotion_dry_run", "knowledge_quality_gate_failed"));
        steps.push(this.skippedStep("training_queue_validation", "knowledge_quality_gate_failed"));
      } else {
        steps.push(await this.runStep("knowledge_consolidation", startedAt, normalized, async () => {
          const result = await this.knowledgeConsolidationService.buildAndPersist({
            rebuildInteractionDigest: options.rebuildInteractions ?? true,
            limit: normalized.interactionLimit
          });
          return {
            objectCount: result.file.sourceStats.objectCount,
            activeCount: result.file.sourceStats.activeCount,
            guardedCount: result.file.sourceStats.guardedCount,
            sourceAcquisitionItemsAnalyzed: result.sourceAcquisition?.sourceStats.itemCount ?? 0
          };
        }));

        if (steps.at(-1)?.status === "failed") {
          steps.push(this.skippedStep("promotion_dry_run", "knowledge_consolidation_failed"));
          steps.push(this.skippedStep("training_queue_validation", "knowledge_consolidation_failed"));
        } else {
          steps.push(await this.runStep("promotion_dry_run", startedAt, normalized, async () => {
            const report = await this.promotionGovernanceService.evaluateAndPersist({
              mode: "dry_run",
              validationMode: "none"
            });
            return {
              gatePassed: report.gate.passed,
              activePromotionCount: report.sourceStats.activePromotionCount,
              trainingCandidateCount: report.sourceStats.trainingCandidateCount,
              retrievalQueueItems: report.trainingQueue.sourceStats.byTarget.retrieval_knowledge ?? 0
            };
          }));

          if (steps.at(-1)?.status === "failed") {
            steps.push(this.skippedStep("training_queue_validation", "promotion_dry_run_failed"));
          } else {
            steps.push(await this.runStep("training_queue_validation", startedAt, normalized, async () => {
              const report = await this.trainingQueueValidationService.validateAndPersist();
              return {
                gatePassed: report.gate.passed,
                queueItemCount: report.sourceStats.queueItemCount,
                readyForPackCount: report.sourceStats.readyForPackCount,
                studentSftAllowed: report.trainingAuthorization.studentSftAllowed
              };
            }));
          }
        }
      }
    } finally {
      await this.releaseLock(lock.lock);
    }

    return this.persistReport(
      this.buildReport({
        runId,
        startedAt,
        options: normalized,
        steps,
        status: statusFor(steps),
        reason: steps.some((step) => step.status === "failed")
          ? "One or more governed knowledge scheduler steps failed."
          : "Governed knowledge scheduler run completed without model execution or training."
      })
    );
  }

  async loadReport() {
    try {
      const raw = await readFile(this.reportFile, "utf8");
      return governedKnowledgeSchedulerReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private normalizeOptions(options: GovernedKnowledgeSchedulerRunOptions) {
    return {
      networkEnabled: options.networkEnabled ?? false,
      watcherScope: options.watcherScope ?? "all" as WatcherScope,
      interactionLimit: options.interactionLimit ?? env.KNOWLEDGE_SCHEDULER_INTERACTION_LIMIT,
      minIntervalMinutes:
        options.minIntervalMinutes ?? env.KNOWLEDGE_SCHEDULER_MIN_INTERVAL_MINUTES,
      maxRuntimeMinutes:
        options.maxRuntimeMinutes ?? env.KNOWLEDGE_SCHEDULER_MAX_RUNTIME_MINUTES,
      sourceBudget: {
        maxPacks: options.maxPacks ?? env.KNOWLEDGE_SCHEDULER_SOURCE_MAX_PACKS,
        maxSourcesPerPack:
          options.maxSourcesPerPack ?? env.KNOWLEDGE_SCHEDULER_SOURCE_MAX_SOURCES_PER_PACK,
        maxItemsPerSource:
          options.maxItemsPerSource ?? env.KNOWLEDGE_SCHEDULER_SOURCE_MAX_ITEMS_PER_SOURCE,
        timeoutMs: options.timeoutMs ?? env.KNOWLEDGE_SCHEDULER_SOURCE_TIMEOUT_MS
      }
    };
  }

  private async maybeSkipForCooldown(args: {
    runId: string;
    startedAt: string;
    options: ReturnType<GovernedKnowledgeSchedulerService["normalizeOptions"]>;
    force: boolean;
  }) {
    if (args.force || args.options.minIntervalMinutes <= 0) {
      return null;
    }

    const previous = await this.loadReport();
    const lastCompletedRunAt = this.lastCompletedRunAt(previous);
    if (!lastCompletedRunAt) {
      return null;
    }

    const lastCompleted = new Date(lastCompletedRunAt).getTime();
    const nextAllowed = lastCompleted + args.options.minIntervalMinutes * 60_000;
    if (this.now().getTime() >= nextAllowed) {
      return null;
    }

    return this.persistReport(
      this.buildReport({
        runId: args.runId,
        startedAt: args.startedAt,
        options: args.options,
        steps: [],
        status: "skipped",
        reason: `Cooldown active until ${new Date(nextAllowed).toISOString()}.`,
        lastCompletedRunAt
      })
    );
  }

  private async acquireLock(args: {
    runId: string;
    startedAt: string;
    maxRuntimeMinutes: number;
  }): Promise<{ acquired: true; lock: SchedulerLock } | { acquired: false; reason: string; lock: null }> {
    const now = this.now();
    try {
      const raw = await readFile(this.lockFile, "utf8");
      const existing = JSON.parse(raw) as SchedulerLock;
      const ageMs = elapsedMs(existing.startedAt, now);
      const staleAfterMs = Math.max(5, existing.maxRuntimeMinutes * 2) * 60_000;
      if (ageMs < staleAfterMs) {
        return {
          acquired: false,
          lock: null,
          reason: `Scheduler lock is active for run ${existing.runId}.`
        };
      }
    } catch {
      // Missing or unreadable lock is treated as no active lock.
    }

    const lock: SchedulerLock = {
      version: "hydria-governed-knowledge-scheduler-lock-v1",
      runId: args.runId,
      startedAt: args.startedAt,
      maxRuntimeMinutes: args.maxRuntimeMinutes,
      pid: process.pid
    };
    await mkdir(dirname(this.lockFile), { recursive: true });
    await writeFile(this.lockFile, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    return { acquired: true, lock };
  }

  private async releaseLock(lock: SchedulerLock | null) {
    if (!lock) {
      return;
    }
    try {
      const raw = await readFile(this.lockFile, "utf8");
      const current = JSON.parse(raw) as SchedulerLock;
      if (current.runId === lock.runId) {
        await rm(this.lockFile, { force: true });
      }
    } catch {
      // Best-effort lock cleanup only.
    }
  }

  private runtimeBudgetLeft(startedAt: string, maxRuntimeMinutes: number) {
    return elapsedMs(startedAt, this.now()) < maxRuntimeMinutes * 60_000;
  }

  private skippedStep(stepId: SchedulerStep["stepId"], reason: string): SchedulerStep {
    const now = this.now().toISOString();
    return governedKnowledgeSchedulerStepSchema.parse({
      stepId,
      status: "skipped",
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      summary: { reason },
      error: null
    });
  }

  private async runStep(
    stepId: SchedulerStep["stepId"],
    schedulerStartedAt: string,
    options: ReturnType<GovernedKnowledgeSchedulerService["normalizeOptions"]>,
    fn: () => Promise<Record<string, unknown>>
  ): Promise<SchedulerStep> {
    const startedAt = this.now().toISOString();
    if (!this.runtimeBudgetLeft(schedulerStartedAt, options.maxRuntimeMinutes)) {
      return this.skippedStep(stepId, "max_runtime_budget_exhausted");
    }

    try {
      const summary = await fn();
      const completedAt = this.now().toISOString();
      return governedKnowledgeSchedulerStepSchema.parse({
        stepId,
        status: "passed",
        startedAt,
        completedAt,
        durationMs: elapsedMs(startedAt, new Date(completedAt)),
        summary,
        error: null
      });
    } catch (error) {
      const completedAt = this.now().toISOString();
      return governedKnowledgeSchedulerStepSchema.parse({
        stepId,
        status: "failed",
        startedAt,
        completedAt,
        durationMs: elapsedMs(startedAt, new Date(completedAt)),
        summary: {},
        error: compact(error instanceof Error ? error.message : String(error))
      });
    }
  }

  private buildReport(args: {
    runId: string;
    startedAt: string;
    options: ReturnType<GovernedKnowledgeSchedulerService["normalizeOptions"]>;
    steps: SchedulerStep[];
    status: GovernedKnowledgeSchedulerReport["status"];
    reason: string;
    lastCompletedRunAt?: string | null;
  }) {
    const completedAt = this.now().toISOString();
    const lastCompletedRunAt =
      args.status === "completed" ? completedAt : args.lastCompletedRunAt ?? null;
    return governedKnowledgeSchedulerReportSchema.parse({
      version: "hydria-governed-knowledge-scheduler-v1",
      generatedAt: completedAt,
      runId: args.runId,
      status: args.status,
      reason: args.reason,
      lastCompletedRunAt,
      startedAt: args.startedAt,
      completedAt,
      durationMs: elapsedMs(args.startedAt, new Date(completedAt)),
      options: args.options,
      safety: {
        noModelExecution: true,
        noTraining: true,
        noActivePromotion: true,
        lockEnabled: true,
        boundedNetwork: true
      },
      sourceStats: stepStats(args.steps),
      steps: args.steps
    });
  }

  private async persistReport(report: GovernedKnowledgeSchedulerReport) {
    await mkdir(dirname(this.reportFile), { recursive: true });
    await writeFile(this.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  private lastCompletedRunAt(report: GovernedKnowledgeSchedulerReport | null) {
    if (!report) {
      return null;
    }
    return report.lastCompletedRunAt ?? (report.status === "completed" ? report.completedAt : null);
  }
}

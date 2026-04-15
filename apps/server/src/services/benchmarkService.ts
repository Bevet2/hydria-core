import { randomUUID } from "node:crypto";
import { DEFAULT_BENCHMARK_PACK_ID, getBenchmarkPack } from "../data/benchmarkPacks.js";
import {
  OFFICIAL_BASELINE_FROZEN_AT,
  OFFICIAL_BASELINE_LABEL,
  OFFICIAL_BASELINE_MODELS,
  OFFICIAL_BASELINE_RUN_ID,
  OFFICIAL_BASELINE_SUMMARY
} from "../data/officialBaseline.js";
import {
  benchmarkPackSchema,
  benchmarkRunSchema,
  type BenchmarkPrompt,
  type BenchmarkRun,
  type BenchmarkRunRequest
} from "../types/benchmark.js";
import type { ExecutionTrace } from "../types/arena.js";
import { logger } from "../utils/logger.js";
import { ArenaRunner, RespondentStageError } from "./arenaRunner.js";
import { buildBenchmarkSummary, buildEmptyBenchmarkSummary } from "./benchmarkAnalytics.js";
import { BenchmarkStore } from "./benchmarkStore.js";

export class BenchmarkService {
  private activeRunId: string | null = null;

  constructor(
    private readonly arenaRunner: ArenaRunner,
    private readonly benchmarkStore: BenchmarkStore
  ) {}

  async ensureReady() {
    await this.benchmarkStore.ensureReady();
  }

  async listRuns(benchmarkId?: string | null) {
    const pack = this.loadPack(benchmarkId);
    const runs = (await this.benchmarkStore.listRuns()).filter(
      (run) => run.benchmarkId === pack.benchmarkId
    );
    const activeRun = await this.getActiveRun();

    return {
      activeRunId: activeRun?.benchmarkId === pack.benchmarkId ? activeRun.id : null,
      runs: runs.map((run) => this.toRunListItem(run))
    };
  }

  async getRun(runId: string) {
    return this.benchmarkStore.getRun(runId);
  }

  async getSummary(runId?: string | null, benchmarkId?: string | null) {
    const activeRun = await this.getActiveRun();
    const selectedRun = runId?.trim()
      ? await this.benchmarkStore.getRun(runId)
      : (await this.benchmarkStore.listRuns()).find(
          (run) => run.benchmarkId === this.loadPack(benchmarkId).benchmarkId
        ) ?? null;
    const pack = this.loadPack(selectedRun?.benchmarkId ?? benchmarkId ?? DEFAULT_BENCHMARK_PACK_ID);

    return {
      benchmarkId: pack.benchmarkId,
      benchmarkName: pack.name,
      promptCount: pack.prompts.length,
      categories: [...new Set(pack.prompts.map((prompt) => prompt.category))],
      officialBaseline: {
        label: OFFICIAL_BASELINE_LABEL,
        frozenAt: OFFICIAL_BASELINE_FROZEN_AT,
        runId: OFFICIAL_BASELINE_RUN_ID,
        models: OFFICIAL_BASELINE_MODELS,
        summary: OFFICIAL_BASELINE_SUMMARY
      },
      activeRunId: activeRun?.benchmarkId === pack.benchmarkId ? activeRun.id : null,
      run: selectedRun ? this.toRunListItem(selectedRun) : null,
      summary: selectedRun?.summary ?? buildEmptyBenchmarkSummary()
    };
  }

  async startRun(request: BenchmarkRunRequest) {
    const activeRun = await this.getActiveRun();
    if (activeRun) {
      throw new Error(`Benchmark run already active: ${activeRun.id}`);
    }

    const pack = this.loadPack(request.benchmarkId);
    const prompts = this.selectPrompts(pack.prompts, request);
    const now = new Date().toISOString();

    const run = benchmarkRunSchema.parse({
      id: randomUUID(),
      benchmarkId: pack.benchmarkId,
      benchmarkName: pack.name,
      status: "running",
      createdAt: now,
      startedAt: now,
      completedAt: null,
      lastUpdatedAt: now,
      totalPrompts: prompts.length,
      completedPrompts: 0,
      failedPrompts: 0,
      models: {
        ...OFFICIAL_BASELINE_MODELS,
        ...(request.models ?? {})
      },
      results: [],
      summary: buildEmptyBenchmarkSummary()
    });

    await this.benchmarkStore.upsertRun(run);
    this.activeRunId = run.id;
    void this.executeRun(run.id, prompts).finally(() => {
      this.activeRunId = null;
    });

    return run;
  }

  private async executeRun(runId: string, prompts: BenchmarkPrompt[]) {
    let currentRun = await this.requireRun(runId);

    try {
      logger.info("Benchmark run started", {
        runId,
        totalPrompts: prompts.length
      });

      for (const prompt of prompts) {
        const result = await this.executePrompt(currentRun, prompt);
        currentRun = benchmarkRunSchema.parse({
          ...currentRun,
          results: [...currentRun.results, result],
          completedPrompts: currentRun.results.length + 1,
          failedPrompts:
            currentRun.failedPrompts + (result.status === "failed" ? 1 : 0),
          lastUpdatedAt: new Date().toISOString(),
          summary: buildBenchmarkSummary([...currentRun.results, result])
        });

        await this.benchmarkStore.upsertRun(currentRun);
      }

      currentRun = benchmarkRunSchema.parse({
        ...currentRun,
        status: "completed",
        completedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        summary: buildBenchmarkSummary(currentRun.results)
      });
      await this.benchmarkStore.upsertRun(currentRun);

      logger.info("Benchmark run completed", {
        runId,
        totalPrompts: currentRun.totalPrompts,
        successfulRuns: currentRun.summary.successfulRuns
      });
    } catch (error) {
      const failedRun = benchmarkRunSchema.parse({
        ...currentRun,
        status: "failed",
        completedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        summary: buildBenchmarkSummary(currentRun.results),
        error: String(error)
      });
      await this.benchmarkStore.upsertRun(failedRun);

      logger.error("Benchmark run failed", {
        runId,
        error: String(error)
      });
    }
  }

  private async executePrompt(run: BenchmarkRun, prompt: BenchmarkPrompt) {
    try {
      const round = await this.arenaRunner.runRound({
        question: prompt.question,
        models: run.models
      });
      const respondentMetrics = this.buildRespondentMetrics([
        {
          trace: round.trace.respondentA,
          durationMs: round.timings.respondentA
        },
        {
          trace: round.trace.respondentB,
          durationMs: round.timings.respondentB
        }
      ]);

      const fallbackUsed = Object.values(round.trace).some((trace) => trace.usedFallback);
      const degrading =
        round.metrics.refineGain.global < 0 ||
        round.verdicts.refineA === "degrading" ||
        round.verdicts.refineB === "degrading";

      return {
        promptId: prompt.id,
        category: prompt.category,
        question: prompt.question,
        status: "completed" as const,
        roundId: round.roundId,
        globalGain: round.metrics.refineGain.global,
        gainClassification: round.metrics.gainClassification.global,
        refineDecision: round.refineDecision.global,
        totalMs: round.durationMs,
        refineSharePct: round.metrics.latencyBreakdown.refineSharePct,
        fallbackUsed,
        winner: round.outputs.judge.winner,
        detectedCategory: round.category,
        routerStrategy: round.router.globalStrategy,
        refineExecutedCount: round.metrics.routing.refineExecutedCount,
        refineSkippedCount: round.metrics.routing.refineSkippedCount,
        refineExecutedGainTotal:
          (round.router.shouldRefineA ? round.metrics.refineGain.A : 0) +
          (round.router.shouldRefineB ? round.metrics.refineGain.B : 0),
        refineSkippedGainTotal:
          (!round.router.shouldRefineA ? round.metrics.refineGain.A : 0) +
          (!round.router.shouldRefineB ? round.metrics.refineGain.B : 0),
        researchConsidered: round.research.considered,
        researchUsed: round.research.used,
        researchRoute: round.research.route,
        researchDecisionMode: round.research.decision.mode,
        researchExpectedValue: round.research.decision.expectedValue,
        researchTriggerCount: round.research.decision.triggerSignals.length,
        researchTargetClaimsCount: round.research.decision.targetClaims.length,
        researchSourceCount: round.research.sources.length,
        researchDurationMs: round.research.durationMs,
        researchChangedRefine: round.research.impact.refineChangedBecauseOfTool,
        researchCorrectedClaimsCount: round.research.impact.correctedClaimsCount,
        researchSourceBackedClaimsCount: round.research.impact.sourceBackedClaimsCount,
        researchCostSharePct: round.research.impact.costSharePct,
        researchNetImpact: round.research.impact.netImpact,
        ...respondentMetrics,
        degrading,
        createdAt: round.createdAt
      };
    } catch (error) {
      logger.warn("Benchmark prompt failed", {
        runId: run.id,
        promptId: prompt.id,
        error: String(error)
      });
      const respondentMetrics =
        error instanceof RespondentStageError
          ? this.buildRespondentMetrics([
              {
                trace: error.respondentA.trace,
                durationMs: error.respondentA.durationMs
              },
              {
                trace: error.respondentB.trace,
                durationMs: error.respondentB.durationMs
              }
            ])
          : this.buildRespondentMetrics([]);

      return {
        promptId: prompt.id,
        category: prompt.category,
        question: prompt.question,
        status: "failed" as const,
        roundId: null,
        globalGain: null,
        gainClassification: null,
        refineDecision: null,
        totalMs: null,
        refineSharePct: null,
        fallbackUsed: null,
        winner: null,
        detectedCategory:
          error instanceof RespondentStageError ? error.category : ("other" as const),
        routerStrategy: "refine_all" as const,
        refineExecutedCount: 0,
        refineSkippedCount: 0,
        refineExecutedGainTotal: 0,
        refineSkippedGainTotal: 0,
        researchConsidered: false,
        researchUsed: false,
        researchRoute: "not_needed" as const,
        researchDecisionMode: "off" as const,
        researchExpectedValue: "low" as const,
        researchTriggerCount: 0,
        researchTargetClaimsCount: 0,
        researchSourceCount: 0,
        researchDurationMs: 0,
        researchChangedRefine: false,
        researchCorrectedClaimsCount: 0,
        researchSourceBackedClaimsCount: 0,
        researchCostSharePct: 0,
        researchNetImpact: "unknown" as const,
        ...respondentMetrics,
        degrading: false,
        createdAt: new Date().toISOString(),
        error: String(error)
      };
    }
  }

  private async requireRun(runId: string) {
    const run = await this.benchmarkStore.getRun(runId);
    if (!run) {
      throw new Error(`Benchmark run not found: ${runId}`);
    }

    return run;
  }

  private loadPack(benchmarkId?: string | null) {
    return benchmarkPackSchema.parse(getBenchmarkPack(benchmarkId));
  }

  private selectPrompts(prompts: BenchmarkPrompt[], request: BenchmarkRunRequest) {
    let selected = prompts;

    if (request.promptIds && request.promptIds.length > 0) {
      const allowedIds = new Set(request.promptIds);
      selected = prompts.filter((prompt) => allowedIds.has(prompt.id));
    }

    if (request.limit) {
      selected = selected.slice(0, request.limit);
    }

    if (selected.length === 0) {
      throw new Error("No benchmark prompts selected.");
    }

    return selected;
  }

  private async getActiveRun() {
    if (!this.activeRunId) {
      return null;
    }

    const run = await this.benchmarkStore.getRun(this.activeRunId);
    if (!run || run.status !== "running") {
      this.activeRunId = null;
      return null;
    }

    return run;
  }

  private buildRespondentMetrics(
    traces: Array<{
      trace: Pick<
        ExecutionTrace,
        "usedRetry" | "usedFallback" | "outcome" | "validationFailures"
      >;
      durationMs: number;
    }>
  ) {
    return {
      respondentSlotCount: traces.length,
      respondentPrimarySuccessCount: traces.filter((entry) => entry.trace.outcome === "success")
        .length,
      respondentRetrySuccessCount: traces.filter(
        (entry) => entry.trace.outcome === "retry_success"
      ).length,
      respondentFallbackSuccessCount: traces.filter(
        (entry) => entry.trace.outcome === "fallback_success"
      ).length,
      respondentFinalFailureCount: traces.filter((entry) => entry.trace.outcome === "failure")
        .length,
      respondentRetryCount: traces.filter((entry) => entry.trace.usedRetry).length,
      respondentFallbackCount: traces.filter((entry) => entry.trace.usedFallback).length,
      respondentValidationFailureCount: traces.filter(
        (entry) => (entry.trace.validationFailures ?? 0) > 0
      ).length,
      respondentLatencyTotalMs: traces.reduce(
        (total, entry) => total + Math.max(0, entry.durationMs),
        0
      )
    };
  }

  private toRunListItem(run: BenchmarkRun) {
    return {
      id: run.id,
      benchmarkId: run.benchmarkId,
      benchmarkName: run.benchmarkName,
      status: run.status,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      lastUpdatedAt: run.lastUpdatedAt,
      totalPrompts: run.totalPrompts,
      completedPrompts: run.completedPrompts,
      failedPrompts: run.failedPrompts,
      summary: run.summary
    };
  }
}

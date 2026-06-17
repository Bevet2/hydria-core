import { randomUUID } from "node:crypto";
import { DEFAULT_BENCHMARK_PACK_ID, getBenchmarkPack } from "../data/benchmarkPacks.js";

const BENCHMARK_RUN_TIMEOUT_MS = 60 * 60 * 1000;
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
  type BenchmarkPromptResult,
  type BenchmarkRun,
  type BenchmarkRunRequest
} from "../types/benchmark.js";
import type { ExecutionTrace } from "../types/arena.js";
import { logger } from "../utils/logger.js";
import { ArenaRunner, RespondentStageError } from "./arenaRunner.js";
import { buildBenchmarkSummary, buildEmptyBenchmarkSummary } from "./benchmarkAnalytics.js";
import { BenchmarkStore } from "./benchmarkStore.js";
import type { InteractionLogStore } from "./interactionLogStore.js";

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function benchmarkPromptArtifactId(runId: string, promptId: string) {
  const full = `${runId}:${promptId}`;
  return full.length <= 180 ? full : `${runId}:${promptId.slice(0, 143)}`;
}

export class BenchmarkService {
  private activeRunId: string | null = null;

  constructor(
    private readonly arenaRunner: ArenaRunner,
    private readonly benchmarkStore: BenchmarkStore,
    private readonly interactionLogStore: Pick<InteractionLogStore, "safeAppend"> | null = null
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
    await this.auditBenchmarkRunStarted(run, `Start benchmark ${pack.name}.`);
    this.activeRunId = run.id;
    const timeoutHandle = setTimeout(() => {
      logger.error("Benchmark run exceeded maximum allowed duration, clearing active lock", { runId: run.id });
      this.activeRunId = null;
    }, BENCHMARK_RUN_TIMEOUT_MS);

    void this.executeRun(run.id, prompts)
      .catch((error) => {
        logger.error("Benchmark background task threw unexpectedly", { runId: run.id, error: String(error) });
      })
      .finally(() => {
        clearTimeout(timeoutHandle);
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
      }, {
        scope: "benchmark_prompt",
        source: "benchmark",
        mode: "benchmark",
        sessionId: run.id,
        artifactId: benchmarkPromptArtifactId(run.id, prompt.id),
        benchmarkRunId: run.id,
        benchmarkId: run.benchmarkId,
        promptId: prompt.id
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

      const result = {
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
      await this.auditFailedBenchmarkPrompt(run, prompt, result, error);
      return result;
    }
  }

  private async auditBenchmarkRunStarted(run: BenchmarkRun, question: string) {
    await this.interactionLogStore?.safeAppend({
      scope: "benchmark_run",
      source: "benchmark",
      mode: "benchmark",
      status: "accepted",
      sessionId: run.id,
      artifactId: run.id,
      question,
      answer: `Benchmark ${run.benchmarkName} started with ${run.totalPrompts} prompt(s).`,
      summary: `Run ${run.id} is running ${run.totalPrompts} prompt(s).`,
      routing: {
        orchestrator: "benchmark_runner",
        provider: "openrouter",
        model: null,
        category: null,
        toolUsed: false
      },
      quality: {
        passed: null,
        score: null,
        issues: []
      },
      durationMs: null,
      payload: {
        run
      }
    });
  }

  private async auditFailedBenchmarkPrompt(
    run: BenchmarkRun,
    prompt: BenchmarkPrompt,
    result: BenchmarkPromptResult,
    error: unknown
  ) {
    await this.interactionLogStore?.safeAppend({
      scope: "benchmark_prompt",
      source: "benchmark",
      mode: "benchmark",
      status: "failed",
      sessionId: run.id,
      artifactId: benchmarkPromptArtifactId(run.id, prompt.id),
      question: prompt.question,
      answer: null,
      summary: compact(String(error)),
      routing: {
        orchestrator: "benchmark_runner",
        provider: "openrouter",
        model: null,
        category: result.detectedCategory,
        toolUsed: false
      },
      quality: {
        passed: false,
        score: null,
        issues: [compact(String(error), 240)]
      },
      durationMs: null,
      payload: {
        benchmarkRunId: run.id,
        benchmarkId: run.benchmarkId,
        promptId: prompt.id,
        result
      }
    });
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

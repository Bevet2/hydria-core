import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  arenaMetricsSchema,
  arenaRoundSchema,
  arenaVerdictsSchema,
  historyFileSchema,
  judgeOutputSchema,
  modelSelectionSchema,
  questionCategorySchema,
  researchToolLogSchema,
  redTeamOutputSchema,
  refineProfileSchema,
  refineRouterDecisionSchema,
  refineDecisionSchema,
  refinerOutputSchema,
  respondentOutputSchema,
  type ArenaTrace,
  type ArenaRound,
  type ArenaTimings,
  type ModelSelection,
  type RespondentOutput
} from "../types/arena.js";
import { env } from "../utils/env.js";
import { buildLegacyRouterDecision } from "./refineRouter.js";
import { deriveRoundMetrics } from "./roundMetrics.js";
import { RoundDatasetStore } from "./roundDatasetStore.js";

const EMPTY_HISTORY = {
  rounds: [] as ArenaRound[]
};

export class HistoryStore {
  private readonly roundDatasetStore: RoundDatasetStore;

  constructor(private readonly filePath = env.HISTORY_FILE) {
    this.roundDatasetStore = new RoundDatasetStore();
  }

  async ensureReady() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.roundDatasetStore.ensureReady();

    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, JSON.stringify(EMPTY_HISTORY, null, 2), "utf8");
    }
  }

  async listRounds() {
    const history = await this.readHistory();
    return history.rounds.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }

  async getRound(roundId: string) {
    const rounds = await this.listRounds();
    return rounds.find((round) => round.roundId === roundId) ?? null;
  }

  async appendRound(round: ArenaRound) {
    const history = await this.readHistory();
    const parsedRound = arenaRoundSchema.parse(round);
    const nextHistory = {
      rounds: [parsedRound, ...history.rounds].slice(0, 100)
    };
    await writeFile(this.filePath, JSON.stringify(nextHistory, null, 2), "utf8");
    await this.roundDatasetStore.appendRound(parsedRound);
  }

  private async readHistory() {
    await this.ensureReady();
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as { rounds?: unknown[] };
    const normalized = {
      rounds: (parsed.rounds ?? []).map((round) => this.normalizeStoredRound(round))
    };
    return historyFileSchema.parse(normalized);
  }

  private normalizeStoredRound(round: unknown) {
    const current =
      typeof round === "object" && round !== null
        ? (round as Record<string, unknown>)
        : {};
    const outputs =
      typeof current.outputs === "object" && current.outputs !== null
        ? (current.outputs as Record<string, unknown>)
        : {};

    const respondentA = respondentOutputSchema.parse(outputs.respondentA);
    const respondentB = respondentOutputSchema.parse(outputs.respondentB);
    const redTeam = this.normalizeRedTeamOutput(outputs.redTeam);
    const models = modelSelectionSchema.parse(current.models);
    const question = typeof current.question === "string" ? current.question : "";
    const refineA = refinerOutputSchema.parse(
      outputs.refineA ?? this.buildLegacyRefinerOutput(respondentA, "A")
    );
    const refineB = refinerOutputSchema.parse(
      outputs.refineB ?? this.buildLegacyRefinerOutput(respondentB, "B")
    );
    const judge = this.normalizeJudgeOutput(outputs.judge);
    const normalizedOutputs = {
      ...outputs,
      refineA,
      refineB,
      judge
    };
    const normalizedTrace = {
      ...this.buildLegacyTrace(models, outputs),
      ...(typeof current.trace === "object" && current.trace !== null
        ? (current.trace as Record<string, unknown>)
        : {})
    };
    const normalizedTimings = {
      ...this.buildLegacyTimings(),
      ...(typeof current.timings === "object" && current.timings !== null
        ? (current.timings as Record<string, unknown>)
        : {})
    };
    const normalizedRouter = refineRouterDecisionSchema.parse(
      typeof current.router === "object" && current.router !== null
        ? current.router
        : buildLegacyRouterDecision(question)
    );
    const normalizedCategory = questionCategorySchema.parse(
      typeof current.category === "string" && current.category.length > 0
        ? current.category
        : normalizedRouter.category
    );
    const derived = deriveRoundMetrics({
      respondentA,
      respondentB,
      refineA,
      refineB,
      redTeam,
      initialScores: judge.initial_scores,
      refinedScores: judge.scores,
      refineATrace: normalizedTrace.refineA,
      refineBTrace: normalizedTrace.refineB,
      router: normalizedRouter,
      category: normalizedCategory,
      timings: normalizedTimings,
      durationMs:
        typeof current.durationMs === "number" && Number.isFinite(current.durationMs)
          ? current.durationMs
          : 0
    });
    const rawResearch =
      typeof current.research === "object" && current.research !== null
        ? (current.research as Record<string, unknown>)
        : {};
    const defaultResearch = {
      considered: false,
      used: false,
      route: "not_needed",
      decision: {
        shouldUse: false,
        mode: "off",
        expectedValue: "low",
        expectedCostMs: 0,
        triggerSignals: ["legacy_round"],
        targetClaims: [],
        reasoning: "Legacy round stored before research-tool decision logging was introduced."
      },
      queryPlan: {
        intent: "fact_check",
        queries: [],
        selectedQuery: null,
        requiredTerms: [],
        preferredDomains: [],
        factFocusTerms: []
      },
      query: null,
      reasons: ["Legacy round stored before research-tool logging was introduced."],
      summary: [],
      sources: [],
      verification: {
        sourceCount: 0,
        extractedSourceCount: 0,
        corroboratedSignals: []
      },
      appliedTo: {
        A: false,
        B: false
      },
      impact: {
        refineChangedBecauseOfTool: false,
        addedFactsCount: 0,
        correctedClaimsCount: 0,
        sourceBackedClaimsCount: 0,
        costSharePct: 0,
        netImpact: "unknown"
      },
      impactNotes: [],
      durationMs: 0
    };

    return arenaRoundSchema.parse({
      ...current,
      category: normalizedCategory,
      outputs: normalizedOutputs,
      trace: normalizedTrace,
      router: normalizedRouter,
      research: researchToolLogSchema.parse({
        ...defaultResearch,
        ...rawResearch,
        decision: {
          ...defaultResearch.decision,
          ...(typeof rawResearch.decision === "object" && rawResearch.decision !== null
            ? (rawResearch.decision as Record<string, unknown>)
            : {})
        },
        queryPlan: {
          ...defaultResearch.queryPlan,
          ...(typeof rawResearch.queryPlan === "object" && rawResearch.queryPlan !== null
            ? (rawResearch.queryPlan as Record<string, unknown>)
            : {})
        },
        verification: {
          ...defaultResearch.verification,
          ...(typeof rawResearch.verification === "object" && rawResearch.verification !== null
            ? (rawResearch.verification as Record<string, unknown>)
            : {})
        },
        appliedTo: {
          ...defaultResearch.appliedTo,
          ...(typeof rawResearch.appliedTo === "object" && rawResearch.appliedTo !== null
            ? (rawResearch.appliedTo as Record<string, unknown>)
            : {})
        },
        impact: {
          ...defaultResearch.impact,
          ...(typeof rawResearch.impact === "object" && rawResearch.impact !== null
            ? (rawResearch.impact as Record<string, unknown>)
            : {})
        }
      }),
      refineProfile: refineProfileSchema.parse(
        typeof current.refineProfile === "object" && current.refineProfile !== null
          ? current.refineProfile
          : {
              A:
                normalizedCategory,
              B:
                normalizedCategory
            }
      ),
      timings: normalizedTimings,
      metrics: this.mergeMetrics(derived.metrics, current.metrics),
      verdicts: this.mergeVerdicts(derived.verdicts, current.verdicts),
      refineDecision: this.mergeRefineDecision(derived.refineDecision, current.refineDecision)
    });
  }

  private buildLegacyRefinerOutput(
    respondent: RespondentOutput,
    slot: "A" | "B"
  ) {
    return {
      modelRole: "refiner" as const,
      improved_answer: respondent.answer,
      fixes_applied: [],
      remaining_uncertainties: [
        `Legacy round stored before the refine step for response ${slot}.`,
        ...respondent.assumptions.slice(0, 2)
      ],
      confidence: Math.max(0, Math.min(10, Math.round(respondent.confidence / 10)))
    };
  }

  private buildLegacyTrace(
    models: ModelSelection,
    outputs: Record<string, unknown>
  ): ArenaTrace {
    const localStudentOutput =
      typeof outputs.localStudent === "object" && outputs.localStudent !== null
        ? (outputs.localStudent as Record<string, unknown>)
        : {};
    const studentAnswer =
      typeof localStudentOutput.student_answer === "string"
        ? localStudentOutput.student_answer
        : "";

    return {
      respondentA: {
        requestedProvider: "openrouter",
        requestedModel: models.respondentA,
        attempts: [
          {
            provider: "openrouter",
            model: models.respondentA,
            mode: "primary"
          }
        ],
        finalProvider: "legacy",
        finalModel: models.respondentA,
        usedRetry: false,
        usedFallback: false,
        validationFailures: 0,
        outcome: "legacy",
        note: "Legacy round backfilled after execution trace was introduced."
      },
      respondentB: {
        requestedProvider: "openrouter",
        requestedModel: models.respondentB,
        attempts: [
          {
            provider: "openrouter",
            model: models.respondentB,
            mode: "primary"
          }
        ],
        finalProvider: "legacy",
        finalModel: models.respondentB,
        usedRetry: false,
        usedFallback: false,
        validationFailures: 0,
        outcome: "legacy",
        note: "Legacy round backfilled after execution trace was introduced."
      },
      redTeam: {
        requestedProvider: "openrouter",
        requestedModel: models.redTeam,
        attempts: [
          {
            provider: "openrouter",
            model: models.redTeam,
            mode: "primary"
          }
        ],
        finalProvider: "legacy",
        finalModel: models.redTeam,
        usedRetry: false,
        usedFallback: false,
        validationFailures: 0,
        outcome: "legacy",
        note: "Legacy round backfilled after execution trace was introduced."
      },
      refineA: {
        requestedProvider: "openrouter",
        requestedModel: models.respondentA,
        attempts: [
          {
            provider: "openrouter",
            model: models.respondentA,
            mode: "primary"
          }
        ],
        finalProvider: "legacy",
        finalModel: "legacy-refine-backfill",
        usedRetry: false,
        usedFallback: true,
        validationFailures: 0,
        outcome: "legacy",
        note: "Legacy round backfilled after refine trace was introduced."
      },
      refineB: {
        requestedProvider: "openrouter",
        requestedModel: models.respondentB,
        attempts: [
          {
            provider: "openrouter",
            model: models.respondentB,
            mode: "primary"
          }
        ],
        finalProvider: "legacy",
        finalModel: "legacy-refine-backfill",
        usedRetry: false,
        usedFallback: true,
        validationFailures: 0,
        outcome: "legacy",
        note: "Legacy round backfilled after refine trace was introduced."
      },
      judge: {
        requestedProvider: "openrouter",
        requestedModel: models.judge,
        attempts: [
          {
            provider: "openrouter",
            model: models.judge,
            mode: "primary"
          }
        ],
        finalProvider: "legacy",
        finalModel: models.judge,
        usedRetry: false,
        usedFallback: false,
        validationFailures: 0,
        outcome: "legacy",
        note: "Legacy round backfilled after execution trace was introduced."
      },
      synthesizer: {
        requestedProvider: "openrouter",
        requestedModel: models.synthesizer,
        attempts: [
          {
            provider: "openrouter",
            model: models.synthesizer,
            mode: "primary"
          }
        ],
        finalProvider: "legacy",
        finalModel: models.synthesizer,
        usedRetry: false,
        usedFallback: false,
        validationFailures: 0,
        outcome: "legacy",
        note: "Legacy round backfilled after execution trace was introduced."
      },
      localStudent: {
        requestedProvider: "ollama",
        requestedModel: env.LOCAL_MODEL_NAME,
        attempts: [],
        finalProvider: studentAnswer.startsWith("Local student disabled")
          ? "disabled"
          : studentAnswer.startsWith("Local student unavailable")
            ? "fallback"
            : "legacy",
        finalModel: studentAnswer.startsWith("Local student disabled")
          ? "disabled"
          : studentAnswer.startsWith("Local student unavailable")
            ? "static-fallback"
            : env.LOCAL_MODEL_NAME,
        usedRetry: false,
        usedFallback:
          studentAnswer.startsWith("Local student unavailable") ||
          studentAnswer.startsWith("Local student disabled"),
        validationFailures: 0,
        outcome: studentAnswer.startsWith("Local student disabled")
          ? "disabled"
          : studentAnswer.startsWith("Local student unavailable")
            ? "static_fallback"
            : "legacy",
        note: "Legacy round backfilled after execution trace was introduced."
      }
    };
  }

  private buildLegacyTimings(): ArenaTimings {
    return {
      respondentA: 0,
      respondentB: 0,
      redTeam: 0,
      refineA: 0,
      refineB: 0,
      judge: 0,
      synthesizer: 0,
      localStudent: 0
    };
  }

  private normalizeJudgeOutput(rawJudge: unknown) {
    const judge =
      typeof rawJudge === "object" && rawJudge !== null
        ? (rawJudge as Record<string, unknown>)
        : {};
    const scores =
      typeof judge.scores === "object" && judge.scores !== null
        ? judge.scores
        : null;

    return judgeOutputSchema.parse({
      ...judge,
      initial_scores:
        typeof judge.initial_scores === "object" && judge.initial_scores !== null
          ? judge.initial_scores
          : scores
    });
  }

  private normalizeRedTeamOutput(rawRedTeam: unknown) {
    const redTeam =
      typeof rawRedTeam === "object" && rawRedTeam !== null
        ? (rawRedTeam as Record<string, unknown>)
        : {};

    return redTeamOutputSchema.parse({
      ...redTeam,
      failure_scenarios:
        Array.isArray(redTeam.failure_scenarios) ? redTeam.failure_scenarios : [],
      hidden_assumptions:
        Array.isArray(redTeam.hidden_assumptions) ? redTeam.hidden_assumptions : [],
      potentially_false_claims:
        Array.isArray(redTeam.potentially_false_claims)
          ? redTeam.potentially_false_claims
          : []
    });
  }

  private mergeMetrics(derivedMetrics: ArenaRound["metrics"], rawMetrics: unknown) {
    const metrics =
      typeof rawMetrics === "object" && rawMetrics !== null
        ? (rawMetrics as Record<string, unknown>)
        : {};

    return arenaMetricsSchema.parse({
      ...derivedMetrics,
      ...metrics,
      refineImpact: {
        ...derivedMetrics.refineImpact,
        ...(typeof metrics.refineImpact === "object" && metrics.refineImpact !== null
          ? (metrics.refineImpact as Record<string, unknown>)
          : {})
      },
      refineGain: {
        ...derivedMetrics.refineGain,
        ...(typeof metrics.refineGain === "object" && metrics.refineGain !== null
          ? (metrics.refineGain as Record<string, unknown>)
          : {})
      },
      gainClassification: {
        ...derivedMetrics.gainClassification,
        ...(typeof metrics.gainClassification === "object" &&
        metrics.gainClassification !== null
          ? (metrics.gainClassification as Record<string, unknown>)
          : {})
      },
      scoreExplanation: {
        ...derivedMetrics.scoreExplanation,
        ...(typeof metrics.scoreExplanation === "object" &&
        metrics.scoreExplanation !== null
          ? (metrics.scoreExplanation as Record<string, unknown>)
          : {})
      },
      scoreAverages: {
        ...derivedMetrics.scoreAverages,
        ...(typeof metrics.scoreAverages === "object" && metrics.scoreAverages !== null
          ? (metrics.scoreAverages as Record<string, unknown>)
          : {})
      },
      latencyBreakdown: {
        ...derivedMetrics.latencyBreakdown,
        ...(typeof metrics.latencyBreakdown === "object" &&
        metrics.latencyBreakdown !== null
          ? (metrics.latencyBreakdown as Record<string, unknown>)
          : {})
      },
      routing: {
        ...derivedMetrics.routing,
        ...(typeof metrics.routing === "object" && metrics.routing !== null
          ? (metrics.routing as Record<string, unknown>)
          : {})
      }
    });
  }

  private mergeVerdicts(derivedVerdicts: ArenaRound["verdicts"], rawVerdicts: unknown) {
    const verdicts =
      typeof rawVerdicts === "object" && rawVerdicts !== null
        ? (rawVerdicts as Record<string, unknown>)
        : {};

    return arenaVerdictsSchema.parse({
      ...derivedVerdicts,
      ...verdicts
    });
  }

  private mergeRefineDecision(
    derivedDecision: ArenaRound["refineDecision"],
    rawRefineDecision: unknown
  ) {
    const refineDecision =
      typeof rawRefineDecision === "object" && rawRefineDecision !== null
        ? (rawRefineDecision as Record<string, unknown>)
        : {};

    return refineDecisionSchema.parse({
      ...derivedDecision,
      ...refineDecision
    });
  }
}

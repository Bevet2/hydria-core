import { z } from "zod";
import {
  arenaMetricsSchema,
  arenaRoundSchema,
  arenaVerdictsSchema,
  historyFileSchema,
  judgeOutputSchema,
  modelSelectionSchema,
  orchestrationPolicySchema,
  questionCategorySchema,
  researchToolLogSchema,
  redTeamOutputSchema,
  refineProfileSchema,
  refineRouterDecisionSchema,
  refineDecisionSchema,
  refinerOutputSchema,
  respondentOutputSchema,
  type ArenaRound,
  type ArenaTrace,
  type ArenaTimings,
  type ModelSelection,
  type RespondentOutput
} from "../../types/arena.js";
import {
  hydriaMemorySnapshotSchema,
  hydriaWorkflowRunSchema
} from "../../types/core.js";
import { env } from "../../utils/env.js";
import { buildNoSkillTraceFields } from "../arena/arenaExecutionTypes.js";
import { buildLegacyOrchestrationPolicy } from "../orchestrationPolicy.js";
import { buildDefaultTemporalProfile } from "../research/temporal.js";
import { buildLegacyRouterDecision } from "../refineRouter.js";
import { deriveRoundMetrics } from "../roundMetrics.js";

const storedArenaHistorySchema = z.object({
  rounds: z.array(z.unknown()).default([])
});

const LEGACY_NIL_UUID = "00000000-0000-0000-0000-000000000000";
const LEGACY_DATETIME = "1970-01-01T00:00:00.000Z";

function compactText(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`;
}

export type StoredArenaHistory = z.infer<typeof storedArenaHistorySchema>;

export function normalizeArenaHistoryFile(raw: string) {
  const stored = storedArenaHistorySchema.parse(JSON.parse(raw));
  return historyFileSchema.parse({
    rounds: stored.rounds.map((round) => normalizeStoredArenaRound(round))
  });
}

export function normalizeStoredArenaRound(round: unknown): ArenaRound {
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
  const redTeam = normalizeRedTeamOutput(outputs.redTeam);
  const models = modelSelectionSchema.parse(current.models);
  const question = typeof current.question === "string" ? current.question : "";
  const refineA = refinerOutputSchema.parse(
    outputs.refineA ?? buildLegacyRefinerOutput(respondentA, "A")
  );
  const refineB = refinerOutputSchema.parse(
    outputs.refineB ?? buildLegacyRefinerOutput(respondentB, "B")
  );
  const judge = normalizeJudgeOutput(outputs.judge);
  const normalizedOutputs = {
    ...outputs,
    refineA,
    refineB,
    judge
  };
  const normalizedTrace = {
    ...buildLegacyTrace(models, outputs),
    ...(typeof current.trace === "object" && current.trace !== null
      ? (current.trace as Record<string, unknown>)
      : {})
  };
  const normalizedTimings = {
    ...buildLegacyTimings(),
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
  const orchestration = orchestrationPolicySchema.parse(
    typeof current.orchestration === "object" && current.orchestration !== null
      ? current.orchestration
      : buildLegacyOrchestrationPolicy(question)
  );
  const normalizedResearch = normalizeLegacyResearch(current.research);
  const normalizedMemory = hydriaMemorySnapshotSchema.parse(
    typeof current.memory === "object" && current.memory !== null
      ? current.memory
      : buildLegacyArenaMemorySnapshot({
          roundId: typeof current.roundId === "string" ? current.roundId : LEGACY_NIL_UUID,
          question,
          category: normalizedCategory,
          orchestration,
          router: normalizedRouter,
          research: normalizedResearch
        })
  );
  const normalizedWorkflow = hydriaWorkflowRunSchema.parse(
    typeof current.workflow === "object" && current.workflow !== null
      ? current.workflow
      : buildLegacyArenaWorkflowRun({
          roundId: typeof current.roundId === "string" ? current.roundId : LEGACY_NIL_UUID,
          question,
          category: normalizedCategory,
          createdAt:
            typeof current.createdAt === "string" && current.createdAt.length > 0
              ? current.createdAt
              : LEGACY_DATETIME
        })
  );

  return arenaRoundSchema.parse({
    ...current,
    category: normalizedCategory,
    outputs: normalizedOutputs,
    trace: normalizedTrace,
    orchestration,
    router: normalizedRouter,
    memory: normalizedMemory,
    research: normalizedResearch,
    workflow: normalizedWorkflow,
    refineProfile: refineProfileSchema.parse(
      typeof current.refineProfile === "object" && current.refineProfile !== null
        ? current.refineProfile
        : {
            A: normalizedCategory,
            B: normalizedCategory
          }
    ),
    timings: normalizedTimings,
    metrics: mergeMetrics(derived.metrics, current.metrics),
    verdicts: mergeVerdicts(derived.verdicts, current.verdicts),
    refineDecision: mergeRefineDecision(derived.refineDecision, current.refineDecision)
  });
}

function normalizeLegacyResearch(rawResearch: unknown) {
  const current =
    typeof rawResearch === "object" && rawResearch !== null
      ? (rawResearch as Record<string, unknown>)
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
      factFocusTerms: [],
      entityTerms: [],
      temporalProfile: buildDefaultTemporalProfile()
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

  return researchToolLogSchema.parse({
    ...defaultResearch,
    ...current,
    decision: {
      ...defaultResearch.decision,
      ...(typeof current.decision === "object" && current.decision !== null
        ? (current.decision as Record<string, unknown>)
        : {})
    },
    queryPlan: {
      ...defaultResearch.queryPlan,
      ...(typeof current.queryPlan === "object" && current.queryPlan !== null
        ? (current.queryPlan as Record<string, unknown>)
        : {})
    },
    verification: {
      ...defaultResearch.verification,
      ...(typeof current.verification === "object" && current.verification !== null
        ? (current.verification as Record<string, unknown>)
        : {})
    },
    appliedTo: {
      ...defaultResearch.appliedTo,
      ...(typeof current.appliedTo === "object" && current.appliedTo !== null
        ? (current.appliedTo as Record<string, unknown>)
        : {})
    },
    impact: {
      ...defaultResearch.impact,
      ...(typeof current.impact === "object" && current.impact !== null
        ? (current.impact as Record<string, unknown>)
        : {})
    }
  });
}

function buildLegacyArenaMemorySnapshot(args: {
  roundId: string;
  question: string;
  category: ArenaRound["category"];
  orchestration: ArenaRound["orchestration"];
  router: ArenaRound["router"];
  research: ArenaRound["research"];
}) {
  return {
    snapshotId: args.roundId,
    question: args.question,
    category: args.category,
    summary: compactText(
      `Legacy arena round backfilled into Hydria memory with router ${args.router.globalStrategy}.`,
      320
    ),
    core: [
      {
        itemId: LEGACY_NIL_UUID,
        layer: "core",
        priority: "medium",
        title: compactText("Legacy orchestration", 140),
        content: compactText(
          `Focus ${args.orchestration.focus}. Research policy ${args.orchestration.researchPolicy}.`,
          320
        ),
        tags: ["legacy", "orchestration"]
      }
    ],
    episodic: [
      {
        itemId: LEGACY_NIL_UUID,
        layer: "episodic",
        priority: "low",
        title: compactText("Legacy router reasoning", 140),
        content: compactText(args.router.reasoning.join(" "), 320),
        tags: ["legacy", "router"]
      }
    ],
    semantic: [],
    archival: [],
    retrieval: {
      strategyId: `arena:${args.router.globalStrategy}`,
      researchIntent: args.research.decision.shouldUse ? args.research.queryPlan.intent : null,
      temporalQueryType:
        args.research.decision.shouldUse && args.research.queryPlan.temporalProfile.isTemporal
          ? args.research.queryPlan.temporalProfile.queryType
          : null,
      preferredDomains: args.research.queryPlan.preferredDomains,
      studentRuleIds: []
    }
  };
}

function buildLegacyArenaWorkflowRun(args: {
  roundId: string;
  question: string;
  category: ArenaRound["category"];
  createdAt: string;
}) {
  return {
    runId: args.roundId,
    scope: "arena_round",
    status: "partial",
    question: args.question,
    category: args.category,
    startedAt: args.createdAt,
    completedAt: args.createdAt,
    messages: [],
    handoffs: [],
    tasks: [],
    degradationReasons: [],
    outcome: "Legacy arena round loaded before Hydria workflow metadata was recorded."
  };
}

function buildLegacyRefinerOutput(respondent: RespondentOutput, slot: "A" | "B") {
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

function buildLegacyTrace(
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
      ...buildNoSkillTraceFields(),
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
      ...buildNoSkillTraceFields(),
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
      ...buildNoSkillTraceFields(),
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
      ...buildNoSkillTraceFields(),
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
      ...buildNoSkillTraceFields(),
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
      ...buildNoSkillTraceFields(),
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
      ...buildNoSkillTraceFields(),
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
      ...buildNoSkillTraceFields(),
      outcome: studentAnswer.startsWith("Local student disabled")
        ? "disabled"
        : studentAnswer.startsWith("Local student unavailable")
          ? "static_fallback"
          : "legacy",
      note: "Legacy round backfilled after execution trace was introduced."
    }
  };
}

function buildLegacyTimings(): ArenaTimings {
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

function normalizeJudgeOutput(rawJudge: unknown) {
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

function normalizeRedTeamOutput(rawRedTeam: unknown) {
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

function mergeMetrics(derivedMetrics: ArenaRound["metrics"], rawMetrics: unknown) {
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

function mergeVerdicts(derivedVerdicts: ArenaRound["verdicts"], rawVerdicts: unknown) {
  const verdicts =
    typeof rawVerdicts === "object" && rawVerdicts !== null
      ? (rawVerdicts as Record<string, unknown>)
      : {};

  return arenaVerdictsSchema.parse({
    ...derivedVerdicts,
    ...verdicts
  });
}

function mergeRefineDecision(
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

import type { ArenaRound } from "../types/arena.js";
import type { ArenaQualityAnalyticsReport } from "../types/analytics.js";
import type { KnowledgeLayer } from "../types/knowledge.js";
import type { StudentSession } from "../types/student.js";
import type {
  LearningImprovementComponent,
  LearningImprovementScore,
  LearningImprovementWeights
} from "../types/learning.js";
import type { StudentToolImpactFile } from "./studentToolImpactTrackerService.js";

type BuildScoreArgs = {
  rounds: ArenaRound[];
  sessions: StudentSession[];
  knowledgeLayer: KnowledgeLayer | null;
  toolImpact: StudentToolImpactFile | null;
  arenaQuality: ArenaQualityAnalyticsReport;
  weights?: LearningImprovementWeights;
};

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function scaleDeltaToScore(value: number | null, span: number) {
  if (value === null) {
    return 50;
  }

  return clamp(round(50 + (value / span) * 50), 0, 100);
}

function buildComponent(score: number, rationale: string, observedValue: number | null): LearningImprovementComponent {
  return {
    score: round(score),
    rationale,
    observedValue: observedValue === null ? null : round(observedValue)
  };
}

export const DEFAULT_LEARNING_IMPROVEMENT_WEIGHTS: LearningImprovementWeights = {
  factuality: 0.22,
  researchImpact: 0.16,
  refineImpact: 0.16,
  stability: 0.16,
  costEfficiency: 0.08,
  latency: 0.08,
  noOpResistance: 0.07,
  regressionResistance: 0.07
};

export class LearningImprovementScoreService {
  buildScore(args: BuildScoreArgs): {
    weights: LearningImprovementWeights;
    score: LearningImprovementScore;
  } {
    const weights = args.weights ?? DEFAULT_LEARNING_IMPROVEMENT_WEIGHTS;
    const noReliableSourceRate = args.toolImpact?.overall.used.noReliableSourceRate ?? null;
    const unsupportedClaimRate =
      args.sessions.length > 0
        ? (args.sessions.filter((session) =>
            session.lessonsLearned.some((lesson) => lesson.failureType === "unsupported_claim")
          ).length /
            args.sessions.length) *
          100
        : null;
    const factualityScore = buildComponent(
      clamp(
        (100 - (noReliableSourceRate ?? 50)) * 0.7 -
          (unsupportedClaimRate ?? 0) * 0.3 +
          35,
        0,
        100
      ),
      "Combine reliability of grounded answers with the observed rate of unsupported-claim lessons.",
      noReliableSourceRate === null && unsupportedClaimRate === null
        ? null
        : round(((100 - (noReliableSourceRate ?? 50)) + (100 - (unsupportedClaimRate ?? 0))) / 2)
    );

    const researchImpactDelta = args.toolImpact?.overall.averageJudgeDeltaDelta ?? null;
    const researchPositiveImpactRate = args.toolImpact?.overall.used.positiveImpactRate ?? null;
    const researchImpactScore = buildComponent(
      clamp(
        scaleDeltaToScore(researchImpactDelta, 8) * 0.6 +
          (researchPositiveImpactRate ?? 50) * 0.4,
        0,
        100
      ),
      "Research impact rewards positive judge deltas when tooling is used, and penalizes unhelpful grounding.",
      researchImpactDelta
    );

    const benchmarkEntries = args.knowledgeLayer?.categories ?? [];
    const worthItRate = average(benchmarkEntries.map((entry) => entry.benchmark.worthItRate));
    const noOpRate = average(benchmarkEntries.map((entry) => entry.benchmark.noOpRate));
    const staticFallbackRate = average(
      benchmarkEntries.map((entry) => entry.benchmark.staticFallbackRate)
    );
    const degradingRate = average(benchmarkEntries.map((entry) => entry.benchmark.degradingRate));
    const refineImpactScore = buildComponent(
      clamp((worthItRate ?? 50) * 0.7 + (100 - (noOpRate ?? 50)) * 0.2 + (100 - (staticFallbackRate ?? 50)) * 0.1, 0, 100),
      "Refine impact is anchored on benchmark worth-it rate, then discounted by no-op and static fallback behavior.",
      worthItRate
    );

    const failedRate =
      args.rounds.length > 0
        ? (args.rounds.filter((round) => round.workflow.status === "failed").length / args.rounds.length) *
          100
        : null;
    const stabilityObserved =
      args.arenaQuality.summary.classifiedPartialRatePct +
      (failedRate ?? 0) * 1.2;
    const stabilityScore = buildComponent(
      clamp(100 - stabilityObserved, 0, 100),
      "Stability drops when classified partial rounds or failed rounds accumulate.",
      stabilityObserved
    );

    const averageCostShare = average(
      args.rounds.map((round) => round.research.impact.costSharePct ?? 0)
    );
    const costEfficiencyScore = buildComponent(
      clamp(
        100 - (averageCostShare ?? 0) * 0.7 - (args.toolImpact?.overall.used.noReliableSourceRate ?? 0) * 0.2,
        0,
        100
      ),
      "Cost efficiency rewards low research cost share and penalizes expensive grounding that still fails to verify.",
      averageCostShare
    );

    const averageLatencyMs = average(args.rounds.map((round) => round.durationMs));
    const latencyScore = buildComponent(
      clamp(100 - ((averageLatencyMs ?? 15000) / 30000) * 100, 0, 100),
      "Latency is scored against a soft 30s budget for a full arena round.",
      averageLatencyMs
    );

    const noOpResistanceScore = buildComponent(
      clamp(100 - (noOpRate ?? 50), 0, 100),
      "No-op resistance tracks how often refine produces little or no useful change in benchmarked categories.",
      noOpRate
    );

    const negativeStrategyRate =
      benchmarkEntries.length > 0 && args.sessions.length > 0
        ? (args.sessions.filter((session) => session.strategyImpact.compared && session.strategyImpact.metrics.gainGlobal < 0).length /
            args.sessions.length) *
          100
        : null;
    const regressionResistanceScore = buildComponent(
      clamp(100 - (degradingRate ?? 0) * 0.7 - (negativeStrategyRate ?? 0) * 0.3, 0, 100),
      "Regression resistance discounts degrading benchmark rounds and negatively performing strategy comparisons.",
      degradingRate === null && negativeStrategyRate === null
        ? null
        : round(((degradingRate ?? 0) + (negativeStrategyRate ?? 0)) / 2)
    );

    const components = {
      factuality: factualityScore,
      researchImpact: researchImpactScore,
      refineImpact: refineImpactScore,
      stability: stabilityScore,
      costEfficiency: costEfficiencyScore,
      latency: latencyScore,
      noOpResistance: noOpResistanceScore,
      regressionResistance: regressionResistanceScore
    };

    const overall = round(
      components.factuality.score * weights.factuality +
        components.researchImpact.score * weights.researchImpact +
        components.refineImpact.score * weights.refineImpact +
        components.stability.score * weights.stability +
        components.costEfficiency.score * weights.costEfficiency +
        components.latency.score * weights.latency +
        components.noOpResistance.score * weights.noOpResistance +
        components.regressionResistance.score * weights.regressionResistance
    );

    return {
      weights,
      score: {
        overall,
        components
      }
    };
  }
}

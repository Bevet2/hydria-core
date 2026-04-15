import type {
  ArenaMetrics,
  ArenaTimings,
  ArenaVerdicts,
  ExecutionTrace,
  GainClassification,
  JudgeScorePair,
  QuestionCategory,
  RefineRouterDecisionDetails,
  RedTeamOutput,
  RefineDecision,
  RefineImpactDetail,
  RefineImpactVerdict,
  RefinerOutput,
  RespondentOutput,
  ScoreExplanationDetail
} from "../types/arena.js";
import { analyzeProductStrategySignals } from "../utils/productStrategySignals.js";

type SideKey = "A" | "B";

type DeriveRoundMetricsArgs = {
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  refineA: RefinerOutput;
  refineB: RefinerOutput;
  redTeam: RedTeamOutput;
  initialScores: JudgeScorePair;
  refinedScores: JudgeScorePair;
  refineATrace: ExecutionTrace;
  refineBTrace: ExecutionTrace;
  router: RefineRouterDecisionDetails;
  category: QuestionCategory;
  timings: ArenaTimings;
  durationMs: number;
};

type SideMetricInput = {
  slot: SideKey;
  respondent: RespondentOutput;
  refine: RefinerOutput;
  redTeam: RedTeamOutput;
  initialScores: JudgeScorePair[SideKey];
  refinedScores: JudgeScorePair[SideKey];
  trace: ExecutionTrace;
  routerShouldRefine: boolean;
  category: QuestionCategory;
};

type SideMetricResult = {
  impact: RefineImpactDetail;
  gain: number;
  verdict: RefineImpactVerdict;
  gainClassification: GainClassification;
  scoreExplanation: ScoreExplanationDetail;
  refineDecision: RefineDecision["A"];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageSigned(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getCritiqueItems(redTeam: RedTeamOutput, slot: SideKey) {
  const directAttacks = slot === "A" ? redTeam.attacks_on_a : redTeam.attacks_on_b;
  return [
    ...directAttacks,
    ...redTeam.shared_risks,
    ...redTeam.failure_scenarios,
    ...redTeam.hidden_assumptions,
    ...redTeam.potentially_false_claims
  ];
}

function classifyGain(gain: number): GainClassification {
  if (gain <= 2) {
    return "negligible";
  }

  if (gain <= 5) {
    return "weak";
  }

  if (gain <= 10) {
    return "moderate";
  }

  return "strong";
}

function hasMixedReasoningStrongNetImprovement(args: {
  category: QuestionCategory;
  gain: number;
  impact: RefineImpactDetail;
  preservedOriginal: boolean;
}) {
  if (args.category !== "mixed_reasoning" || args.preservedOriginal) {
    return false;
  }

  return (
    args.gain >= 8 &&
    args.impact.overallDelta >= 8 &&
    args.impact.robustnessDelta >= 6 &&
    args.impact.critiqueCoveragePct >= 20
  );
}

function classifyVerdict(args: {
  category: QuestionCategory;
  gain: number;
  impact: RefineImpactDetail;
  trace: ExecutionTrace;
  preservedOriginal: boolean;
}): RefineImpactVerdict {
  if (args.trace.outcome === "static_fallback" || args.preservedOriginal) {
    return "fallback_preserved";
  }

  const mixedReasoningStrongNetImprovement = hasMixedReasoningStrongNetImprovement(args);

  if (
    args.gain <= -4 ||
    args.impact.overallDelta <= -4 ||
    (!mixedReasoningStrongNetImprovement && args.impact.hallucinationRiskReduction <= -8)
  ) {
    return "degrading";
  }

  if (
    args.gain >= 7 &&
    (args.impact.overallDelta >= 3 || args.impact.robustnessDelta >= 5) &&
    args.impact.critiqueCoveragePct >= 20
  ) {
    return "useful";
  }

  if (args.gain >= 3) {
    return "minor";
  }

  return "neutral";
}

function buildScoreExplanation(args: {
  category: QuestionCategory;
  respondent: RespondentOutput;
  refine: RefinerOutput;
  impact: RefineImpactDetail;
  verdict: RefineImpactVerdict;
  trace: ExecutionTrace;
  preservedOriginal: boolean;
}): ScoreExplanationDetail {
  const improvements: string[] = [];
  const regressions: string[] = [];

  if (args.preservedOriginal) {
    regressions.push("Refine preserved the original answer instead of delivering a validated improvement.");
  }

  if (args.impact.robustnessDelta >= 3) {
    improvements.push(`Robustness improved by ${args.impact.robustnessDelta} points.`);
  }
  if (args.impact.clarityDelta >= 3) {
    improvements.push(`Clarity improved by ${args.impact.clarityDelta} points.`);
  }
  if (args.impact.relevanceDelta >= 3) {
    improvements.push(`Relevance improved by ${args.impact.relevanceDelta} points.`);
  }
  if (args.impact.hallucinationRiskReduction >= 3) {
    improvements.push(
      `Hallucination risk decreased by ${args.impact.hallucinationRiskReduction} points.`
    );
  }
  if (args.impact.critiqueCoveragePct >= 35 && args.impact.fixesCount > 0) {
    improvements.push(
      `The refiner integrated ${args.impact.fixesCount} critique-driven fixes.`
    );
  }

  if (args.impact.robustnessDelta <= -3) {
    regressions.push(`Robustness dropped by ${Math.abs(args.impact.robustnessDelta)} points.`);
  }
  if (args.impact.clarityDelta <= -3) {
    regressions.push(`Clarity dropped by ${Math.abs(args.impact.clarityDelta)} points.`);
  }
  if (args.impact.relevanceDelta <= -3) {
    regressions.push(`Relevance dropped by ${Math.abs(args.impact.relevanceDelta)} points.`);
  }
  if (args.impact.hallucinationRiskReduction <= -3) {
    regressions.push(
      `Hallucination risk increased by ${Math.abs(args.impact.hallucinationRiskReduction)} points.`
    );
  }
  if (args.trace.usedFallback && args.trace.outcome !== "static_fallback") {
    regressions.push("Refine required a fallback path before succeeding.");
  }

  if (args.category === "product_strategy") {
    const beforeSignals = analyzeProductStrategySignals(args.respondent);
    const afterSignals = analyzeProductStrategySignals({
      answer: args.refine.improved_answer,
      key_points: args.refine.fixes_applied,
      assumptions: args.refine.remaining_uncertainties
    });

    if (
      afterSignals.prioritizationSignals + afterSignals.sequencingSignals >
      beforeSignals.prioritizationSignals + beforeSignals.sequencingSignals
    ) {
      improvements.push("Prioritization and execution sequence became more explicit.");
    }

    if (afterSignals.metricSignals > beforeSignals.metricSignals) {
      improvements.push("Success metrics or validation signals became more explicit.");
    }

    if (
      afterSignals.riskSignals + afterSignals.dependencySignals >
      beforeSignals.riskSignals + beforeSignals.dependencySignals
    ) {
      improvements.push("Risks, constraints, or dependencies became more visible.");
    }

    if (afterSignals.decisionSignals > beforeSignals.decisionSignals) {
      improvements.push("The strategy now makes clearer decisions instead of generic advice.");
    }

    if (afterSignals.fluffSignals < beforeSignals.fluffSignals) {
      improvements.push("The refine reduced generic product fluff and made the plan more testable.");
    }

    if (
      afterSignals.prioritizationSignals + afterSignals.sequencingSignals === 0 &&
      afterSignals.metricSignals === 0
    ) {
      regressions.push("The refined strategy still lacks clear sequencing and success metrics.");
    }

    if (afterSignals.fluffSignals > beforeSignals.fluffSignals) {
      regressions.push(
        "The refined answer introduced more generic product language without enough concrete decisions."
      );
    }
  }

  const driverCandidates = [
    { label: "robustness increase", value: args.impact.robustnessDelta },
    { label: "clarity improvement", value: args.impact.clarityDelta },
    { label: "relevance improvement", value: args.impact.relevanceDelta },
    {
      label: "hallucination risk reduction",
      value: args.impact.hallucinationRiskReduction
    },
    {
      label: "better Red Team integration",
      value: Math.round(args.impact.critiqueCoveragePct / 10)
    }
  ].sort((left, right) => right.value - left.value);

  const leadingDriver = driverCandidates[0];
  let mainDriver =
    leadingDriver && leadingDriver.value > 0
      ? leadingDriver.label
      : "no material improvement";

  if (args.category === "product_strategy") {
    const beforeSignals = analyzeProductStrategySignals(args.respondent);
    const afterSignals = analyzeProductStrategySignals({
      answer: args.refine.improved_answer,
      key_points: args.refine.fixes_applied,
      assumptions: args.refine.remaining_uncertainties
    });
    const strategyDriverCandidates = [
      {
        label: "better prioritization and sequencing",
        value:
          afterSignals.prioritizationSignals +
          afterSignals.sequencingSignals -
          beforeSignals.prioritizationSignals -
          beforeSignals.sequencingSignals
      },
      {
        label: "more explicit success metrics",
        value: afterSignals.metricSignals - beforeSignals.metricSignals
      },
      {
        label: "clearer risks and dependencies",
        value:
          afterSignals.riskSignals +
          afterSignals.dependencySignals -
          beforeSignals.riskSignals -
          beforeSignals.dependencySignals
      },
      {
        label: "less product fluff",
        value: beforeSignals.fluffSignals - afterSignals.fluffSignals
      }
    ].sort((left, right) => right.value - left.value);

    const strategyDriver = strategyDriverCandidates[0];
    if (strategyDriver && strategyDriver.value > 0) {
      mainDriver = strategyDriver.label;
    }
  }

  if (args.verdict === "fallback_preserved") {
    mainDriver = "original answer preserved after failed refinement";
  } else if (args.verdict === "degrading") {
    mainDriver = regressions[0] ?? "score regressions outweighed the refine benefit";
  }

  return {
    improvements: improvements.slice(0, 5),
    regressions: regressions.slice(0, 5),
    main_driver: mainDriver
  };
}

function decideRefineWorthIt(args: {
  category: QuestionCategory;
  gainClassification: GainClassification;
  verdict: RefineImpactVerdict;
  impact: RefineImpactDetail;
  preservedOriginal: boolean;
}): RefineDecision["A"] {
  const mixedReasoningStrongNetImprovement = hasMixedReasoningStrongNetImprovement({
    category: args.category,
    gain:
      args.impact.overallDelta +
      Math.max(0, Math.round(args.impact.robustnessDelta / 2)) +
      Math.max(0, Math.round(args.impact.critiqueCoveragePct / 25)),
    impact: args.impact,
    preservedOriginal: args.preservedOriginal
  });
  const hasMaterialRegression =
    args.impact.overallDelta < 0 ||
    args.impact.robustnessDelta < -2 ||
    args.impact.relevanceDelta < -3 ||
    args.impact.clarityDelta < -3 ||
    (!mixedReasoningStrongNetImprovement && args.impact.hallucinationRiskReduction < 0);

  if (args.preservedOriginal || args.verdict === "fallback_preserved") {
    return "NO";
  }

  if (args.verdict === "degrading" || hasMaterialRegression) {
    return "NO";
  }

  if (args.gainClassification === "strong") {
    return "YES";
  }

  if (
    args.gainClassification === "moderate" &&
    args.impact.overallDelta >= 3 &&
    args.impact.hallucinationRiskReduction >= 0
  ) {
    return "YES";
  }

  return "NO";
}

function buildSideImpact(input: SideMetricInput): SideMetricResult {
  const routerSkipped = input.refine.routerSkipped || !input.routerShouldRefine;
  if (routerSkipped) {
    return {
      impact: {
        overallDelta: 0,
        clarityDelta: 0,
        relevanceDelta: 0,
        robustnessDelta: 0,
        hallucinationRiskReduction: 0,
        critiqueCoveragePct: 0,
        fixesCount: 0
      },
      gain: 0,
      verdict: "neutral",
      gainClassification: "negligible",
      scoreExplanation: {
        improvements: [],
        regressions: ["Refine was skipped by the router because expected value was low."],
        main_driver: "router skipped refinement due to low expected value"
      },
      refineDecision: "NO"
    };
  }

  const critiqueItems = getCritiqueItems(input.redTeam, input.slot);
  const critiqueDenominator = clamp(critiqueItems.length, 1, 12);
  const critiqueCoveragePct = clamp(
    Math.round(
      (Math.min(input.refine.fixes_applied.length, critiqueDenominator) / critiqueDenominator) *
        100
    ),
    0,
    100
  );

  const impact: RefineImpactDetail = {
    overallDelta: input.refinedScores.overall - input.initialScores.overall,
    clarityDelta: input.refinedScores.clarity - input.initialScores.clarity,
    relevanceDelta: input.refinedScores.relevance - input.initialScores.relevance,
    robustnessDelta: input.refinedScores.robustness - input.initialScores.robustness,
    hallucinationRiskReduction:
      input.initialScores.hallucination_risk - input.refinedScores.hallucination_risk,
    critiqueCoveragePct,
    fixesCount: input.refine.fixes_applied.length
  };

  const weightedDelta =
    impact.overallDelta * 0.45 +
    impact.robustnessDelta * 0.25 +
    impact.clarityDelta * 0.15 +
    impact.hallucinationRiskReduction * 0.15;

  const coverageBonus =
    critiqueCoveragePct >= 70 ? 3 : critiqueCoveragePct >= 40 ? 2 : critiqueCoveragePct >= 20 ? 1 : 0;

  const fallbackPenalty =
    input.trace.outcome === "static_fallback" ? 4 : input.trace.usedFallback ? 1 : 0;

  const preservedOriginal =
    normalizeText(input.refine.improved_answer) === normalizeText(input.respondent.answer) &&
    input.refine.fixes_applied.length === 0;

  const gain = clamp(Math.round(weightedDelta) + coverageBonus - fallbackPenalty, -20, 20);
  const verdict = classifyVerdict({
    category: input.category,
    gain,
    impact,
    trace: input.trace,
    preservedOriginal
  });
  const gainClassification = classifyGain(gain);
  const scoreExplanation = buildScoreExplanation({
    category: input.category,
    respondent: input.respondent,
    refine: input.refine,
    impact,
    verdict,
    trace: input.trace,
    preservedOriginal
  });
  const refineDecision = decideRefineWorthIt({
    category: input.category,
    gainClassification,
    verdict,
    impact,
    preservedOriginal
  });

  return {
    impact,
    gain,
    verdict,
    gainClassification,
    scoreExplanation,
    refineDecision
  };
}

export function deriveRoundMetrics(args: DeriveRoundMetricsArgs): {
  metrics: ArenaMetrics;
  verdicts: ArenaVerdicts;
  refineDecision: RefineDecision;
} {
  const sideA = buildSideImpact({
    slot: "A",
    respondent: args.respondentA,
    refine: args.refineA,
    redTeam: args.redTeam,
    initialScores: args.initialScores.A,
    refinedScores: args.refinedScores.A,
    trace: args.refineATrace,
    routerShouldRefine: args.router.shouldRefineA,
    category: args.category
  });
  const sideB = buildSideImpact({
    slot: "B",
    respondent: args.respondentB,
    refine: args.refineB,
    redTeam: args.redTeam,
    initialScores: args.initialScores.B,
    refinedScores: args.refinedScores.B,
    trace: args.refineBTrace,
    routerShouldRefine: args.router.shouldRefineB,
    category: args.category
  });

  const globalGain = Math.round((sideA.gain + sideB.gain) / 2);
  const globalGainClassification = classifyGain(globalGain);
  const refineExecutedCount =
    (args.router.shouldRefineA ? 1 : 0) + (args.router.shouldRefineB ? 1 : 0);
  const refineSkippedCount = 2 - refineExecutedCount;
  const refinedGains = [
    ...(args.router.shouldRefineA ? [sideA.gain] : []),
    ...(args.router.shouldRefineB ? [sideB.gain] : [])
  ];
  const skippedGains = [
    ...(!args.router.shouldRefineA ? [sideA.gain] : []),
    ...(!args.router.shouldRefineB ? [sideB.gain] : [])
  ];

  const metrics: ArenaMetrics = {
    initialScores: args.initialScores,
    refinedScores: args.refinedScores,
    refineImpact: {
      A: sideA.impact,
      B: sideB.impact
    },
    refineGain: {
      A: sideA.gain,
      B: sideB.gain,
      global: globalGain
    },
    gainClassification: {
      A: sideA.gainClassification,
      B: sideB.gainClassification,
      global: globalGainClassification
    },
    scoreExplanation: {
      A: sideA.scoreExplanation,
      B: sideB.scoreExplanation
    },
    scoreAverages: {
      initial: average([args.initialScores.A.overall, args.initialScores.B.overall]),
      refined: average([args.refinedScores.A.overall, args.refinedScores.B.overall])
    },
    latencyBreakdown: {
      totalMs: args.durationMs,
      refineMs: args.timings.refineA + args.timings.refineB,
      refineSharePct:
        args.durationMs > 0
          ? clamp(
              Math.round(((args.timings.refineA + args.timings.refineB) / args.durationMs) * 100),
              0,
              100
            )
          : 0
    },
    routing: {
      refineExecutedCount,
      refineSkippedCount,
      refineExecutionRate: refineExecutedCount > 0 ? refineExecutedCount * 50 : 0,
      refineSkipRate: refineSkippedCount > 0 ? refineSkippedCount * 50 : 0,
      averageGainWhenRefined: averageSigned(refinedGains),
      averageGainWhenSkipped: averageSigned(skippedGains)
    },
    topValueStep:
      Math.abs(sideA.gain - sideB.gain) <= 1
        ? "tie"
        : sideA.gain > sideB.gain
          ? "refineA"
          : "refineB"
  };

  const refineDecision: RefineDecision = {
    A: sideA.refineDecision,
    B: sideB.refineDecision,
    global:
      globalGainClassification !== "negligible" &&
      globalGainClassification !== "weak" &&
      (sideA.refineDecision === "YES" || sideB.refineDecision === "YES") &&
      (args.category === "mixed_reasoning" ||
        (sideA.impact.hallucinationRiskReduction >= 0 &&
          sideB.impact.hallucinationRiskReduction >= 0)) &&
      sideA.verdict !== "degrading" &&
      sideB.verdict !== "degrading"
        ? "YES"
        : "NO"
  };

  return {
    metrics,
    verdicts: {
      refineA: sideA.verdict,
      refineB: sideB.verdict
    },
    refineDecision
  };
}

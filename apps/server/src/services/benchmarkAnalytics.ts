import type {
  BenchmarkCategory,
  BenchmarkCategoryStats,
  BenchmarkResearchModeDistribution,
  BenchmarkResearchNetImpactDistribution,
  BenchmarkPromptResult,
  BenchmarkResearchRouteDistribution,
  BenchmarkRespondentStability,
  BenchmarkSummary
} from "../types/benchmark.js";
import { getStaticRoutingRecommendation } from "./refineRouter.js";

const benchmarkCategories: BenchmarkCategory[] = [
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning"
];

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return roundToOneDecimal((sorted[middle - 1]! + sorted[middle]!) / 2);
  }

  return roundToOneDecimal(sorted[middle]!);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function averageByCount(total: number, count: number) {
  if (count === 0) {
    return 0;
  }

  return roundToOneDecimal(total / count);
}

function percentageByCount(total: number, count: number) {
  if (count === 0) {
    return 0;
  }

  return roundToOneDecimal((total / count) * 100);
}

function buildRespondentStability(results: BenchmarkPromptResult[]): BenchmarkRespondentStability {
  const slotCount = sum(results.map((result) => result.respondentSlotCount));
  const primarySuccessCount = sum(results.map((result) => result.respondentPrimarySuccessCount));
  const retrySuccessCount = sum(results.map((result) => result.respondentRetrySuccessCount));
  const fallbackSuccessCount = sum(results.map((result) => result.respondentFallbackSuccessCount));
  const finalFailureCount = sum(results.map((result) => result.respondentFinalFailureCount));
  const retryCount = sum(results.map((result) => result.respondentRetryCount));
  const fallbackCount = sum(results.map((result) => result.respondentFallbackCount));
  const validationFailureCount = sum(
    results.map((result) => result.respondentValidationFailureCount)
  );
  const latencyTotal = sum(results.map((result) => result.respondentLatencyTotalMs));

  return {
    slotCount,
    primarySuccessRate: percentageByCount(primarySuccessCount, slotCount),
    retrySuccessRate: percentageByCount(retrySuccessCount, slotCount),
    fallbackSuccessRate: percentageByCount(fallbackSuccessCount, slotCount),
    finalFailureRate: percentageByCount(finalFailureCount, slotCount),
    respondentRetryRate: percentageByCount(retryCount, slotCount),
    respondentFallbackRate: percentageByCount(fallbackCount, slotCount),
    respondentValidationFailureRate: percentageByCount(validationFailureCount, slotCount),
    averageRespondentLatency: averageByCount(latencyTotal, slotCount)
  };
}

function buildResearchRouteDistribution(results: BenchmarkPromptResult[]): BenchmarkResearchRouteDistribution {
  return {
    not_needed: results.filter((result) => result.researchRoute === "not_needed").length,
    used: results.filter((result) => result.researchRoute === "used").length,
    failed: results.filter((result) => result.researchRoute === "failed").length
  };
}

function buildResearchModeDistribution(
  results: BenchmarkPromptResult[]
): BenchmarkResearchModeDistribution {
  return {
    off: results.filter((result) => result.researchDecisionMode === "off").length,
    targeted_verify: results.filter((result) => result.researchDecisionMode === "targeted_verify")
      .length,
    constraint_check: results.filter((result) => result.researchDecisionMode === "constraint_check")
      .length,
    fact_check_only: results.filter((result) => result.researchDecisionMode === "fact_check_only")
      .length,
    verify_factual_subpart: results.filter(
      (result) => result.researchDecisionMode === "verify_factual_subpart"
    ).length
  };
}

function buildResearchNetImpactDistribution(
  results: BenchmarkPromptResult[]
): BenchmarkResearchNetImpactDistribution {
  return {
    positive: results.filter((result) => result.researchNetImpact === "positive").length,
    neutral: results.filter((result) => result.researchNetImpact === "neutral").length,
    negative: results.filter((result) => result.researchNetImpact === "negative").length,
    unknown: results.filter((result) => result.researchNetImpact === "unknown").length
  };
}

function deriveRoutingRecommendation(stats: {
  category: BenchmarkCategory;
  runs: number;
  averageGain: number;
  worthItRate: number;
  averageGainWhenRefined: number;
  averageGainWhenSkipped: number;
}) {
  if (stats.runs < 3) {
    return getStaticRoutingRecommendation(stats.category);
  }

  if (stats.averageGainWhenRefined <= 1 || stats.worthItRate < 35) {
    return "prefer_skip" as const;
  }

  if (
    stats.averageGainWhenRefined >= 8 &&
    stats.averageGainWhenRefined >= stats.averageGainWhenSkipped + 4 &&
    stats.worthItRate >= 60
  ) {
    return "prefer_refine" as const;
  }

  if (stats.averageGain <= 2 && stats.averageGainWhenSkipped >= 0) {
    return "prefer_skip" as const;
  }

  return "selective" as const;
}

function buildInterpretation(
  summary: Pick<
    BenchmarkSummary,
    | "averageRefineLatencyShare"
    | "refineSkipRate"
    | "averageLatencyWithRefine"
    | "averageLatencyWithoutRefine"
    | "averageGainWhenSkipped"
    | "researchUsageRate"
    | "researchFailureRate"
    | "averageGainWhenResearchUsed"
    | "averageGainWhenResearchUnused"
    | "averageResearchLatency"
    | "averageResearchCostShare"
    | "refineChangedByToolRate"
    | "positiveResearchImpactRate"
    | "negativeResearchImpactRate"
    | "averageCorrectedClaims"
    | "averageSourceBackedClaims"
    | "researchModeDistribution"
    | "researchNetImpactDistribution"
    | "respondentStability"
    | "categoryStats"
  >
) {
  const activeCategories = summary.categoryStats.filter((item) => item.runs > 0);
  const strengths = [...activeCategories]
    .sort((left, right) => right.averageGain - left.averageGain)
    .slice(0, 2)
    .map(
      (item) =>
        `${item.category} performs best: avg gain ${item.averageGain}, worth-it rate ${item.worthItRate}%.`
    );

  const weakSpots = [...activeCategories]
    .filter(
      (item) =>
        item.routingRecommendation === "prefer_skip" ||
        item.averageGain <= 2 ||
        item.worthItRate < 35
    )
    .sort((left, right) => left.averageGain - right.averageGain)
    .slice(0, 2)
    .map(
      (item) =>
        `${item.category} is weaker: avg gain ${item.averageGain}, worth-it rate ${item.worthItRate}%.`
    );

  const costNotes: string[] = [];
  if (summary.averageRefineLatencyShare >= 40) {
    costNotes.push(
      `Refine cost is globally high: ${summary.averageRefineLatencyShare}% of total latency on average.`
    );
  }
  if (
    summary.averageLatencyWithRefine > 0 &&
    summary.averageLatencyWithoutRefine > 0 &&
    summary.averageLatencyWithRefine > summary.averageLatencyWithoutRefine
  ) {
    costNotes.push(
      `Runs with refine average ${summary.averageLatencyWithRefine} ms vs ${summary.averageLatencyWithoutRefine} ms without refine.`
    );
  }
  if (summary.respondentStability.finalFailureRate > 0) {
    costNotes.push(
      `Respondent final failure rate is ${summary.respondentStability.finalFailureRate}%, which still constrains benchmark reliability.`
    );
  }
  if (summary.researchUsageRate > 0) {
    costNotes.push(
      `Research was used on ${summary.researchUsageRate}% of completed rounds, with ${summary.averageResearchLatency} ms average latency and ${summary.averageResearchCostShare}% round cost share on average.`
    );
  }

  const routingNotes: string[] = [];
  const preferSkip = activeCategories.filter(
    (item) => item.routingRecommendation === "prefer_skip"
  );
  const preferRefine = activeCategories.filter(
    (item) => item.routingRecommendation === "prefer_refine"
  );

  if (preferSkip.length > 0) {
    routingNotes.push(
      `Hydria should skip refine on ${preferSkip
        .map((item) => item.category)
        .slice(0, 2)
        .join(", ")} by default.`
    );
  }

  if (preferRefine.length > 0) {
    routingNotes.push(
      `Hydria benefits strongly from refine on ${preferRefine
        .map((item) => item.category)
        .slice(0, 2)
        .join(", ")}.`
    );
  }

  const operationalWriting = activeCategories.find(
    (item) => item.category === "operational_writing"
  );
  if (
    operationalWriting &&
    operationalWriting.averageGainWhenRefined >= 8 &&
    operationalWriting.worthItRate >= 60
  ) {
    routingNotes.push("Category-specific refine improved operational writing significantly.");
  }

  const debugDiagnostic = activeCategories.find(
    (item) => item.category === "debug_diagnostic"
  );
  if (
    debugDiagnostic &&
    debugDiagnostic.averageGainWhenRefined <= 2 &&
    debugDiagnostic.worthItRate < 35
  ) {
    routingNotes.push(
      "Debug diagnostic still suffers from low net value despite specialized refine."
    );
  }

  const architectureDesign = activeCategories.find(
    (item) => item.category === "architecture_design"
  );
  if (
    architectureDesign &&
    architectureDesign.averageGainWhenRefined <= 1 &&
    architectureDesign.degradingRate >= 20
  ) {
    routingNotes.push(
      "Architecture design remains weak and may need a different respondent style rather than stronger refine."
    );
  }

  const productStrategy = activeCategories.find((item) => item.category === "product_strategy");
  if (
    productStrategy &&
    productStrategy.averageGainWhenRefined <= 2 &&
    productStrategy.degradingRate >= 20
  ) {
    routingNotes.push(
      "Product strategy still needs harder prioritization, metrics, and anti-fluff discipline despite the specialized path."
    );
  } else if (
    productStrategy &&
    productStrategy.averageGainWhenRefined >= 5 &&
    productStrategy.degradingRate <= 20
  ) {
    routingNotes.push(
      "Product strategy is becoming more concrete: refine is adding sequencing, metrics, and clearer tradeoffs."
    );
  }

  if (
    summary.refineSkipRate > 0 &&
    summary.averageGainWhenSkipped >= 0 &&
    summary.averageLatencyWithRefine > summary.averageLatencyWithoutRefine
  ) {
    routingNotes.push("Selective refine reduces latency without hurting quality on skipped paths.");
  }
  if (summary.respondentStability.primarySuccessRate < 70) {
    routingNotes.push(
      `Respondent primary success is only ${summary.respondentStability.primarySuccessRate}%, so repair retry remains strategically important.`
    );
  }
  if (
    summary.researchUsageRate > 0 &&
    summary.averageGainWhenResearchUsed > summary.averageGainWhenResearchUnused + 2
  ) {
    routingNotes.push("Grounding appears net positive when the tool is actually used.");
  } else if (
    summary.researchUsageRate > 0 &&
    summary.averageGainWhenResearchUsed <= summary.averageGainWhenResearchUnused
  ) {
    routingNotes.push("Grounding is not yet outperforming unguided rounds and needs better query/source quality.");
  }
  if (summary.refineChangedByToolRate > 0) {
    routingNotes.push(
      `Tool context visibly changed refine output in ${summary.refineChangedByToolRate}% of tool-used rounds.`
    );
  }

  return {
    strengths: strengths.slice(0, 3),
    weakSpots:
      weakSpots.length > 0
        ? weakSpots.slice(0, 3)
        : [
            "Not enough low-performing categories yet to issue a strong skip recommendation."
          ],
    costNotes: costNotes.slice(0, 3),
    routingNotes: routingNotes.slice(0, 3)
  };
}

export function buildEmptyBenchmarkSummary(): BenchmarkSummary {
  return {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    averageGlobalGain: 0,
    medianGlobalGain: 0,
    worthItRate: 0,
    fallbackRate: 0,
    averageTotalLatency: 0,
    averageRefineLatencyShare: 0,
    refineExecutionRate: 0,
    refineSkipRate: 0,
    averageGainWhenRefined: 0,
    averageGainWhenSkipped: 0,
    averageLatencyWithRefine: 0,
    averageLatencyWithoutRefine: 0,
    respondentStability: {
      slotCount: 0,
      primarySuccessRate: 0,
      retrySuccessRate: 0,
      fallbackSuccessRate: 0,
      finalFailureRate: 0,
      respondentRetryRate: 0,
      respondentFallbackRate: 0,
      respondentValidationFailureRate: 0,
      averageRespondentLatency: 0
    },
    researchConsideredRate: 0,
    researchUsageRate: 0,
    researchFailureRate: 0,
    averageResearchLatency: 0,
    averageResearchSourceCount: 0,
    averageGainWhenResearchUsed: 0,
    averageGainWhenResearchUnused: 0,
    averageResearchCostShare: 0,
    refineChangedByToolRate: 0,
    positiveResearchImpactRate: 0,
    negativeResearchImpactRate: 0,
    averageCorrectedClaims: 0,
    averageSourceBackedClaims: 0,
    researchRouteDistribution: {
      not_needed: 0,
      used: 0,
      failed: 0
    },
    researchModeDistribution: {
      off: 0,
      targeted_verify: 0,
      constraint_check: 0,
      fact_check_only: 0,
      verify_factual_subpart: 0
    },
    researchNetImpactDistribution: {
      positive: 0,
      neutral: 0,
      negative: 0,
      unknown: 0
    },
    gainDistribution: {
      strong: 0,
      moderate: 0,
      weak: 0,
      negligible: 0,
      degrading: 0
    },
    decisionDistribution: {
      YES: 0,
      NO: 0
    },
    categoryStats: benchmarkCategories.map((category) => ({
      category,
      runs: 0,
      averageGain: 0,
      medianGain: 0,
      degradingRate: 0,
      worthItRate: 0,
      fallbackRate: 0,
      averageLatency: 0,
      refineExecutionRate: 0,
      averageGainWhenRefined: 0,
      averageGainWhenSkipped: 0,
      averageLatencyWithRefine: 0,
      averageLatencyWithoutRefine: 0,
      respondentRetryRate: 0,
      respondentFallbackRate: 0,
      respondentValidationFailureRate: 0,
      averageRespondentLatency: 0,
      researchConsideredRate: 0,
      researchUsageRate: 0,
      researchFailureRate: 0,
      averageResearchLatency: 0,
      averageResearchSourceCount: 0,
      averageGainWhenResearchUsed: 0,
      averageGainWhenResearchUnused: 0,
      averageResearchCostShare: 0,
      refineChangedByToolRate: 0,
      positiveResearchImpactRate: 0,
      negativeResearchImpactRate: 0,
      averageCorrectedClaims: 0,
      averageSourceBackedClaims: 0,
      routingRecommendation: getStaticRoutingRecommendation(category)
    })),
    bestRuns: [],
    worstRuns: [],
    interpretation: {
      strengths: [],
      weakSpots: [],
      costNotes: [],
      routingNotes: []
    }
  };
}

export function buildBenchmarkSummary(results: BenchmarkPromptResult[]): BenchmarkSummary {
  const successful = results.filter((result) => result.status === "completed");
  const failed = results.filter((result) => result.status === "failed");
  const gains = successful.map((result) => result.globalGain ?? 0);
  const totalLatencies = successful.map((result) => result.totalMs ?? 0);
  const refineShares = successful.map((result) => result.refineSharePct ?? 0);
  const totalExecutedRefines = sum(successful.map((result) => result.refineExecutedCount));
  const totalSkippedRefines = sum(successful.map((result) => result.refineSkippedCount));
  const totalRefineGain = sum(successful.map((result) => result.refineExecutedGainTotal));
  const totalSkippedGain = sum(successful.map((result) => result.refineSkippedGainTotal));
  const runsWithRefine = successful.filter((result) => result.refineExecutedCount > 0);
  const runsWithoutRefine = successful.filter((result) => result.refineExecutedCount === 0);
  const researchConsideredRuns = successful.filter((result) => result.researchConsidered);
  const researchUsedRuns = successful.filter((result) => result.researchUsed);
  const researchUnusedRuns = successful.filter((result) => !result.researchUsed);

  const gainDistribution = {
    strong: successful.filter((result) => result.gainClassification === "strong").length,
    moderate: successful.filter((result) => result.gainClassification === "moderate").length,
    weak: successful.filter((result) => result.gainClassification === "weak").length,
    negligible: successful.filter((result) => result.gainClassification === "negligible").length,
    degrading: successful.filter((result) => result.degrading).length
  };

  const decisionDistribution = {
    YES: successful.filter((result) => result.refineDecision === "YES").length,
    NO: successful.filter((result) => result.refineDecision === "NO").length
  };

  const categoryStats: BenchmarkCategoryStats[] = benchmarkCategories.map((category) => {
    const categoryRuns = successful.filter((result) => result.category === category);
    const categoryRespondentResults = results.filter(
      (result) => result.category === category && result.respondentSlotCount > 0
    );
    const executedCount = sum(categoryRuns.map((result) => result.refineExecutedCount));
    const skippedCount = sum(categoryRuns.map((result) => result.refineSkippedCount));
    const refineLatencyRuns = categoryRuns.filter((result) => result.refineExecutedCount > 0);
    const noRefineLatencyRuns = categoryRuns.filter((result) => result.refineExecutedCount === 0);
    const researchConsideredCategoryRuns = categoryRuns.filter((result) => result.researchConsidered);
    const researchUsedCategoryRuns = categoryRuns.filter((result) => result.researchUsed);
    const researchUnusedCategoryRuns = categoryRuns.filter((result) => !result.researchUsed);
    const averageGain = average(categoryRuns.map((result) => result.globalGain ?? 0));
    const respondentStability = buildRespondentStability(categoryRespondentResults);
    const worthItRate =
      categoryRuns.length > 0
        ? roundToOneDecimal(
            (categoryRuns.filter((result) => result.refineDecision === "YES").length /
              categoryRuns.length) *
              100
          )
        : 0;

    const stats: BenchmarkCategoryStats = {
      category,
      runs: categoryRuns.length,
      averageGain,
      medianGain: median(categoryRuns.map((result) => result.globalGain ?? 0)),
      degradingRate:
        categoryRuns.length > 0
          ? roundToOneDecimal(
              (categoryRuns.filter((result) => result.degrading).length / categoryRuns.length) *
                100
            )
          : 0,
      worthItRate,
      fallbackRate:
        categoryRuns.length > 0
          ? roundToOneDecimal(
              (categoryRuns.filter((result) => result.fallbackUsed).length / categoryRuns.length) *
                100
            )
          : 0,
      averageLatency: average(categoryRuns.map((result) => result.totalMs ?? 0)),
      refineExecutionRate:
        categoryRuns.length > 0
          ? roundToOneDecimal((executedCount / (categoryRuns.length * 2)) * 100)
          : 0,
      averageGainWhenRefined: averageByCount(
        sum(categoryRuns.map((result) => result.refineExecutedGainTotal)),
        executedCount
      ),
      averageGainWhenSkipped: averageByCount(
        sum(categoryRuns.map((result) => result.refineSkippedGainTotal)),
        skippedCount
      ),
      averageLatencyWithRefine: average(refineLatencyRuns.map((result) => result.totalMs ?? 0)),
      averageLatencyWithoutRefine: average(
        noRefineLatencyRuns.map((result) => result.totalMs ?? 0)
      ),
      respondentRetryRate: respondentStability.respondentRetryRate,
      respondentFallbackRate: respondentStability.respondentFallbackRate,
      respondentValidationFailureRate: respondentStability.respondentValidationFailureRate,
      averageRespondentLatency: respondentStability.averageRespondentLatency,
      researchConsideredRate: percentageByCount(
        researchConsideredCategoryRuns.length,
        categoryRuns.length
      ),
      researchUsageRate: percentageByCount(researchUsedCategoryRuns.length, categoryRuns.length),
      researchFailureRate: percentageByCount(
        categoryRuns.filter((result) => result.researchRoute === "failed").length,
        categoryRuns.length
      ),
      averageResearchLatency: average(
        researchConsideredCategoryRuns.map((result) => result.researchDurationMs)
      ),
      averageResearchSourceCount: averageByCount(
        sum(researchUsedCategoryRuns.map((result) => result.researchSourceCount)),
        researchUsedCategoryRuns.length
      ),
      averageGainWhenResearchUsed: average(
        researchUsedCategoryRuns.map((result) => result.globalGain ?? 0)
      ),
      averageGainWhenResearchUnused: average(
        researchUnusedCategoryRuns.map((result) => result.globalGain ?? 0)
      ),
      averageResearchCostShare: average(
        researchUsedCategoryRuns.map((result) => result.researchCostSharePct)
      ),
      refineChangedByToolRate: percentageByCount(
        researchUsedCategoryRuns.filter((result) => result.researchChangedRefine).length,
        researchUsedCategoryRuns.length
      ),
      positiveResearchImpactRate: percentageByCount(
        researchUsedCategoryRuns.filter((result) => result.researchNetImpact === "positive").length,
        researchUsedCategoryRuns.length
      ),
      negativeResearchImpactRate: percentageByCount(
        researchUsedCategoryRuns.filter((result) => result.researchNetImpact === "negative").length,
        researchUsedCategoryRuns.length
      ),
      averageCorrectedClaims: averageByCount(
        sum(researchUsedCategoryRuns.map((result) => result.researchCorrectedClaimsCount)),
        researchUsedCategoryRuns.length
      ),
      averageSourceBackedClaims: averageByCount(
        sum(researchUsedCategoryRuns.map((result) => result.researchSourceBackedClaimsCount)),
        researchUsedCategoryRuns.length
      ),
      routingRecommendation: "selective"
    };

    return {
      ...stats,
      routingRecommendation: deriveRoutingRecommendation({
        category,
        runs: stats.runs,
        averageGain: stats.averageGain,
        worthItRate: stats.worthItRate,
        averageGainWhenRefined: stats.averageGainWhenRefined,
        averageGainWhenSkipped: stats.averageGainWhenSkipped
      })
    };
  });

  const bestRuns = [...successful]
    .sort((left, right) => (right.globalGain ?? 0) - (left.globalGain ?? 0))
    .slice(0, 5);
  const worstRuns = [...successful]
    .sort((left, right) => (left.globalGain ?? 0) - (right.globalGain ?? 0))
    .slice(0, 5);

  const summary: BenchmarkSummary = {
    totalRuns: results.length,
    successfulRuns: successful.length,
    failedRuns: failed.length,
    averageGlobalGain: average(gains),
    medianGlobalGain: median(gains),
    worthItRate:
      successful.length > 0
        ? roundToOneDecimal((decisionDistribution.YES / successful.length) * 100)
        : 0,
    fallbackRate:
      successful.length > 0
        ? roundToOneDecimal(
            (successful.filter((result) => result.fallbackUsed).length / successful.length) * 100
          )
        : 0,
    averageTotalLatency: average(totalLatencies),
    averageRefineLatencyShare: average(refineShares),
    refineExecutionRate:
      successful.length > 0
        ? roundToOneDecimal((totalExecutedRefines / (successful.length * 2)) * 100)
        : 0,
    refineSkipRate:
      successful.length > 0
        ? roundToOneDecimal((totalSkippedRefines / (successful.length * 2)) * 100)
        : 0,
    averageGainWhenRefined: averageByCount(totalRefineGain, totalExecutedRefines),
    averageGainWhenSkipped: averageByCount(totalSkippedGain, totalSkippedRefines),
    averageLatencyWithRefine: average(runsWithRefine.map((result) => result.totalMs ?? 0)),
    averageLatencyWithoutRefine: average(
      runsWithoutRefine.map((result) => result.totalMs ?? 0)
    ),
    respondentStability: buildRespondentStability(results),
    researchConsideredRate: percentageByCount(researchConsideredRuns.length, successful.length),
    researchUsageRate: percentageByCount(researchUsedRuns.length, successful.length),
    researchFailureRate: percentageByCount(
      successful.filter((result) => result.researchRoute === "failed").length,
      successful.length
    ),
    averageResearchLatency: average(
      researchConsideredRuns.map((result) => result.researchDurationMs)
    ),
    averageResearchSourceCount: averageByCount(
      sum(researchUsedRuns.map((result) => result.researchSourceCount)),
      researchUsedRuns.length
    ),
    averageGainWhenResearchUsed: average(
      researchUsedRuns.map((result) => result.globalGain ?? 0)
    ),
    averageGainWhenResearchUnused: average(
      researchUnusedRuns.map((result) => result.globalGain ?? 0)
    ),
    researchRouteDistribution: buildResearchRouteDistribution(successful),
    researchModeDistribution: buildResearchModeDistribution(successful),
    researchNetImpactDistribution: buildResearchNetImpactDistribution(successful),
    averageResearchCostShare: average(
      researchUsedRuns.map((result) => result.researchCostSharePct)
    ),
    refineChangedByToolRate: percentageByCount(
      researchUsedRuns.filter((result) => result.researchChangedRefine).length,
      researchUsedRuns.length
    ),
    positiveResearchImpactRate: percentageByCount(
      researchUsedRuns.filter((result) => result.researchNetImpact === "positive").length,
      researchUsedRuns.length
    ),
    negativeResearchImpactRate: percentageByCount(
      researchUsedRuns.filter((result) => result.researchNetImpact === "negative").length,
      researchUsedRuns.length
    ),
    averageCorrectedClaims: averageByCount(
      sum(researchUsedRuns.map((result) => result.researchCorrectedClaimsCount)),
      researchUsedRuns.length
    ),
    averageSourceBackedClaims: averageByCount(
      sum(researchUsedRuns.map((result) => result.researchSourceBackedClaimsCount)),
      researchUsedRuns.length
    ),
    gainDistribution,
    decisionDistribution,
    categoryStats,
    bestRuns,
    worstRuns,
    interpretation: {
      strengths: [],
      weakSpots: [],
      costNotes: [],
      routingNotes: []
    }
  };

  return {
    ...summary,
    interpretation: buildInterpretation(summary)
  };
}

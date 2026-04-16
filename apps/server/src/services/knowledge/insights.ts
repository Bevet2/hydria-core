import type { BenchmarkPromptResult, BenchmarkRun } from "../../types/benchmark.js";
import type { QuestionCategory } from "../../types/arena.js";
import type {
  KnowledgeCategoryInsight,
  KnowledgeCategoryStrategy,
  KnowledgePattern
} from "../../types/knowledge.js";
import type { RoundDatasetEntry } from "../../types/roundDataset.js";
import {
  average,
  clampInt,
  defaultStrategies,
  median,
  negativePatternDefinitions,
  normalizeText,
  percentage,
  positivePatternDefinitions,
  uniqueStrings,
  type PatternDefinition,
  type SideSample
} from "./common.js";

export function buildCategoryInsight(
  category: QuestionCategory,
  benchmarkRuns: BenchmarkRun[],
  roundDatasetEntries: RoundDatasetEntry[]
): KnowledgeCategoryInsight {
  const defaultStrategy = defaultStrategies[category];
  const coreResults = benchmarkRuns
    .filter((run) => run.status === "completed" && run.benchmarkId !== "tool-benchmark-v1")
    .flatMap((run) => run.results)
    .filter((result) => result.status === "completed" && result.detectedCategory === category);
  const toolResults = benchmarkRuns
    .filter((run) => run.status === "completed" && run.benchmarkId === "tool-benchmark-v1")
    .flatMap((run) => run.results)
    .filter((result) => result.status === "completed" && result.detectedCategory === category);
  const categoryRounds = roundDatasetEntries.filter((entry) => entry.category === category);
  const benchmark = buildCategoryBenchmarkSnapshot(coreResults, categoryRounds);
  const winningPatterns = extractPatterns({
    definitions: positivePatternDefinitions,
    rounds: categoryRounds.filter((entry) => isWinningRound(entry)),
    polarity: "positive"
  });
  const losingPatterns = extractPatterns({
    definitions: negativePatternDefinitions,
    rounds: categoryRounds.filter((entry) => isLosingRound(entry)),
    polarity: "negative"
  });
  const strategy = deriveStrategy({
    category,
    benchmark,
    toolResults,
    rounds: categoryRounds,
    winningPatterns,
    losingPatterns,
    defaultStrategy
  });
  const references = [...categoryRounds].sort(
    (left, right) => right.metrics.refineGain.global - left.metrics.refineGain.global
  );

  return {
    category,
    benchmark,
    winningPatterns,
    losingPatterns,
    bestRounds: references.slice(0, 3).map((entry) => ({
      roundId: entry.roundId,
      prompt: entry.question,
      gain: entry.metrics.refineGain.global,
      note:
        entry.metrics.scoreExplanation[
          entry.studentSignals.preferredWinner === "B" ? "B" : "A"
        ]?.main_driver ?? "High-gain round worth reusing as an orchestration reference."
    })),
    worstRounds: [...references]
      .reverse()
      .slice(0, 3)
      .map((entry) => ({
        roundId: entry.roundId,
        prompt: entry.question,
        gain: entry.metrics.refineGain.global,
        note:
          entry.metrics.scoreExplanation.A.regressions[0] ??
          entry.metrics.scoreExplanation.B.regressions[0] ??
          "Low-gain round that exposes a weak orchestration pattern."
      })),
    strategy
  };
}

function buildCategoryBenchmarkSnapshot(
  results: BenchmarkPromptResult[],
  rounds: RoundDatasetEntry[]
): KnowledgeCategoryInsight["benchmark"] {
  const respondentSlotCount = results.reduce(
    (sum, result) => sum + result.respondentSlotCount,
    0
  );
  const respondentPrimarySuccessCount = results.reduce(
    (sum, result) => sum + result.respondentPrimarySuccessCount,
    0
  );
  const refineTraceCount = rounds.reduce(
    (sum, entry) =>
      sum +
      (entry.steps.refined.A.routerSkipped ? 0 : 1) +
      (entry.steps.refined.B.routerSkipped ? 0 : 1),
    0
  );
  const staticFallbackCount = rounds.reduce(
    (sum, entry) =>
      sum +
      (entry.traces.refineA?.outcome === "static_fallback" ? 1 : 0) +
      (entry.traces.refineB?.outcome === "static_fallback" ? 1 : 0),
    0
  );
  const researchUsedRounds = rounds.filter((entry) => entry.research.used);

  return {
    sampleSize: results.length,
    averageGain: average(results.map((result) => result.globalGain ?? 0)),
    medianGain: median(results.map((result) => result.globalGain ?? 0)),
    worthItRate: percentage(
      results.filter((result) => result.refineDecision === "YES").length,
      results.length
    ),
    degradingRate: percentage(
      results.filter((result) => result.degrading).length,
      results.length
    ),
    refineExecutionRate: percentage(
      results.reduce((sum, result) => sum + result.refineExecutedCount, 0),
      Math.max(1, results.length * 2)
    ),
    noOpRate: percentage(
      rounds.filter((entry) => entry.metrics.refineGain.global === 0).length,
      rounds.length
    ),
    staticFallbackRate: percentage(staticFallbackCount, Math.max(1, refineTraceCount)),
    researchUsageRate: percentage(
      results.filter((result) => result.researchUsed).length,
      results.length
    ),
    positiveResearchImpactRate: percentage(
      researchUsedRounds.filter((entry) => entry.research.impact.netImpact === "positive").length,
      researchUsedRounds.length
    ),
    respondentPrimarySuccessRate: percentage(respondentPrimarySuccessCount, respondentSlotCount)
  };
}

function deriveStrategy(args: {
  category: QuestionCategory;
  benchmark: KnowledgeCategoryInsight["benchmark"];
  toolResults: BenchmarkPromptResult[];
  rounds: RoundDatasetEntry[];
  winningPatterns: KnowledgePattern[];
  losingPatterns: KnowledgePattern[];
  defaultStrategy: KnowledgeCategoryStrategy;
}): KnowledgeCategoryStrategy {
  const sideSamples = extractSideSamples(args.rounds);
  const positiveSideSamples = sideSamples.filter((sample) => sample.useful);
  const weakSideSamples = sideSamples.filter((sample) => sample.weak);

  let routerBias = args.defaultStrategy.routerBias;
  if (args.benchmark.averageGain >= 14 && args.benchmark.worthItRate >= 80) {
    routerBias += 4;
  } else if (args.benchmark.averageGain >= 8 && args.benchmark.worthItRate >= 60) {
    routerBias += 2;
  } else if (args.benchmark.averageGain <= 2 || args.benchmark.worthItRate < 35) {
    routerBias -= 4;
  }
  if (args.benchmark.degradingRate >= 20) {
    routerBias -= 3;
  }

  const toolRecommendation = deriveToolRecommendation(
    args.category,
    args.toolResults,
    args.defaultStrategy.toolRecommendation
  );

  const refineWhen = {
    minRiskScore:
      positiveSideSamples.length >= 2
        ? clampInt(median(positiveSideSamples.map((sample) => sample.riskScore)) - 5, 25, 90)
        : args.defaultStrategy.refineWhen.minRiskScore,
    minDirectCritiques:
      positiveSideSamples.length >= 2
        ? clampInt(median(positiveSideSamples.map((sample) => sample.directCritiques)), 1, 5)
        : args.defaultStrategy.refineWhen.minDirectCritiques,
    minStructuralRiskCount:
      positiveSideSamples.length >= 2
        ? clampInt(
            median(positiveSideSamples.map((sample) => sample.structuralRiskCount)),
            1,
            15
          )
        : args.defaultStrategy.refineWhen.minStructuralRiskCount,
    maxQualityScore:
      positiveSideSamples.length >= 2
        ? clampInt(
            median(positiveSideSamples.map((sample) => sample.qualityScore)) + 8,
            40,
            90
          )
        : args.defaultStrategy.refineWhen.maxQualityScore
  };

  const skipWhen = {
    maxRiskScore:
      weakSideSamples.length >= 2
        ? clampInt(median(weakSideSamples.map((sample) => sample.riskScore)) + 4, 15, 70)
        : args.defaultStrategy.skipWhen.maxRiskScore,
    minQualityScore:
      weakSideSamples.length >= 2
        ? clampInt(median(weakSideSamples.map((sample) => sample.qualityScore)) + 6, 55, 95)
        : args.defaultStrategy.skipWhen.minQualityScore,
    maxDirectCritiques:
      weakSideSamples.length >= 2
        ? clampInt(median(weakSideSamples.map((sample) => sample.directCritiques)), 0, 4)
        : args.defaultStrategy.skipWhen.maxDirectCritiques,
    maxStructuralRiskCount:
      weakSideSamples.length >= 2
        ? clampInt(median(weakSideSamples.map((sample) => sample.structuralRiskCount)), 0, 12)
        : args.defaultStrategy.skipWhen.maxStructuralRiskCount
  };

  const highValueSignals = uniqueStrings([
    ...args.defaultStrategy.highValueSignals,
    ...args.winningPatterns.slice(0, 3).map((pattern) => pattern.text)
  ]).slice(0, 8);
  const lowValueSignals = uniqueStrings([
    ...args.defaultStrategy.lowValueSignals,
    ...args.losingPatterns.slice(0, 3).map((pattern) => pattern.text)
  ]).slice(0, 8);

  const noteParts = [
    args.defaultStrategy.note,
    args.benchmark.sampleSize > 0
      ? `Observed avg gain ${args.benchmark.averageGain} with worth-it ${args.benchmark.worthItRate}%.`
      : "Data is sparse; fall back to category priors.",
    args.benchmark.noOpRate > 0
      ? `No-op rate ${args.benchmark.noOpRate}% and static refine fallback ${args.benchmark.staticFallbackRate}%.`
      : null,
    args.benchmark.researchUsageRate > 0
      ? `Research used on ${args.benchmark.researchUsageRate}% of stored rounds with positive impact ${args.benchmark.positiveResearchImpactRate}%.`
      : null,
    args.winningPatterns[0]?.text ? `Winning pattern: ${args.winningPatterns[0].text}` : null,
    args.losingPatterns[0]?.text ? `Recurring failure: ${args.losingPatterns[0].text}` : null
  ].filter(Boolean);

  return {
    routingRecommendation:
      args.benchmark.sampleSize >= 3
        ? args.defaultStrategy.routingRecommendation === "insufficient_data"
          ? "selective"
          : args.defaultStrategy.routingRecommendation
        : args.defaultStrategy.routingRecommendation,
    routerBias: clampInt(routerBias, -30, 30),
    toolRecommendation,
    refineWhen,
    skipWhen,
    highValueSignals,
    lowValueSignals,
    note: noteParts.join(" ")
  };
}

function deriveToolRecommendation(
  category: QuestionCategory,
  toolResults: BenchmarkPromptResult[],
  fallback: KnowledgeCategoryStrategy["toolRecommendation"]
): KnowledgeCategoryStrategy["toolRecommendation"] {
  if (toolResults.length === 0) {
    return fallback;
  }

  const usageRate = percentage(
    toolResults.filter((result) => result.researchUsed).length,
    toolResults.length
  );
  const usedResults = toolResults.filter((result) => result.researchUsed);
  const positiveRate = percentage(
    usedResults.filter((result) => result.researchNetImpact === "positive").length,
    usedResults.length
  );
  const avgGainWhenUsed = average(usedResults.map((result) => result.globalGain ?? 0));
  const avgGainWhenUnused = average(
    toolResults.filter((result) => !result.researchUsed).map((result) => result.globalGain ?? 0)
  );

  if (
    category === "technical_explanation" &&
    usageRate >= 20 &&
    avgGainWhenUsed >= avgGainWhenUnused
  ) {
    return "prefer_grounded";
  }

  if (usageRate === 0) {
    return fallback;
  }

  if (avgGainWhenUsed >= avgGainWhenUnused + 2 && positiveRate >= 40) {
    return "prefer_grounded";
  }

  if (positiveRate >= 20) {
    return "verify_only";
  }

  return fallback === "prefer_grounded" ? "verify_only" : fallback;
}

function extractSideSamples(rounds: RoundDatasetEntry[]): SideSample[] {
  return rounds.flatMap((entry) => {
    const slots: Array<"A" | "B"> = ["A", "B"];
    return slots.map((slot) => {
      const verdict = slot === "A" ? entry.verdicts.refineA : entry.verdicts.refineB;
      const refined = entry.steps.refined[slot];
      const signal = entry.router.sideSignals[slot];
      const gain = entry.metrics.refineGain[slot];
      const executed = refined.routerSkipped !== true;
      const useful =
        executed &&
        gain >= 5 &&
        verdict !== "degrading" &&
        verdict !== "fallback_preserved";
      const weak =
        !executed ||
        gain <= 0 ||
        verdict === "degrading" ||
        verdict === "fallback_preserved";

      return {
        slot,
        gain,
        qualityScore: signal.qualityScore,
        riskScore: signal.riskScore,
        directCritiques: signal.directCritiques,
        structuralRiskCount: signal.structuralRiskCount,
        executed,
        useful,
        weak
      };
    });
  });
}

function extractPatterns(args: {
  definitions: PatternDefinition[];
  rounds: RoundDatasetEntry[];
  polarity: "positive" | "negative";
}): KnowledgePattern[] {
  const patternMap = new Map<string, { count: number; exampleRoundIds: string[] }>();

  for (const round of args.rounds) {
    const texts =
      args.polarity === "positive"
        ? [
            ...round.metrics.scoreExplanation.A.improvements,
            ...round.metrics.scoreExplanation.B.improvements,
            ...round.steps.refined.A.fixes_applied,
            ...round.steps.refined.B.fixes_applied,
            ...round.steps.synthesizer.improvements_added,
            ...round.studentSignals.learningNotes
          ]
        : [
            ...round.metrics.scoreExplanation.A.regressions,
            ...round.metrics.scoreExplanation.B.regressions,
            ...round.steps.redTeam.shared_risks,
            ...round.steps.redTeam.failure_scenarios,
            ...round.steps.redTeam.hidden_assumptions,
            ...round.steps.refined.A.remaining_uncertainties,
            ...round.steps.refined.B.remaining_uncertainties
          ];

    const matchedLabels = new Set<string>();
    for (const text of texts) {
      const normalized = normalizeText(text);
      if (!normalized) {
        continue;
      }

      for (const definition of args.definitions) {
        if (definition.matchers.some((matcher) => matcher.test(normalized))) {
          matchedLabels.add(definition.label);
        }
      }
    }

    for (const label of matchedLabels) {
      const current = patternMap.get(label) ?? { count: 0, exampleRoundIds: [] };
      current.count += 1;
      if (current.exampleRoundIds.length < 5) {
        current.exampleRoundIds.push(round.roundId);
      }
      patternMap.set(label, current);
    }
  }

  return [...patternMap.entries()]
    .map(([text, details]) => ({
      text,
      count: details.count,
      exampleRoundIds: details.exampleRoundIds
    }))
    .sort((left, right) => right.count - left.count || left.text.localeCompare(right.text))
    .slice(0, 10);
}

function isWinningRound(entry: RoundDatasetEntry) {
  return (
    entry.metrics.refineGain.global > 0 &&
    entry.refineDecision.global === "YES" &&
    entry.verdicts.refineA !== "degrading" &&
    entry.verdicts.refineB !== "degrading"
  );
}

function isLosingRound(entry: RoundDatasetEntry) {
  return (
    entry.metrics.refineGain.global <= 0 ||
    entry.refineDecision.global === "NO" ||
    entry.verdicts.refineA === "degrading" ||
    entry.verdicts.refineB === "degrading"
  );
}

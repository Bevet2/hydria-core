import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { BenchmarkRunListItem, BenchmarkSummaryResponse } from "../lib/api.js";
import { BenchmarkDashboard } from "../components/BenchmarkDashboard.js";
import { BenchmarkRunsPanel } from "../components/BenchmarkRunsPanel.js";

function buildPromptResult(question: string) {
  return {
    promptId: "prompt-1",
    category: "mixed_reasoning",
    question,
    status: "completed",
    roundId: "33333333-3333-4333-8333-333333333333",
    globalGain: 12,
    gainClassification: "moderate",
    refineDecision: "YES",
    totalMs: 950,
    refineSharePct: 35,
    fallbackUsed: false,
    winner: "A",
    detectedCategory: "mixed_reasoning",
    routerStrategy: "refine_selective",
    refineExecutedCount: 1,
    refineSkippedCount: 1,
    refineExecutedGainTotal: 12,
    refineSkippedGainTotal: 0,
    respondentSlotCount: 2,
    respondentPrimarySuccessCount: 2,
    respondentRetrySuccessCount: 0,
    respondentFallbackSuccessCount: 0,
    respondentFinalFailureCount: 0,
    respondentRetryCount: 0,
    respondentFallbackCount: 0,
    respondentValidationFailureCount: 0,
    respondentLatencyTotalMs: 220,
    researchConsidered: true,
    researchUsed: true,
    researchRoute: "used",
    researchDecisionMode: "targeted_verify",
    researchExpectedValue: "high",
    researchTriggerCount: 1,
    researchTargetClaimsCount: 1,
    researchSourceCount: 2,
    researchDurationMs: 180,
    researchChangedRefine: true,
    researchCorrectedClaimsCount: 1,
    researchSourceBackedClaimsCount: 2,
    researchCostSharePct: 18,
    researchNetImpact: "positive",
    degrading: false,
    createdAt: "2026-04-18T10:00:00.000Z"
  } as const;
}

function buildSummary(): NonNullable<BenchmarkSummaryResponse["summary"]> {
  const prompt = buildPromptResult(
    "Which current CEO decision most changed the company strategy?"
  );

  return {
    totalRuns: 1,
    successfulRuns: 1,
    failedRuns: 0,
    averageGlobalGain: 12,
    medianGlobalGain: 12,
    worthItRate: 100,
    fallbackRate: 0,
    averageTotalLatency: 950,
    averageRefineLatencyShare: 35,
    refineExecutionRate: 50,
    refineSkipRate: 50,
    averageGainWhenRefined: 12,
    averageGainWhenSkipped: 0,
    averageLatencyWithRefine: 950,
    averageLatencyWithoutRefine: 400,
    respondentStability: {
      slotCount: 2,
      primarySuccessRate: 100,
      retrySuccessRate: 0,
      fallbackSuccessRate: 0,
      finalFailureRate: 0,
      respondentRetryRate: 0,
      respondentFallbackRate: 0,
      respondentValidationFailureRate: 0,
      averageRespondentLatency: 110
    },
    researchConsideredRate: 100,
    researchUsageRate: 100,
    researchFailureRate: 0,
    averageResearchLatency: 180,
    averageResearchSourceCount: 2,
    averageGainWhenResearchUsed: 12,
    averageGainWhenResearchUnused: 0,
    researchRouteDistribution: {
      not_needed: 0,
      used: 1,
      failed: 0
    },
    researchModeDistribution: {
      off: 0,
      targeted_verify: 1,
      constraint_check: 0,
      fact_check_only: 0,
      verify_factual_subpart: 0
    },
    researchNetImpactDistribution: {
      positive: 1,
      neutral: 0,
      negative: 0,
      unknown: 0
    },
    averageResearchCostShare: 18,
    refineChangedByToolRate: 100,
    positiveResearchImpactRate: 100,
    negativeResearchImpactRate: 0,
    averageCorrectedClaims: 1,
    averageSourceBackedClaims: 2,
    gainDistribution: {
      strong: 0,
      moderate: 1,
      weak: 0,
      negligible: 0,
      degrading: 0
    },
    decisionDistribution: {
      YES: 1,
      NO: 0
    },
    categoryStats: [
      {
        category: "mixed_reasoning",
        runs: 1,
        averageGain: 12,
        medianGain: 12,
        degradingRate: 0,
        worthItRate: 100,
        fallbackRate: 0,
        averageLatency: 950,
        refineExecutionRate: 50,
        averageGainWhenRefined: 12,
        averageGainWhenSkipped: 0,
        averageLatencyWithRefine: 950,
        averageLatencyWithoutRefine: 400,
        respondentRetryRate: 0,
        respondentFallbackRate: 0,
        respondentValidationFailureRate: 0,
        averageRespondentLatency: 110,
        researchConsideredRate: 100,
        researchUsageRate: 100,
        researchFailureRate: 0,
        averageResearchLatency: 180,
        averageResearchSourceCount: 2,
        averageGainWhenResearchUsed: 12,
        averageGainWhenResearchUnused: 0,
        averageResearchCostShare: 18,
        refineChangedByToolRate: 100,
        positiveResearchImpactRate: 100,
        negativeResearchImpactRate: 0,
        averageCorrectedClaims: 1,
        averageSourceBackedClaims: 2,
        routingRecommendation: "prefer_refine"
      }
    ],
    bestRuns: [prompt],
    worstRuns: [prompt],
    interpretation: {
      strengths: ["Grounded prompts improve strongly."],
      weakSpots: ["Very little benchmark breadth yet."],
      costNotes: ["Research cost stays contained."],
      routingNotes: ["Selective refine works well here."]
    }
  };
}

function buildRunListItem(): BenchmarkRunListItem {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    benchmarkId: "tool-benchmark-v1",
    benchmarkName: "Hydria Tool Benchmark",
    status: "completed",
    createdAt: "2026-04-18T10:00:00.000Z",
    startedAt: "2026-04-18T10:00:00.000Z",
    completedAt: "2026-04-18T10:02:00.000Z",
    lastUpdatedAt: "2026-04-18T10:02:00.000Z",
    totalPrompts: 1,
    completedPrompts: 1,
    failedPrompts: 0,
    summary: buildSummary()
  } as BenchmarkRunListItem;
}

test("benchmark dashboard renders tool sections and prompt lists", () => {
  const summary = buildSummary();
  const html = renderToStaticMarkup(
    <BenchmarkDashboard
      mode="tool"
      summary={summary}
      currentRun={{
        id: "55555555-5555-4555-8555-555555555555",
        status: "completed"
      } as never}
    />
  );

  assert.match(html, /Overview/);
  assert.match(html, /Tool Usage/);
  assert.match(html, /Best Tool-Aided Prompts/);
  assert.match(html, /Automatic Interpretation/);
  assert.match(html, /Which current CEO decision most changed the company strategy\?/);
});

test("benchmark runs panel renders stored runs and active selection", () => {
  const html = renderToStaticMarkup(
    <BenchmarkRunsPanel
      runs={[buildRunListItem()]}
      selectedRunId="44444444-4444-4444-8444-444444444444"
      mode="tool"
      onSelectRun={() => undefined}
    />
  );

  assert.match(html, /Benchmark Runs/);
  assert.match(html, /Hydria Tool Benchmark/);
  assert.match(html, /history-item--active/);
  assert.match(html, /Tool used 100%/);
});

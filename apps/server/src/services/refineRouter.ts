import { readFile } from "node:fs/promises";
import {
  type OrchestrationPolicyDetails,
  type QuestionCategory,
  type RedTeamOutput,
  type RefineRouterDecisionDetails,
  type RespondentOutput,
  type RouterCategoryBenchmarkInsight,
  type RouterEstimatedValue,
  type RouterSideSignal,
  type RoutingRecommendation
} from "../types/arena.js";
import type { KnowledgeCategoryInsight, KnowledgeCategoryStrategy } from "../types/knowledge.js";
import { env } from "../utils/env.js";
import { classifyQuestion } from "./questionClassifier.js";
import { KnowledgeLayerService } from "./knowledgeLayerService.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";

type RefineRouterContext = {
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
};

type HistoricalPromptResult = {
  status?: unknown;
  category?: unknown;
  globalGain?: unknown;
  refineDecision?: unknown;
  refineExecutedCount?: unknown;
  refineExecutedGainTotal?: unknown;
  fallbackUsed?: unknown;
};

const staticRoutingRecommendations: Record<QuestionCategory, RoutingRecommendation> = {
  incident_response: "selective",
  architecture_design: "selective",
  technical_explanation: "selective",
  debug_diagnostic: "prefer_skip",
  product_strategy: "selective",
  operational_writing: "prefer_refine",
  mixed_reasoning: "selective",
  other: "insufficient_data"
};

const categoryBias: Record<QuestionCategory, number> = {
  incident_response: 10,
  architecture_design: 4,
  technical_explanation: 6,
  debug_diagnostic: -12,
  product_strategy: 2,
  operational_writing: 18,
  mixed_reasoning: 10,
  other: 0
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getStaticRoutingRecommendation(category: QuestionCategory): RoutingRecommendation {
  return staticRoutingRecommendations[category];
}

function deriveRoutingRecommendation(args: {
  category: QuestionCategory;
  sampleSize: number;
  executedSampleSize: number;
  averageGain: number;
  averageGainWhenRefined: number;
  worthItRate: number;
  refineExecutionRate: number;
  fallbackRate: number;
}): RoutingRecommendation {
  if (args.sampleSize < 3 || args.executedSampleSize < 2) {
    return getStaticRoutingRecommendation(args.category);
  }

  if (
    args.executedSampleSize >= 4 &&
    args.averageGainWhenRefined <= -2 &&
    args.worthItRate < 20
  ) {
    return "prefer_skip";
  }

  if (
    args.averageGainWhenRefined >= 8 &&
    args.worthItRate >= 50 &&
    args.refineExecutionRate >= 20
  ) {
    return "prefer_refine";
  }

  if (
    args.executedSampleSize >= 3 &&
    args.averageGainWhenRefined <= 1 &&
    args.averageGain <= 0 &&
    args.worthItRate < 25 &&
    args.refineExecutionRate >= 35
  ) {
    return "prefer_skip";
  }

  return "selective";
}

function normalizeHistoricalResults(raw: unknown): HistoricalPromptResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((entry) => typeof entry === "object" && entry !== null) as HistoricalPromptResult[];
}

export function buildLegacyRouterDecision(question: string): RefineRouterDecisionDetails {
  const category = classifyQuestion(question);
  return {
    category,
    shouldRefineA: true,
    shouldRefineB: true,
    globalStrategy: "refine_all",
    reasoning: ["Legacy round stored before refine routing was introduced."],
    estimatedValue: {
      A: "medium",
      B: "medium"
    },
    benchmarkInsight: {
      sampleSize: 0,
      averageGain: 0,
      worthItRate: 0,
      fallbackRate: 0,
      noOpRate: 0,
      staticFallbackRate: 0,
      positiveResearchImpactRate: 0,
      routingRecommendation: getStaticRoutingRecommendation(category)
    },
    sideSignals: {
      A: {
        riskScore: 50,
        qualityScore: 50,
        answerWordCount: 0,
        directCritiques: 0,
        structuralRiskCount: 0
      },
      B: {
        riskScore: 50,
        qualityScore: 50,
        answerWordCount: 0,
        directCritiques: 0,
        structuralRiskCount: 0
      }
    }
  };
}

export class RefineRouterService {
  private readonly knowledgeLayerService: KnowledgeLayerService;
  private readonly knowledgeMemoryService: KnowledgeMemoryService;

  constructor(private readonly benchmarkRunsFile = env.BENCHMARK_RUNS_FILE) {
    this.knowledgeLayerService = new KnowledgeLayerService();
    this.knowledgeMemoryService = new KnowledgeMemoryService();
  }

  async decide(
    context: RefineRouterContext,
    orchestration: OrchestrationPolicyDetails | null = null
  ): Promise<RefineRouterDecisionDetails> {
    const category = classifyQuestion(context.question);
    const benchmarkInsight = await this.loadBenchmarkInsight(category);
    const knowledgeInsight = await this.loadKnowledgeInsight(category);
    const globalSignals = uniqueStrings([
      context.redTeam.factual_risk_level >= 70 ? "high_factual_risk" : "",
      context.redTeam.factual_risk_level >= 55 ? "medium_factual_risk" : "",
      context.redTeam.reasoning_risk_level >= 70 ? "high_reasoning_risk" : "",
      context.redTeam.potentially_false_claims.length > 0 ? "factual_claims" : "",
      (context.redTeam.attacks_on_a.length + context.redTeam.attacks_on_b.length) >= 3
        ? "direct_critiques"
        : "",
      (context.redTeam.shared_risks.length +
        context.redTeam.failure_scenarios.length +
        context.redTeam.hidden_assumptions.length) >= 5
        ? "structural_risk"
        : "",
      (knowledgeInsight?.benchmark.noOpRate ?? 0) >= 35 ? "no_op_high" : "",
      (knowledgeInsight?.benchmark.staticFallbackRate ?? 0) >= 15 ? "static_fallback_high" : "",
      (knowledgeInsight?.benchmark.worthItRate ?? 0) >= 55 ? "positive_refine_roi" : "",
      (knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0) >= 35
        ? "positive_tool_roi"
        : ""
    ]);
    const memoryRules = await this.knowledgeMemoryService.getRelevantRules({
      category,
      activeSignals: globalSignals,
      domains: ["routing", "refine"],
      limit: 4,
      query: context.question
    });
    const memoryBias = memoryRules.reduce(
      (sum, rule) =>
        sum +
        Math.round((rule.influence.routingBias + rule.influence.refineBias) * rule.confidence),
      0
    );
    const sideA = this.evaluateSide({
      slot: "A",
      category,
      respondent: context.respondentA,
      redTeam: context.redTeam,
      benchmarkInsight,
      knowledgeInsight,
      knowledgeStrategy: knowledgeInsight?.strategy ?? null,
      orchestration,
      memoryBias
    });
    const sideB = this.evaluateSide({
      slot: "B",
      category,
      respondent: context.respondentB,
      redTeam: context.redTeam,
      benchmarkInsight,
      knowledgeInsight,
      knowledgeStrategy: knowledgeInsight?.strategy ?? null,
      orchestration,
      memoryBias
    });

    const globalStrategy =
      sideA.shouldRefine && sideB.shouldRefine
        ? "refine_all"
        : sideA.shouldRefine || sideB.shouldRefine
          ? "refine_selective"
          : "skip_refine";

    const reasoning: string[] = [
      `Question classified as ${category}.`,
      benchmarkInsight.sampleSize >= 3
        ? `Benchmark signal for ${category}: ${benchmarkInsight.routingRecommendation} (avg gain ${benchmarkInsight.averageGain}, worth-it ${benchmarkInsight.worthItRate}%, fallback ${benchmarkInsight.fallbackRate}% across ${benchmarkInsight.sampleSize} runs).`
        : `Benchmark signal is sparse for ${category}; using static prior ${benchmarkInsight.routingRecommendation}.`,
      knowledgeInsight
        ? `Knowledge layer bias for ${category}: ${knowledgeInsight.strategy.routingRecommendation}, router bias ${knowledgeInsight.strategy.routerBias}. ${knowledgeInsight.strategy.note}`
        : "Knowledge layer not available yet; router is using benchmark signal plus category priors only.",
      knowledgeInsight
        ? `Knowledge signals: no-op ${knowledgeInsight.benchmark.noOpRate}%, static refine fallback ${knowledgeInsight.benchmark.staticFallbackRate}%, positive research impact ${knowledgeInsight.benchmark.positiveResearchImpactRate}%.`
        : "Knowledge benchmark signals unavailable.",
      ...memoryRules.map(
        (rule) =>
          `Knowledge memory ${rule.domain}: ${rule.lesson} Strategy: ${rule.recommendedStrategy} (confidence ${Math.round(rule.confidence * 100)}%).`
      ),
      orchestration
        ? `Orchestration focus ${orchestration.focus}: refine ${orchestration.refinePolicy}, research ${orchestration.researchPolicy}, cost ${orchestration.costPolicy}.`
        : "No orchestration policy was available for this round.",
      `A: quality ${sideA.signal.qualityScore}, risk ${sideA.signal.riskScore}, estimated value ${sideA.estimatedValue} -> ${sideA.shouldRefine ? "refine" : "skip"}.`,
      `B: quality ${sideB.signal.qualityScore}, risk ${sideB.signal.riskScore}, estimated value ${sideB.estimatedValue} -> ${sideB.shouldRefine ? "refine" : "skip"}.`,
      globalStrategy === "skip_refine"
        ? "Global strategy skip_refine: both responses look low-risk or low-ROI for refinement."
        : globalStrategy === "refine_selective"
          ? "Global strategy refine_selective: refine only the side with meaningful expected value."
          : "Global strategy refine_all: both answers show enough risk or expected upside."
    ];

    return {
      category,
      shouldRefineA: sideA.shouldRefine,
      shouldRefineB: sideB.shouldRefine,
      globalStrategy,
      reasoning,
      estimatedValue: {
        A: sideA.estimatedValue,
        B: sideB.estimatedValue
      },
      benchmarkInsight,
      sideSignals: {
        A: sideA.signal,
        B: sideB.signal
      }
    };
  }

  private async loadBenchmarkInsight(
    category: QuestionCategory
  ): Promise<RouterCategoryBenchmarkInsight> {
    if (category === "other") {
      return {
        sampleSize: 0,
        averageGain: 0,
        worthItRate: 0,
        fallbackRate: 0,
        noOpRate: 0,
        staticFallbackRate: 0,
        positiveResearchImpactRate: 0,
        routingRecommendation: "insufficient_data"
      };
    }

    try {
      const raw = await readFile(this.benchmarkRunsFile, "utf8");
      const parsed = JSON.parse(raw) as { runs?: Array<{ status?: unknown; results?: unknown }> };
      const categoryResults = (parsed.runs ?? [])
        .filter((run) => run?.status === "completed")
        .flatMap((run) => normalizeHistoricalResults(run.results))
        .filter(
          (result) =>
            result.status === "completed" &&
            result.category === category &&
            typeof result.globalGain === "number"
        );

      const gains = categoryResults
        .map((result) => result.globalGain)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const executedResults = categoryResults.filter(
        (result) =>
          typeof result.refineExecutedCount === "number" &&
          Number.isFinite(result.refineExecutedCount) &&
          result.refineExecutedCount > 0
      );
      const yesCount = executedResults.filter((result) => result.refineDecision === "YES").length;
      const fallbackCount = categoryResults.filter((result) => result.fallbackUsed === true).length;
      const sampleSize = categoryResults.length;
      const executedSampleSize = executedResults.length;
      const averageGain = average(gains);
      const totalExecutedCount = executedResults.reduce((sum, result) => {
        return (
          sum +
          (typeof result.refineExecutedCount === "number" &&
          Number.isFinite(result.refineExecutedCount)
            ? result.refineExecutedCount
            : 0)
        );
      }, 0);
      const totalExecutedGain = executedResults.reduce((sum, result) => {
        return (
          sum +
          (typeof result.refineExecutedGainTotal === "number" &&
          Number.isFinite(result.refineExecutedGainTotal)
            ? result.refineExecutedGainTotal
            : 0)
        );
      }, 0);
      const averageGainWhenRefined =
        totalExecutedCount > 0 ? roundToOneDecimal(totalExecutedGain / totalExecutedCount) : 0;
      const worthItRate =
        executedSampleSize > 0 ? roundToOneDecimal((yesCount / executedSampleSize) * 100) : 0;
      const refineExecutionRate =
        sampleSize > 0
          ? roundToOneDecimal((totalExecutedCount / Math.max(1, sampleSize * 2)) * 100)
          : 0;
      const fallbackRate =
        sampleSize > 0 ? roundToOneDecimal((fallbackCount / sampleSize) * 100) : 0;

      return {
        sampleSize,
        averageGain,
        worthItRate,
        fallbackRate,
        noOpRate: 0,
        staticFallbackRate: 0,
        positiveResearchImpactRate: 0,
        routingRecommendation: deriveRoutingRecommendation({
          category,
          sampleSize,
          executedSampleSize,
          averageGain,
          averageGainWhenRefined,
          worthItRate,
          refineExecutionRate,
          fallbackRate
        })
      };
    } catch {
      return {
        sampleSize: 0,
        averageGain: 0,
        worthItRate: 0,
        fallbackRate: 0,
        noOpRate: 0,
        staticFallbackRate: 0,
        positiveResearchImpactRate: 0,
        routingRecommendation: getStaticRoutingRecommendation(category)
      };
    }
  }

  private async loadKnowledgeInsight(
    category: QuestionCategory
  ): Promise<KnowledgeCategoryInsight | null> {
    if (category === "other") {
      return null;
    }

    const knowledgeLayer = await this.knowledgeLayerService.loadKnowledgeLayer();
    return knowledgeLayer?.categories.find((entry) => entry.category === category) ?? null;
  }

  private evaluateSide(args: {
    slot: "A" | "B";
    category: QuestionCategory;
    respondent: RespondentOutput;
    redTeam: RedTeamOutput;
    benchmarkInsight: RouterCategoryBenchmarkInsight;
    knowledgeInsight: KnowledgeCategoryInsight | null;
    knowledgeStrategy: KnowledgeCategoryStrategy | null;
    orchestration: OrchestrationPolicyDetails | null;
    memoryBias: number;
  }) {
    const directCritiques =
      args.slot === "A" ? args.redTeam.attacks_on_a.length : args.redTeam.attacks_on_b.length;
    const structuralRiskCount =
      args.redTeam.shared_risks.length +
      args.redTeam.failure_scenarios.length +
      args.redTeam.hidden_assumptions.length +
      args.redTeam.potentially_false_claims.length;
    const answerWordCount = countWords(args.respondent.answer);
    const averageRisk =
      (args.redTeam.factual_risk_level + args.redTeam.reasoning_risk_level) / 2;

    const riskScore = clamp(
      Math.round(
        averageRisk * 0.55 +
          directCritiques * 8 +
          Math.min(20, structuralRiskCount * 3) +
          (args.redTeam.winner_so_far !== "tie" && args.redTeam.winner_so_far !== args.slot ? 6 : 0)
      ),
      0,
      100
    );

    const lengthScore =
      answerWordCount < 60 ? 4 : answerWordCount < 120 ? 9 : answerWordCount <= 280 ? 15 : 11;
    const keyPointScore = Math.min(15, args.respondent.key_points.length * 4);
    const assumptionScore =
      args.respondent.assumptions.length > 0
        ? Math.min(12, args.respondent.assumptions.length * 4)
        : -8;
    const confidenceScore =
      args.respondent.confidence >= 55 && args.respondent.confidence <= 85
        ? 10
        : args.respondent.confidence > 85
          ? 6
          : 3;
    const qualityScore = clamp(
      Math.round(
        40 +
          lengthScore +
          keyPointScore +
          assumptionScore +
          confidenceScore -
          riskScore * 0.25 -
          directCritiques * 3
      ),
      0,
      100
    );
    const noOpRate = args.knowledgeInsight?.benchmark.noOpRate ?? 0;
    const staticFallbackRate = args.knowledgeInsight?.benchmark.staticFallbackRate ?? 0;
    const positiveResearchImpactRate =
      args.knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0;

    let expectedValueScore =
      42 +
      categoryBias[args.category] +
      this.getBenchmarkBias(args.benchmarkInsight.routingRecommendation) +
      (args.knowledgeStrategy?.routerBias ?? 0) +
      args.memoryBias +
      (args.orchestration?.refineBias ?? 0) +
      Math.round((riskScore - 50) / 2) +
      Math.round((60 - qualityScore) / 2);

    if (directCritiques >= 3) {
      expectedValueScore += 8;
    }
    if (structuralRiskCount >= 5) {
      expectedValueScore += 8;
    }
    if (args.respondent.confidence >= 88 && riskScore >= 55) {
      expectedValueScore += 6;
    }
    if (args.category === "operational_writing" && riskScore >= 50) {
      expectedValueScore += 10;
    }
    if (qualityScore >= 82 && riskScore <= 30) {
      expectedValueScore -= 18;
    }
    if (answerWordCount < 100 && riskScore < 40) {
      expectedValueScore -= 6;
    }
    if (args.category === "debug_diagnostic" && riskScore < 65) {
      expectedValueScore -= 10;
    }
    if (args.category === "product_strategy" && riskScore < 40 && qualityScore >= 70) {
      expectedValueScore -= 6;
    }
    if (args.category === "product_strategy" && directCritiques >= 2) {
      expectedValueScore += 8;
    }
    if (args.category === "product_strategy" && qualityScore <= 58) {
      expectedValueScore += 10;
    }
    if (noOpRate >= 40) {
      expectedValueScore -= 10;
    } else if (noOpRate <= 12) {
      expectedValueScore += 3;
    }
    if (staticFallbackRate >= 20) {
      expectedValueScore -= 14;
    } else if (staticFallbackRate >= 10) {
      expectedValueScore -= 7;
    }
    if (
      positiveResearchImpactRate >= 35 &&
      args.orchestration?.researchPolicy !== "off" &&
      (args.orchestration?.focus === "factual_grounding" ||
        args.orchestration?.focus === "pedagogy_precision")
    ) {
      expectedValueScore += 4;
    }

    expectedValueScore = clamp(expectedValueScore, 0, 100);

    const estimatedValue: RouterEstimatedValue =
      expectedValueScore >= 72 ? "high" : expectedValueScore >= 52 ? "medium" : "low";
    const shouldRefine = this.shouldRefine({
      category: args.category,
      estimatedValue,
      expectedValueScore,
      qualityScore,
      riskScore,
      directCritiques,
      structuralRiskCount,
      benchmarkInsight: args.benchmarkInsight,
      knowledgeInsight: args.knowledgeInsight,
      knowledgeStrategy: args.knowledgeStrategy,
      orchestration: args.orchestration
    });

    const signal: RouterSideSignal = {
      riskScore,
      qualityScore,
      answerWordCount,
      directCritiques,
      structuralRiskCount
    };

    return {
      shouldRefine,
      estimatedValue,
      signal
    };
  }

  private getBenchmarkBias(recommendation: RoutingRecommendation) {
    switch (recommendation) {
      case "prefer_refine":
        return 10;
      case "selective":
        return 4;
      case "prefer_skip":
        return -6;
      case "insufficient_data":
      default:
        return 0;
    }
  }

  private shouldRefine(args: {
    category: QuestionCategory;
    estimatedValue: RouterEstimatedValue;
    expectedValueScore: number;
    qualityScore: number;
    riskScore: number;
    directCritiques: number;
    structuralRiskCount: number;
    benchmarkInsight: RouterCategoryBenchmarkInsight;
    knowledgeInsight: KnowledgeCategoryInsight | null;
    knowledgeStrategy: KnowledgeCategoryStrategy | null;
    orchestration: OrchestrationPolicyDetails | null;
  }) {
    const noOpRate = args.knowledgeInsight?.benchmark.noOpRate ?? 0;
    const staticFallbackRate = args.knowledgeInsight?.benchmark.staticFallbackRate ?? 0;
    const positiveResearchImpactRate =
      args.knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0;

    if (
      args.orchestration?.refinePolicy === "aggressive" &&
      (args.riskScore >= 48 || args.structuralRiskCount >= 5) &&
      args.directCritiques >= 1
    ) {
      return true;
    }

    if (
      args.orchestration?.refinePolicy === "conservative" &&
      args.qualityScore >= 74 &&
      args.riskScore <= 35 &&
      args.directCritiques <= 2 &&
      args.expectedValueScore < 78
    ) {
      return false;
    }

    if (
      args.orchestration?.costPolicy === "latency_guarded" &&
      args.expectedValueScore < 70 &&
      args.riskScore < 60 &&
      args.directCritiques < 4
    ) {
      return false;
    }

    if (
      args.orchestration?.costPolicy === "quality_first" &&
      args.riskScore >= 55 &&
      args.directCritiques >= 1
    ) {
      return true;
    }

    if (
      staticFallbackRate >= 25 &&
      args.expectedValueScore < 78 &&
      args.riskScore < 75 &&
      args.directCritiques < 4
    ) {
      return false;
    }

    if (
      noOpRate >= 45 &&
      args.expectedValueScore < 70 &&
      args.directCritiques < 3 &&
      args.structuralRiskCount < 5
    ) {
      return false;
    }

    if (
      args.knowledgeStrategy &&
      this.matchesKnowledgeSkip(args, args.knowledgeStrategy) &&
      args.expectedValueScore < 78
    ) {
      return false;
    }

    if (
      positiveResearchImpactRate >= 40 &&
      args.orchestration?.researchPolicy !== "off" &&
      args.expectedValueScore >= 60 &&
      args.riskScore >= 45
    ) {
      return true;
    }

    if (
      args.knowledgeStrategy &&
      this.matchesKnowledgeRefine(args, args.knowledgeStrategy)
    ) {
      return true;
    }

    if (args.category === "product_strategy") {
      if (args.qualityScore >= 82 && args.riskScore <= 25) {
        return false;
      }

      if (args.expectedValueScore >= 72) {
        return true;
      }

      if (
        args.riskScore >= 72 &&
        (args.qualityScore <= 62 || args.directCritiques >= 2 || args.structuralRiskCount >= 4)
      ) {
        return true;
      }

      if (
        args.benchmarkInsight.routingRecommendation === "prefer_skip" &&
        args.riskScore < 65 &&
        args.qualityScore >= 60
      ) {
        return false;
      }

      if (args.qualityScore >= 65 && args.riskScore <= 45) {
        return false;
      }

      if (args.estimatedValue === "high" && args.riskScore >= 60) {
        return true;
      }

      return (
        args.estimatedValue === "medium" &&
        (args.directCritiques >= 2 || args.structuralRiskCount >= 4)
      );
    }

    if (args.benchmarkInsight.routingRecommendation === "prefer_skip") {
      return (
        args.expectedValueScore >= 72 ||
        (args.riskScore >= 72 &&
          (args.qualityScore <= 58 ||
            args.directCritiques >= 2 ||
            args.structuralRiskCount >= 4))
      );
    }

    if (args.qualityScore >= 85 && args.riskScore <= 25) {
      return false;
    }

    if (args.expectedValueScore >= 68) {
      return true;
    }

    if (
      args.expectedValueScore >= 54 &&
      (args.riskScore >= 45 || args.directCritiques >= 2 || args.structuralRiskCount >= 4)
    ) {
      return true;
    }

    return args.estimatedValue === "high";
  }

  private matchesKnowledgeRefine(
    args: {
      riskScore: number;
      qualityScore: number;
      directCritiques: number;
      structuralRiskCount: number;
    },
    strategy: KnowledgeCategoryStrategy
  ) {
    const { refineWhen } = strategy;
    const riskPass =
      refineWhen.minRiskScore === null || args.riskScore >= refineWhen.minRiskScore;
    const critiquePass =
      refineWhen.minDirectCritiques === null ||
      args.directCritiques >= refineWhen.minDirectCritiques;
    const structuralPass =
      refineWhen.minStructuralRiskCount === null ||
      args.structuralRiskCount >= refineWhen.minStructuralRiskCount;
    const qualityPass =
      refineWhen.maxQualityScore === null ||
      args.qualityScore <= refineWhen.maxQualityScore;

    return riskPass && qualityPass && (critiquePass || structuralPass);
  }

  private matchesKnowledgeSkip(
    args: {
      riskScore: number;
      qualityScore: number;
      directCritiques: number;
      structuralRiskCount: number;
    },
    strategy: KnowledgeCategoryStrategy
  ) {
    const { skipWhen } = strategy;
    const riskPass = skipWhen.maxRiskScore === null || args.riskScore <= skipWhen.maxRiskScore;
    const qualityPass =
      skipWhen.minQualityScore === null || args.qualityScore >= skipWhen.minQualityScore;
    const critiquesPass =
      skipWhen.maxDirectCritiques === null ||
      args.directCritiques <= skipWhen.maxDirectCritiques;
    const structuralPass =
      skipWhen.maxStructuralRiskCount === null ||
      args.structuralRiskCount <= skipWhen.maxStructuralRiskCount;

    return riskPass && qualityPass && critiquesPass && structuralPass;
  }
}

export { getStaticRoutingRecommendation };

import type {
  OrchestrationCostPolicy,
  OrchestrationFocus,
  OrchestrationPolicyDetails,
  OrchestrationResearchPolicy,
  OrchestrationRefinePolicy,
  QuestionCategory,
  RedTeamOutput,
  RespondentOutput
} from "../types/arena.js";
import type { KnowledgeCategoryInsight } from "../types/knowledge.js";
import { classifyQuestion } from "./questionClassifier.js";
import { KnowledgeLayerService } from "./knowledgeLayerService.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";

type OrchestrationContext = {
  question: string;
  category?: QuestionCategory;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
};

const UNCERTAINTY_PATTERNS = [
  "assum",
  "depends",
  "uncertain",
  "without context",
  "if applicable",
  "not provided",
  "varies"
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function countUncertaintySignals(respondent: RespondentOutput) {
  const haystack = `${respondent.answer} ${respondent.assumptions.join(" ")}`.toLowerCase();
  return UNCERTAINTY_PATTERNS.reduce(
    (count, pattern) => count + (haystack.includes(pattern) ? 1 : 0),
    0
  );
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function getBaseFocus(category: QuestionCategory): OrchestrationFocus {
  switch (category) {
    case "incident_response":
      return "risk_containment";
    case "architecture_design":
      return "tradeoff_clarity";
    case "technical_explanation":
      return "pedagogy_precision";
    case "debug_diagnostic":
      return "diagnostic_caution";
    case "product_strategy":
      return "strategy_actionability";
    case "operational_writing":
      return "execution_clarity";
    case "mixed_reasoning":
      return "balanced_reasoning";
    case "other":
    default:
      return "general_quality";
  }
}

export function buildLegacyOrchestrationPolicy(question: string): OrchestrationPolicyDetails {
  const category = classifyQuestion(question);
  const focus = getBaseFocus(category);

  return {
    category,
    focus,
    refinePolicy: "balanced",
    researchPolicy: "off",
    costPolicy: "balanced",
    refineBias: 0,
    researchBias: -8,
    targetOutcomes: [`Preserve useful behavior for ${category} while improving robustness.`],
    prioritySignals: ["legacy_round"],
    reasoning: ["Legacy round stored before orchestration policy logging was introduced."]
  };
}

export class OrchestrationPolicyService {
  private readonly knowledgeLayerService = new KnowledgeLayerService();
  private readonly knowledgeMemoryService = new KnowledgeMemoryService();
  private knowledgeLayerPromise: Promise<Awaited<ReturnType<KnowledgeLayerService["loadKnowledgeLayer"]>>> | null =
    null;

  async planRound(context: OrchestrationContext): Promise<OrchestrationPolicyDetails> {
    const category = context.category ?? classifyQuestion(context.question);
    const knowledgeInsight = await this.loadKnowledgeInsight(category);
    const averageFactualRisk = context.redTeam.factual_risk_level;
    const averageReasoningRisk = context.redTeam.reasoning_risk_level;
    const structuralRiskCount =
      context.redTeam.shared_risks.length +
      context.redTeam.hidden_assumptions.length +
      context.redTeam.failure_scenarios.length;
    const falseClaimCount = context.redTeam.potentially_false_claims.length;
    const directCritiquePressure =
      context.redTeam.attacks_on_a.length + context.redTeam.attacks_on_b.length;
    const uncertaintySignals =
      countUncertaintySignals(context.respondentA) + countUncertaintySignals(context.respondentB);
    const averageAnswerLength = Math.round(
      (countWords(context.respondentA.answer) + countWords(context.respondentB.answer)) / 2
    );
    const combinedText =
      `${context.question} ${context.respondentA.answer} ${context.respondentB.answer} ` +
      `${context.redTeam.potentially_false_claims.join(" ")}`.toLowerCase();
    const providerOrStandardCue = matchesAny(combinedText, [
      /\baws\b/i,
      /\bazure\b/i,
      /\bgcp\b/i,
      /\bgoogle cloud\b/i,
      /\bcloudflare\b/i,
      /\bkafka\b/i,
      /\bnode\.?js\b/i,
      /\bexpress\b/i,
      /\bpostgres(?:ql)?\b/i,
      /\bredis\b/i,
      /\bkubernetes\b/i,
      /\bdocker\b/i,
      /\boauth\b/i,
      /\bjwt\b/i,
      /\bsaml\b/i,
      /\brfc\b/i,
      /\bnist\b/i,
      /\bgdpr\b/i,
      /\bhipaa\b/i,
      /\bpci\b/i,
      /\bsoc ?2\b/i
    ]);
    const metricCue = matchesAny(combinedText, [
      /\bmetric\b/i,
      /\bkpi\b/i,
      /\broi\b/i,
      /\badoption\b/i,
      /\bretention\b/i,
      /\bactivation\b/i,
      /\bconversion\b/i,
      /\bthroughput\b/i,
      /\blatency\b/i
    ]);
    const conceptCue = matchesAny(context.question.toLowerCase(), [
      /\bwhat is\b/i,
      /\bwhat are\b/i,
      /\bexplain\b/i,
      /\bhow does\b/i,
      /\bdifference between\b/i
    ]);
    const activeSignals = uniqueStrings([
      averageFactualRisk >= 70 ? "high_factual_risk" : "",
      averageFactualRisk >= 55 ? "medium_factual_risk" : "",
      averageReasoningRisk >= 70 ? "high_reasoning_risk" : "",
      falseClaimCount > 0 ? "factual_claims" : "",
      directCritiquePressure >= 3 ? "direct_critiques" : "",
      structuralRiskCount >= 5 ? "structural_risk" : "",
      providerOrStandardCue ? "provider_specific" : "",
      metricCue ? "metric_claims" : "",
      conceptCue ? "concept_question" : "",
      uncertaintySignals >= 3 ? "uncertainty" : "",
      (knowledgeInsight?.benchmark.noOpRate ?? 0) >= 35 ? "no_op_high" : "",
      (knowledgeInsight?.benchmark.staticFallbackRate ?? 0) >= 15 ? "static_fallback_high" : "",
      (knowledgeInsight?.benchmark.worthItRate ?? 0) >= 55 ? "positive_refine_roi" : "",
      (knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0) >= 35
        ? "positive_tool_roi"
        : ""
    ]);
    const memoryRules = await this.knowledgeMemoryService.getRelevantRules({
      category,
      activeSignals,
      domains: ["routing", "refine", "reasoning", "tool_usage"],
      limit: 4
    });
    const memoryRoutingBias = memoryRules.reduce(
      (sum, rule) => sum + Math.round(rule.influence.routingBias * rule.confidence),
      0
    );
    const memoryRefineBias = memoryRules.reduce(
      (sum, rule) => sum + Math.round(rule.influence.refineBias * rule.confidence),
      0
    );
    const memoryResearchBias = memoryRules.reduce(
      (sum, rule) => sum + Math.round(rule.influence.researchBias * rule.confidence),
      0
    );

    const focus = this.selectFocus({
      category,
      averageFactualRisk,
      structuralRiskCount,
      falseClaimCount,
      providerOrStandardCue,
      conceptCue
    });
    const refinePolicy = this.selectRefinePolicy({
      category,
      averageFactualRisk,
      averageReasoningRisk,
      structuralRiskCount,
      falseClaimCount,
      directCritiquePressure,
      averageAnswerLength,
      knowledgeInsight
    });
    const researchPolicy = this.selectResearchPolicy({
      averageFactualRisk,
      falseClaimCount,
      providerOrStandardCue,
      metricCue,
      conceptCue,
      structuralRiskCount,
      knowledgeInsight
    });
    const costPolicy = this.selectCostPolicy({
      averageFactualRisk,
      falseClaimCount,
      structuralRiskCount,
      researchPolicy,
      knowledgeInsight
    });

    const refineBias = clamp(
      (refinePolicy === "aggressive" ? 8 : refinePolicy === "conservative" ? -8 : 0) +
        (costPolicy === "quality_first" ? 4 : costPolicy === "latency_guarded" ? -4 : 0) +
        (focus === "execution_clarity" || focus === "strategy_actionability" ? 3 : 0) +
        (knowledgeInsight?.strategy.routerBias ?? 0) / 2 +
        memoryRoutingBias +
        memoryRefineBias,
      -20,
      20
    );
    const researchBias = clamp(
      (researchPolicy === "targeted"
        ? 9
        : researchPolicy === "ground_if_needed"
          ? 4
          : researchPolicy === "verify_only"
            ? -2
            : -12) +
        (focus === "factual_grounding" || focus === "pedagogy_precision" ? 3 : 0) +
        (costPolicy === "quality_first" ? 3 : costPolicy === "latency_guarded" ? -4 : 0) +
        ((knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0) >= 40 ? 3 : 0) -
        ((knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0) <= 10 ? 2 : 0) +
        memoryResearchBias,
      -20,
      20
    );

    const prioritySignals = uniqueStrings([
      averageFactualRisk >= 70 ? "high_factual_risk" : "",
      averageReasoningRisk >= 70 ? "high_reasoning_risk" : "",
      structuralRiskCount >= 6 ? "structural_pressure" : "",
      falseClaimCount > 0 ? "false_claims_present" : "",
      providerOrStandardCue ? "provider_or_standard_specific" : "",
      metricCue ? "metric_or_constraint_claims" : "",
      conceptCue ? "conceptual_question" : "",
      uncertaintySignals >= 3 ? "respondent_uncertainty" : "",
      knowledgeInsight ? `knowledge_${knowledgeInsight.strategy.routingRecommendation}` : "",
      ...memoryRules.map((rule) => `memory_${rule.domain}`)
    ]).slice(0, 10);

    const targetOutcomes = uniqueStrings([
      ...this.buildTargetOutcomes(focus),
      ...(knowledgeInsight?.strategy.highValueSignals.slice(0, 3) ?? []),
      ...memoryRules.map((rule) => rule.recommendedStrategy)
    ]).slice(0, 8);

    const reasoning = uniqueStrings([
      `Round orchestrated as ${focus} for ${category}.`,
      `Refine policy ${refinePolicy}, research policy ${researchPolicy}, cost policy ${costPolicy}.`,
      averageFactualRisk >= 60 || falseClaimCount > 0
        ? "Red Team indicates factual risk worth actively managing."
        : "Factual pressure is limited, so orchestration favors disciplined reasoning over extra grounding.",
      structuralRiskCount >= 5
        ? "Structural risk is elevated, so orchestration keeps refinement active on robustness and assumptions."
        : "Structural risk is moderate, so orchestration avoids unnecessary refinement aggression.",
      knowledgeInsight
        ? `Knowledge layer note: ${knowledgeInsight.strategy.note}`
        : "Knowledge layer unavailable; orchestration is using live round signals only."
      ,
      knowledgeInsight
        ? `Knowledge signals: no-op ${knowledgeInsight.benchmark.noOpRate}%, static refine fallback ${knowledgeInsight.benchmark.staticFallbackRate}%, positive research impact ${knowledgeInsight.benchmark.positiveResearchImpactRate}%.`
        : null,
      ...memoryRules.map(
        (rule) =>
          `Knowledge memory ${rule.domain}: ${rule.lesson} Strategy: ${rule.recommendedStrategy} (confidence ${Math.round(rule.confidence * 100)}%).`
      )
    ].filter(Boolean) as string[]).slice(0, 12);

    return {
      category,
      focus,
      refinePolicy,
      researchPolicy,
      costPolicy,
      refineBias,
      researchBias,
      targetOutcomes,
      prioritySignals,
      reasoning
    };
  }

  private async loadKnowledgeInsight(
    category: QuestionCategory
  ): Promise<KnowledgeCategoryInsight | null> {
    if (category === "other") {
      return null;
    }

    if (!this.knowledgeLayerPromise) {
      this.knowledgeLayerPromise = this.knowledgeLayerService.loadKnowledgeLayer();
    }

    const layer = await this.knowledgeLayerPromise;
    return layer?.categories.find((entry) => entry.category === category) ?? null;
  }

  private selectFocus(args: {
    category: QuestionCategory;
    averageFactualRisk: number;
    structuralRiskCount: number;
    falseClaimCount: number;
    providerOrStandardCue: boolean;
    conceptCue: boolean;
  }): OrchestrationFocus {
    if (
      (args.falseClaimCount >= 2 || args.averageFactualRisk >= 68) &&
      (args.providerOrStandardCue || args.conceptCue)
    ) {
      return "factual_grounding";
    }

    switch (args.category) {
      case "incident_response":
        return args.structuralRiskCount >= 5 ? "risk_containment" : "execution_clarity";
      case "architecture_design":
        return "tradeoff_clarity";
      case "technical_explanation":
        return args.averageFactualRisk >= 55 ? "factual_grounding" : "pedagogy_precision";
      case "debug_diagnostic":
        return "diagnostic_caution";
      case "product_strategy":
        return "strategy_actionability";
      case "operational_writing":
        return "execution_clarity";
      case "mixed_reasoning":
        return args.falseClaimCount >= 2 ? "factual_grounding" : "balanced_reasoning";
      case "other":
      default:
        return "general_quality";
    }
  }

  private selectRefinePolicy(args: {
    category: QuestionCategory;
    averageFactualRisk: number;
    averageReasoningRisk: number;
    structuralRiskCount: number;
    falseClaimCount: number;
    directCritiquePressure: number;
    averageAnswerLength: number;
    knowledgeInsight: KnowledgeCategoryInsight | null;
  }): OrchestrationRefinePolicy {
    const noOpRate = args.knowledgeInsight?.benchmark.noOpRate ?? 0;
    const staticFallbackRate = args.knowledgeInsight?.benchmark.staticFallbackRate ?? 0;

    if (
      args.averageFactualRisk >= 70 ||
      args.averageReasoningRisk >= 72 ||
      args.structuralRiskCount >= 6 ||
      args.falseClaimCount >= 2 ||
      args.directCritiquePressure >= 5
    ) {
      return "aggressive";
    }

    if (
      (noOpRate >= 35 || staticFallbackRate >= 18) &&
      args.averageFactualRisk < 62 &&
      args.averageReasoningRisk < 65 &&
      args.directCritiquePressure < 5
    ) {
      return "conservative";
    }

    if (
      args.knowledgeInsight?.strategy.routingRecommendation === "prefer_skip" &&
      args.averageFactualRisk < 45 &&
      args.structuralRiskCount < 4 &&
      args.averageAnswerLength >= 140
    ) {
      return "conservative";
    }

    if (
      args.category === "operational_writing" ||
      args.category === "product_strategy"
    ) {
      return args.directCritiquePressure >= 3 ? "aggressive" : "balanced";
    }

    return "balanced";
  }

  private selectResearchPolicy(args: {
    averageFactualRisk: number;
    falseClaimCount: number;
    providerOrStandardCue: boolean;
    metricCue: boolean;
    conceptCue: boolean;
    structuralRiskCount: number;
    knowledgeInsight: KnowledgeCategoryInsight | null;
  }): OrchestrationResearchPolicy {
    const toolRecommendation = args.knowledgeInsight?.strategy.toolRecommendation ?? "conditional";
    const positiveResearchImpactRate =
      args.knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0;

    if (toolRecommendation === "avoid") {
      return args.falseClaimCount >= 1 && (args.providerOrStandardCue || args.metricCue)
        ? "verify_only"
        : "off";
    }

    if (toolRecommendation === "verify_only") {
      return args.falseClaimCount > 0 || args.providerOrStandardCue ? "verify_only" : "off";
    }

    if (toolRecommendation === "prefer_grounded") {
      if (positiveResearchImpactRate >= 40) {
        return args.averageFactualRisk >= 48 || args.conceptCue ? "targeted" : "ground_if_needed";
      }

      return args.averageFactualRisk >= 55 || args.conceptCue ? "targeted" : "ground_if_needed";
    }

    if (
      positiveResearchImpactRate >= 35 &&
      (args.falseClaimCount >= 1 ||
        ((args.providerOrStandardCue || args.metricCue || args.conceptCue) &&
          args.averageFactualRisk >= 45))
    ) {
      return args.structuralRiskCount >= 5 ? "ground_if_needed" : "targeted";
    }

    if (
      args.falseClaimCount >= 2 ||
      ((args.providerOrStandardCue || args.metricCue) && args.averageFactualRisk >= 55)
    ) {
      return "ground_if_needed";
    }

    return "off";
  }

  private selectCostPolicy(args: {
    averageFactualRisk: number;
    falseClaimCount: number;
    structuralRiskCount: number;
    researchPolicy: OrchestrationResearchPolicy;
    knowledgeInsight: KnowledgeCategoryInsight | null;
  }): OrchestrationCostPolicy {
    const noOpRate = args.knowledgeInsight?.benchmark.noOpRate ?? 0;
    const staticFallbackRate = args.knowledgeInsight?.benchmark.staticFallbackRate ?? 0;

    if (
      args.researchPolicy !== "off" &&
      (args.averageFactualRisk >= 72 || args.falseClaimCount >= 2)
    ) {
      return "quality_first";
    }

    if (
      (noOpRate >= 35 || staticFallbackRate >= 18) &&
      args.averageFactualRisk < 65 &&
      args.falseClaimCount < 2
    ) {
      return "latency_guarded";
    }

    if (
      args.knowledgeInsight?.strategy.routingRecommendation === "prefer_skip" &&
      args.averageFactualRisk < 50 &&
      args.structuralRiskCount < 4
    ) {
      return "latency_guarded";
    }

    return "balanced";
  }

  private buildTargetOutcomes(focus: OrchestrationFocus) {
    switch (focus) {
      case "risk_containment":
        return [
          "Make containment and rollback decisions explicit.",
          "Name validation checks and dependencies."
        ];
      case "execution_clarity":
        return [
          "Tighten sequence and actionability.",
          "Reduce noise and preserve operational clarity."
        ];
      case "tradeoff_clarity":
        return [
          "Expose constraints and tradeoffs.",
          "Avoid generic perfect-architecture framing."
        ];
      case "pedagogy_precision":
        return [
          "Clarify definitions and contrasts.",
          "Keep examples precise without bloating the answer."
        ];
      case "diagnostic_caution":
        return [
          "Preserve hypothesis discipline.",
          "Prioritize checks, evidence, and next steps."
        ];
      case "strategy_actionability":
        return [
          "Force prioritization, metrics, and sequencing.",
          "Cut corporate fluff and vague recommendations."
        ];
      case "balanced_reasoning":
        return [
          "Balance theory, application, and limitations.",
          "Keep decision logic visible."
        ];
      case "factual_grounding":
        return [
          "Verify externally checkable claims.",
          "Replace weak assertions with sourced precision."
        ];
      case "general_quality":
      default:
        return [
          "Improve robustness without widening scope.",
          "Preserve useful content and clarify assumptions."
        ];
    }
  }
}

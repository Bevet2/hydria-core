import type {
  OrchestrationPolicyDetails,
  QuestionCategory,
  ResearchToolLog,
  RespondentOutput
} from "../types/arena.js";
import type { KnowledgeCategoryInsight, KnowledgeCategoryStrategy } from "../types/knowledge.js";
import { logger } from "../utils/logger.js";
import { KnowledgeLayerService } from "./knowledgeLayerService.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";
import {
  countRegexMatches,
  hasUncertaintySignals,
  matchesAny,
  RESEARCH_MODE_COST_MS,
  type ResearchDecision,
  type ResearchDecisionArgs,
  uniqueStrings
} from "./research/common.js";
import { ResearchExtractor } from "./research/extractor.js";
import { ResearchPlanner } from "./research/planner.js";
import { ResearchRetriever } from "./research/retriever.js";
import { ResearchVerifier } from "./research/verifier.js";

type ResearchImpactArgs = {
  log: ResearchToolLog;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  refineA: { improved_answer: string; fixes_applied: string[] };
  refineB: { improved_answer: string; fixes_applied: string[] };
};

function buildEmptyResearchLog(decision: ResearchDecision): ResearchToolLog {
  return {
    considered: false,
    used: false,
    route: "not_needed",
    decision: {
      shouldUse: false,
      mode: "off",
      expectedValue: decision.expectedValue,
      expectedCostMs: 0,
      triggerSignals: decision.triggerSignals,
      targetClaims: decision.targetClaims,
      reasoning: decision.reasons[0] ?? "Research not needed for this round."
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
    reasons: decision.reasons,
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: []
    },
    truth: {
      verified_facts: [],
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: 0,
      no_reliable_source: false
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
}

export class ResearchToolService {
  private readonly knowledgeLayerService = new KnowledgeLayerService();
  private readonly knowledgeMemoryService = new KnowledgeMemoryService();
  private readonly planner = new ResearchPlanner();
  private readonly retriever = new ResearchRetriever();
  private readonly extractor = new ResearchExtractor();
  private readonly verifier = new ResearchVerifier();
  private knowledgeLayerPromise: Promise<
    Awaited<ReturnType<KnowledgeLayerService["loadKnowledgeLayer"]>>
  > | null = null;

  async maybeCollect(args: ResearchDecisionArgs): Promise<ResearchToolLog> {
    const decision = await this.decide(args);
    if (!decision.shouldUse || !decision.plan || decision.plan.queries.length === 0) {
      return buildEmptyResearchLog(decision);
    }

    const startedAt = Date.now();

    try {
      const searchResults = await this.retriever.searchAll(decision.plan);
      const sources = await this.extractor.extractSources(searchResults.slice(0, 3), decision.plan);

      return this.verifier.buildLog({
        decision,
        args,
        searchResults,
        sources,
        startedAt
      });
    } catch (error) {
      logger.warn("Research tool failed", {
        question: args.question,
        category: args.category,
        error: String(error)
      });

      return this.verifier.buildFailureLog({
        decision,
        args,
        startedAt,
        error
      });
    }
  }

  finalizeImpact(args: ResearchImpactArgs): ResearchToolLog {
    return this.verifier.finalizeImpact(args);
  }

  finalizeRoundAccounting(log: ResearchToolLog, totalRoundMs: number): ResearchToolLog {
    return this.verifier.finalizeRoundAccounting(log, totalRoundMs);
  }

  private async loadKnowledgeInsight(category: QuestionCategory): Promise<KnowledgeCategoryInsight | null> {
    if (category === "other") {
      return null;
    }

    if (!this.knowledgeLayerPromise) {
      this.knowledgeLayerPromise = this.knowledgeLayerService.loadKnowledgeLayer();
    }

    const layer = await this.knowledgeLayerPromise;
    return layer?.categories.find((entry) => entry.category === category) ?? null;
  }

  private async decide(args: ResearchDecisionArgs): Promise<ResearchDecision> {
    const reasons: string[] = [];
    const triggerSignals: string[] = [];

    if (!args.shouldRefineA && !args.shouldRefineB) {
      reasons.push("Research skipped because both refine slots were skipped by the router.");
      return {
        shouldUse: false,
        reasons,
        triggerSignals: ["refine_router_skipped_both"],
        targetClaims: [],
        expectedValue: "low",
        expectedCostMs: 0,
        knowledgeStrategy: null,
        plan: null
      };
    }

    const knowledgeInsight = await this.loadKnowledgeInsight(args.category);
    const knowledgeStrategy = knowledgeInsight?.strategy ?? null;
    const orchestration = args.orchestration ?? null;
    const studentStrategy = args.studentStrategy ?? null;

    const uncertaintySignals =
      hasUncertaintySignals(args.respondentA) + hasUncertaintySignals(args.respondentB);
    const structuralRiskCount =
      args.redTeam.hidden_assumptions.length +
      args.redTeam.failure_scenarios.length +
      args.redTeam.potentially_false_claims.length;
    const falseClaimCount = args.redTeam.potentially_false_claims.length;
    const combinedText = `${args.question} ${args.respondentA.answer} ${args.respondentB.answer} ${args.redTeam.potentially_false_claims.join(" ")}`.toLowerCase();
    const questionText = args.question.toLowerCase();
    const factualCue = matchesAny(questionText, [
      /\bwhat is\b/i,
      /\bwhat are\b/i,
      /\bhow does\b/i,
      /\bhow do\b/i,
      /\bexplain\b/i,
      /\bdifference between\b/i,
      /\bwhy does\b/i,
      /\bhow would you debug\b/i
    ]);
    const temporalOrOfficialCue = matchesAny(questionText, [
      /\blatest\b/i,
      /\bcurrent\b/i,
      /\btoday\b/i,
      /\bofficial\b/i,
      /\bstandard\b/i,
      /\bversion\b/i,
      /\bregulation\b/i,
      /\blaw\b/i
    ]);
    const providerSpecific = matchesAny(combinedText, [
      /\baws\b/i,
      /\bazure\b/i,
      /\bgcp\b/i,
      /\bgoogle cloud\b/i,
      /\bcloudflare\b/i,
      /\bkafka\b/i,
      /\bnode\.?js\b/i,
      /\bexpress\b/i,
      /\bpostgres(?:ql)?\b/i,
      /\bmysql\b/i,
      /\bmongodb\b/i,
      /\bredis\b/i,
      /\bkubernetes\b/i,
      /\bdocker\b/i,
      /\bollama\b/i,
      /\boauth\b/i,
      /\bsaml\b/i,
      /\bjwt\b/i,
      /\brfc\b/i,
      /\bnist\b/i,
      /\bgdpr\b/i,
      /\bhipaa\b/i,
      /\bsoc ?2\b/i,
      /\bpci\b/i
    ]);
    const regulatoryOrStandardCue = matchesAny(combinedText, [
      /\bgdpr\b/i,
      /\bhipaa\b/i,
      /\bpci\b/i,
      /\bsoc ?2\b/i,
      /\bnist\b/i,
      /\brfc\b/i,
      /\bstandard\b/i,
      /\bregulation\b/i,
      /\bpolicy\b/i,
      /\bcompliance\b/i
    ]);
    const hardConstraintCue = matchesAny(combinedText, [
      /\bmillion/i,
      /\bconcurrent\b/i,
      /\bthroughput\b/i,
      /\blatency\b/i,
      /\bquota\b/i,
      /\brate limit\b/i,
      /\bfailover\b/i,
      /\bmulti-region\b/i,
      /\bexactly-once\b/i,
      /\bordering\b/i,
      /\bsla\b/i,
      /\bapi gateway\b/i
    ]);
    const debugDocCue = matchesAny(combinedText, [
      /\b500\b/,
      /\b429\b/,
      /\b503\b/,
      /\btimeout\b/i,
      /\bmemory leak\b/i,
      /\boom\b/i,
      /\bnode\.?js\b/i,
      /\bexpress\b/i,
      /\bkafka\b/i,
      /\bpostgres(?:ql)?\b/i
    ]);
    const explicitMetricCue =
      countRegexMatches(combinedText, /\b\d+(?:\.\d+)?%?\b/g) >= 2 ||
      matchesAny(combinedText, [
        /\bkpi\b/i,
        /\bmetric\b/i,
        /\broi\b/i,
        /\bcac\b/i,
        /\bpayback\b/i,
        /\bretention\b/i,
        /\badoption\b/i,
        /\bactivation\b/i,
        /\bconversion\b/i
      ]);
    const highFactualRisk = args.redTeam.factual_risk_level >= 70;
    const mediumFactualRisk = args.redTeam.factual_risk_level >= 55;
    const elevatedFactualRisk = args.redTeam.factual_risk_level >= 45;
    const verificationNeed =
      temporalOrOfficialCue || providerSpecific || regulatoryOrStandardCue || hardConstraintCue;
    const studentFactualVerifyFirst = studentStrategy?.strategyId === "factual_verify_first";
    const studentFactualShort = studentStrategy?.strategyId === "factual_short";
    const studentOpenLike =
      studentStrategy?.context.questionType === "open" ||
      args.category === "operational_writing" ||
      args.category === "product_strategy";
    const targetClaims = uniqueStrings([
      ...args.redTeam.potentially_false_claims.slice(0, 4),
      ...args.redTeam.shared_risks.slice(0, 2)
    ]).slice(0, 6);
    const memorySignals = uniqueStrings([
      highFactualRisk ? "high_factual_risk" : "",
      mediumFactualRisk ? "medium_factual_risk" : "",
      falseClaimCount > 0 ? "factual_claims" : "",
      providerSpecific ? "provider_specific" : "",
      regulatoryOrStandardCue ? "provider_specific" : "",
      hardConstraintCue ? "metric_claims" : "",
      debugDocCue ? "execution_gap" : "",
      explicitMetricCue ? "metric_claims" : "",
      factualCue ? "concept_question" : "",
      uncertaintySignals >= 3 ? "uncertainty" : "",
      (knowledgeInsight?.benchmark.positiveResearchImpactRate ?? 0) >= 35
        ? "positive_tool_roi"
        : "",
      (knowledgeInsight?.benchmark.noOpRate ?? 0) >= 35 ? "no_op_high" : ""
    ]);
    const memoryRules = await this.knowledgeMemoryService.getRelevantRules({
      category: args.category,
      activeSignals: memorySignals,
      domains: ["tool_usage", "reasoning"],
      limit: 4
    });
    const memoryResearchBias = memoryRules.reduce(
      (sum, rule) => sum + Math.round(rule.influence.researchBias * rule.confidence),
      0
    );
    const categoryBias = knowledgeStrategy?.routerBias ?? 0;
    const baseNeedScore =
      falseClaimCount * 18 +
      (highFactualRisk ? 28 : mediumFactualRisk ? 16 : elevatedFactualRisk ? 8 : 0) +
      (providerSpecific ? 8 : 0) +
      (regulatoryOrStandardCue ? 8 : 0) +
      (hardConstraintCue ? 6 : 0) +
      (debugDocCue ? 8 : 0) +
      (explicitMetricCue ? 5 : 0) +
      (uncertaintySignals >= 3 ? 6 : 0) +
      (structuralRiskCount >= 7 ? 6 : 0) +
      (studentFactualVerifyFirst ? 16 : studentFactualShort ? 6 : 0) -
      (studentOpenLike ? 10 : 0) +
      categoryBias +
      memoryResearchBias +
      (orchestration?.researchBias ?? 0);
    const thresholdAdjustment =
      (knowledgeStrategy?.toolRecommendation === "prefer_grounded"
        ? -8
        : knowledgeStrategy?.toolRecommendation === "verify_only"
          ? 2
          : knowledgeStrategy?.toolRecommendation === "avoid"
            ? 10
            : 0) +
      (orchestration?.costPolicy === "latency_guarded"
        ? 4
        : orchestration?.costPolicy === "quality_first"
          ? -4
          : 0);

    const addReason = (reason: string) => {
      if (!reasons.includes(reason)) {
        reasons.push(reason);
      }
    };
    const addSignal = (signal: string) => {
      if (!triggerSignals.includes(signal)) {
        triggerSignals.push(signal);
      }
    };

    if (falseClaimCount > 0) addSignal("potentially_false_claims");
    if (highFactualRisk) addSignal("high_factual_risk");
    else if (mediumFactualRisk) addSignal("medium_factual_risk");
    else if (elevatedFactualRisk) addSignal("elevated_factual_risk");
    if (providerSpecific) addSignal("provider_or_product_specific");
    if (regulatoryOrStandardCue) addSignal("regulatory_or_standard");
    if (hardConstraintCue) addSignal("hard_constraints");
    if (debugDocCue) addSignal("diagnostic_doc_needed");
    if (explicitMetricCue) addSignal("explicit_metric_claims");
    if (uncertaintySignals >= 3) addSignal("respondent_uncertainty");
    if (structuralRiskCount >= 7) addSignal("redteam_structural_pressure");
    if (knowledgeStrategy) addSignal(`knowledge_tool_${knowledgeStrategy.toolRecommendation}`);
    for (const rule of memoryRules) {
      addSignal(`memory_${rule.domain}`);
    }
    if (orchestration) {
      addSignal(`orchestration_focus_${orchestration.focus}`);
      addSignal(`orchestration_research_${orchestration.researchPolicy}`);
    }

    if (knowledgeStrategy?.toolRecommendation === "avoid") {
      addReason(
        `Knowledge layer marks ${args.category} as low-value for grounding unless a strong external-verification signal appears.`
      );
    } else if (knowledgeStrategy?.toolRecommendation === "prefer_grounded") {
      addReason(
        `Knowledge layer marks ${args.category} as a category where grounded verification has historically added value.`
      );
    } else if (knowledgeStrategy?.toolRecommendation === "verify_only") {
      addReason(
        `Knowledge layer marks ${args.category} as verify-only: use research only to confirm externally checkable claims.`
      );
    } else if (knowledgeStrategy?.toolRecommendation === "conditional") {
      addReason(
        `Knowledge layer marks ${args.category} as conditional: research should only fire when the factual sub-problem is explicit.`
      );
    }
    if (studentFactualVerifyFirst) {
      addSignal("student_strategy_factual_verify_first");
      addReason(
        "Student strategy factual_verify_first prioritizes concise verification before answering, which increases the value of external grounding."
      );
    } else if (studentFactualShort) {
      addSignal("student_strategy_factual_short");
      addReason(
        "Student strategy factual_short favors concise, careful answers and can benefit from lightweight factual verification."
      );
    } else if (studentOpenLike) {
      addSignal("student_strategy_open_like");
      addReason(
        "Current student strategy or category is open-ended or writing-heavy, so external grounding should stay conservative."
      );
    }
    for (const rule of memoryRules) {
      addReason(
        `Knowledge memory ${rule.domain}: ${rule.lesson} Strategy: ${rule.recommendedStrategy} (confidence ${Math.round(rule.confidence * 100)}%).`
      );
    }

    if (falseClaimCount >= 1) {
      addReason(
        `Red Team flagged ${falseClaimCount} potentially false claim(s), which creates a direct verification target.`
      );
    }
    if (providerSpecific || regulatoryOrStandardCue || hardConstraintCue || debugDocCue) {
      addReason(
        "The current round contains provider-, standard-, or constraint-specific details that are externally checkable."
      );
    }
    if ((factualCue || temporalOrOfficialCue || verificationNeed) && elevatedFactualRisk) {
      addReason(
        "The question and Red Team output jointly indicate that external verification could reduce hallucination risk."
      );
    }
    if (orchestration) {
      addReason(
        `Orchestration selected ${orchestration.focus} with research policy ${orchestration.researchPolicy} and cost policy ${orchestration.costPolicy}.`
      );
    }

    const shouldUse = this.shouldUseResearch({
      category: args.category,
      falseClaimCount,
      elevatedFactualRisk,
      mediumFactualRisk,
      highFactualRisk,
      providerSpecific,
      regulatoryOrStandardCue,
      hardConstraintCue,
      debugDocCue,
      explicitMetricCue,
      factualCue,
      temporalOrOfficialCue,
      verificationNeed,
      uncertaintySignals,
      structuralRiskCount,
      baseNeedScore,
      thresholdAdjustment,
      knowledgeStrategy,
      orchestration,
      studentFactualVerifyFirst,
      studentOpenLike
    });
    const plan = shouldUse
      ? this.planner.buildPlan(args, knowledgeStrategy, orchestration)
      : null;
    const expectedValue =
      shouldUse && baseNeedScore >= 55
        ? "high"
        : shouldUse && baseNeedScore >= 35
          ? "medium"
          : "low";
    const expectedCostMs = shouldUse && plan ? RESEARCH_MODE_COST_MS[plan.mode] : 0;

    return {
      shouldUse,
      reasons: shouldUse
        ? [
            `Research plan: ${plan?.intent ?? "fact_check"}; ${plan?.reasoning ?? "verification-focused"}.`,
            ...reasons
          ].slice(0, 6)
        : [
            `Research not needed for this round: ${args.category} currently benefits more from reasoning/refinement than external grounding for the observed signals and knowledge-layer priors.`
          ],
      triggerSignals: shouldUse ? triggerSignals.slice(0, 8) : ["no_external_verification_signal"],
      targetClaims,
      expectedValue,
      expectedCostMs,
      knowledgeStrategy,
      plan
    };
  }

  private shouldUseResearch(args: {
    category: QuestionCategory;
    falseClaimCount: number;
    elevatedFactualRisk: boolean;
    mediumFactualRisk: boolean;
    highFactualRisk: boolean;
    providerSpecific: boolean;
    regulatoryOrStandardCue: boolean;
    hardConstraintCue: boolean;
    debugDocCue: boolean;
    explicitMetricCue: boolean;
    factualCue: boolean;
    temporalOrOfficialCue: boolean;
    verificationNeed: boolean;
    uncertaintySignals: number;
    structuralRiskCount: number;
    baseNeedScore: number;
    thresholdAdjustment: number;
    knowledgeStrategy: KnowledgeCategoryStrategy | null;
    orchestration: OrchestrationPolicyDetails | null;
    studentFactualVerifyFirst?: boolean;
    studentOpenLike?: boolean;
  }) {
    if (
      args.studentOpenLike &&
      args.falseClaimCount === 0 &&
      !args.verificationNeed &&
      !args.providerSpecific &&
      !args.regulatoryOrStandardCue &&
      !args.hardConstraintCue
    ) {
      return false;
    }

    if (
      args.orchestration?.researchPolicy === "off" &&
      !(
        args.falseClaimCount >= 2 &&
        args.highFactualRisk &&
        (args.providerSpecific || args.regulatoryOrStandardCue || args.explicitMetricCue)
      )
    ) {
      return false;
    }

    if (
      args.orchestration?.costPolicy === "latency_guarded" &&
      args.falseClaimCount === 0 &&
      !args.verificationNeed &&
      args.baseNeedScore < 50
    ) {
      return false;
    }

    if (
      args.studentFactualVerifyFirst &&
      (args.falseClaimCount >= 1 ||
        args.temporalOrOfficialCue ||
        (args.mediumFactualRisk && (args.providerSpecific || args.explicitMetricCue)))
    ) {
      return true;
    }

    if (
      args.orchestration?.researchPolicy === "targeted" &&
      (args.falseClaimCount >= 1 ||
        (args.elevatedFactualRisk &&
          (args.factualCue || args.providerSpecific || args.temporalOrOfficialCue)))
    ) {
      return true;
    }

    if (
      args.orchestration?.researchPolicy === "verify_only" &&
      args.falseClaimCount >= 1 &&
      (args.providerSpecific ||
        args.regulatoryOrStandardCue ||
        args.explicitMetricCue ||
        args.temporalOrOfficialCue)
    ) {
      return true;
    }

    if (
      args.orchestration?.researchPolicy === "ground_if_needed" &&
      ((args.falseClaimCount >= 2 && args.elevatedFactualRisk) ||
        ((args.providerSpecific || args.debugDocCue || args.hardConstraintCue) &&
          args.mediumFactualRisk))
    ) {
      return true;
    }

    const threshold = 38 + args.thresholdAdjustment;

    if (
      args.knowledgeStrategy?.toolRecommendation === "avoid" &&
      !(
        args.falseClaimCount >= 1 &&
        args.highFactualRisk &&
        (args.providerSpecific ||
          args.regulatoryOrStandardCue ||
          args.explicitMetricCue ||
          args.temporalOrOfficialCue)
      )
    ) {
      return false;
    }

    if (
      args.knowledgeStrategy?.toolRecommendation === "prefer_grounded" &&
      (args.falseClaimCount >= 1 ||
        (args.elevatedFactualRisk &&
          (args.factualCue || args.providerSpecific || args.temporalOrOfficialCue)))
    ) {
      return true;
    }

    if (
      args.knowledgeStrategy?.toolRecommendation === "verify_only" &&
      args.falseClaimCount >= 1 &&
      (args.providerSpecific ||
        args.regulatoryOrStandardCue ||
        args.hardConstraintCue ||
        args.temporalOrOfficialCue)
    ) {
      return true;
    }

    if (
      args.knowledgeStrategy?.toolRecommendation === "conditional" &&
      ((args.falseClaimCount >= 2 && args.elevatedFactualRisk) ||
        ((args.providerSpecific || args.debugDocCue || args.hardConstraintCue) &&
          args.mediumFactualRisk))
    ) {
      return true;
    }

    if (
      args.baseNeedScore >= threshold &&
      (args.verificationNeed || args.falseClaimCount > 0 || args.debugDocCue)
    ) {
      return true;
    }

    if (
      args.falseClaimCount >= 2 &&
      args.highFactualRisk &&
      args.uncertaintySignals >= 2 &&
      args.structuralRiskCount >= 5
    ) {
      return true;
    }

    return false;
  }
}

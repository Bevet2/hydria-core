import type {
  ResearchToolLog,
  RespondentOutput,
  ToolRoutingDecision
} from "../types/arena.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import type { AgentRoutingDecision } from "../types/agents.js";
import { defaultAgentRoutingDecision } from "../types/agents.js";
import {
  defaultSkillRoutingDecision,
  type SkillRoutingDecision
} from "../types/skills.js";
import { logger } from "../utils/logger.js";
import {
  RESEARCH_MODE_COST_MS,
  sanitizeResearchDecisionReasoning,
  type ResearchDecision,
  type ResearchDecisionArgs,
} from "./research/common.js";
import {
  ResearchAcquisitionService,
  type ResearchAcquisitionServiceOptions
} from "./research/acquisitionService.js";
import { ResearchDecisionPolicyService } from "./research/decisionPolicy.js";
import { ResearchPlanner } from "./research/planner.js";
import { type ResearchAcquisitionMode } from "./research/replayStore.js";
import { buildDefaultTemporalProfile } from "./research/temporal.js";
import { ResearchVerifier } from "./research/verifier.js";
import { AgentRoutingService } from "./agents/agentRoutingService.js";
import { SkillRegistry } from "./skills/skillRegistry.js";
import { SkillRoutingService } from "./skills/skillRoutingService.js";
import {
  LocalToolExecutionService,
  type LocalToolExecutionResult
} from "./tools/localToolExecutionService.js";
import { ToolGapDetectorService } from "./tools/toolGapDetectorService.js";
import { ToolRegistry } from "./tools/toolRegistry.js";
import { ToolRoutingService } from "./tools/toolRoutingService.js";

type ResearchToolServiceOptions = {
  acquisitionMode?: ResearchAcquisitionMode;
  fixtureFile?: string | null;
  sourceCacheEnabled?: boolean;
  decisionPolicyService?: Pick<ResearchDecisionPolicyService, "decide">;
  verifier?: Pick<
    ResearchVerifier,
    "buildLog" | "buildFailureLog" | "finalizeImpact" | "finalizeRoundAccounting"
  >;
  toolRoutingService?: Pick<ToolRoutingService, "route">;
  toolRegistry?: Pick<ToolRegistry, "findToolsByIntent">;
  toolGapDetectorService?: Pick<ToolGapDetectorService, "detectFromRequest">;
  skillRoutingService?: Pick<SkillRoutingService, "route">;
  skillRegistry?: Pick<SkillRegistry, "incrementUsage">;
  agentRoutingService?: Pick<AgentRoutingService, "route">;
  localToolExecutionService?: {
    tryExecute(routing: ToolRoutingDecision): LocalToolExecutionResult | null | Promise<LocalToolExecutionResult | null>;
  };
  planner?: Pick<ResearchPlanner, "buildPlan">;
};

type ResearchImpactArgs = {
  log: ResearchToolLog;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  refineA: { improved_answer: string; fixes_applied: string[] };
  refineB: { improved_answer: string; fixes_applied: string[] };
};

function buildEmptyResearchLog(decision: ResearchDecision): ResearchToolLog {
  const toolRouting = decision.toolRouting ?? defaultToolRoutingDecision;
  const skillRouting = decision.skillRouting ?? defaultSkillRoutingDecision;
  const agentRouting = decision.agentRouting ?? defaultAgentRoutingDecision;
  return {
    considered: toolRouting.toolRecommended,
    used: false,
    route: "not_needed",
    toolRouting,
    skillRouting,
    skillUsed: skillRouting.skillFound,
    skillConfidence: skillRouting.skillFound ? skillRouting.confidence : null,
    skillOutcome: skillRouting.skillFound ? "recommended" : "not_found",
    agentRouting,
    agentOutcome: agentRouting.agentFound ? "fallback_core" : "not_found",
    fallbackUsed: agentRouting.fallbackToCore,
    agentRecommendation: agentRouting.recommendation,
    toolGapDetected: false,
    toolCandidateCreated: false,
    toolCandidateId: null,
    missingCapabilityReason: null,
    decision: {
      shouldUse: false,
      mode: "off",
      expectedValue: decision.expectedValue,
      expectedCostMs: 0,
      triggerSignals: decision.triggerSignals,
      targetClaims: decision.targetClaims,
      reasoning: sanitizeResearchDecisionReasoning(
        decision.reasons[0] ?? "Research not needed for this round."
      )
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
    reasons: decision.reasons,
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: [],
      freshnessSatisfied: true,
      freshnessWindow: "none",
      mostRecentSourceDate: null,
      oldestAcceptedSourceDate: null,
      staleSourcesRejectedCount: 0
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

function buildToolDirectLog(args: {
  decision: ResearchDecision;
  routing: ToolRoutingDecision;
  skillRouting: SkillRoutingDecision;
  agentRouting: AgentRoutingDecision;
  verifiedFacts: string[];
  summary: string[];
  resultLabel: string;
  confidenceScore: number;
  sources?: ResearchToolLog["sources"];
  appliedTo: { A: boolean; B: boolean };
}): ResearchToolLog {
  const temporalProfile = args.decision.plan?.temporalProfile ?? buildDefaultTemporalProfile();
  const sources = (args.sources ?? []).slice(0, 5);
  const fallbackIntent =
    args.routing.toolType === "time" || args.routing.toolType === "weather" || args.routing.toolType === "finance"
      ? "current_status"
      : "fact_check";
  return {
    considered: true,
    used: true,
    route: "used",
    toolRouting: {
      ...args.routing,
      toolResultUsed: true
    },
    skillRouting: args.skillRouting,
    skillUsed: args.skillRouting.skillFound,
    skillConfidence: args.skillRouting.skillFound ? args.skillRouting.confidence : null,
    skillOutcome: args.skillRouting.skillFound ? "recommended" : "not_found",
    agentRouting: args.agentRouting,
    agentOutcome: args.agentRouting.agentFound ? "fallback_core" : "not_found",
    fallbackUsed: args.agentRouting.fallbackToCore,
    agentRecommendation: args.agentRouting.recommendation,
    toolGapDetected: false,
    toolCandidateCreated: false,
    toolCandidateId: null,
    missingCapabilityReason: null,
    decision: {
      shouldUse: true,
      mode: args.decision.plan?.mode ?? "targeted_verify",
      expectedValue: args.decision.expectedValue,
      expectedCostMs: 0,
      triggerSignals: args.decision.triggerSignals,
      targetClaims: args.decision.targetClaims,
      reasoning: sanitizeResearchDecisionReasoning(
        args.decision.reasons[0] ?? `${args.routing.toolType} tool returned a deterministic result.`
      )
    },
    queryPlan: {
      intent: args.decision.plan?.intent ?? fallbackIntent,
      queries: args.decision.plan?.queries ?? [`${args.routing.intent}: ${args.resultLabel}`],
      selectedQuery: args.decision.plan?.queries?.[0] ?? `${args.routing.intent}: ${args.resultLabel}`,
      requiredTerms: args.decision.plan?.requiredTerms ?? [],
      preferredDomains: args.decision.plan?.preferredDomains ?? [],
      factFocusTerms: args.decision.plan?.factFocusTerms ?? [],
      entityTerms: args.decision.plan?.entityTerms ?? [],
      temporalProfile
    },
    query: `${args.routing.intent}: ${args.resultLabel}`,
    reasons: args.decision.reasons,
    summary: args.summary,
    sources,
    verification: {
      sourceCount: sources.length,
      extractedSourceCount: sources.length,
      corroboratedSignals: sources.length > 0 ? args.verifiedFacts.slice(0, 3) : [],
      freshnessSatisfied: true,
      freshnessWindow: temporalProfile.isTemporal ? "current" : "none",
      mostRecentSourceDate: sources[0]?.effectiveDate ?? sources[0]?.modifiedAt ?? null,
      oldestAcceptedSourceDate: sources.at(-1)?.effectiveDate ?? sources.at(-1)?.modifiedAt ?? null,
      staleSourcesRejectedCount: 0
    },
    truth: {
      verified_facts: args.verifiedFacts.slice(0, 8),
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: args.confidenceScore,
      no_reliable_source: false
    },
    appliedTo: args.appliedTo,
    impact: {
      refineChangedBecauseOfTool: false,
      addedFactsCount: args.verifiedFacts.length,
      correctedClaimsCount: 0,
      sourceBackedClaimsCount: args.verifiedFacts.length,
      costSharePct: 0,
      netImpact: "positive"
    },
    impactNotes: [
      `${args.routing.toolType} tool executed directly for intent ${args.routing.intent}.`,
      `Result: ${args.resultLabel}`
    ],
    durationMs: 0
  };
}

function buildRequiredToolFailureLog(args: {
  decision: ResearchDecision;
  routing: ToolRoutingDecision;
  skillRouting: SkillRoutingDecision;
  agentRouting: AgentRoutingDecision;
  reason: string;
}): ResearchToolLog {
  const temporalProfile = args.decision.plan?.temporalProfile ?? buildDefaultTemporalProfile();
  const missingRequiredInput = isMissingRequiredInputReason(args.reason);

  return {
    considered: true,
    used: false,
    route: "failed",
    toolRouting: {
      ...args.routing,
      toolResultUsed: false
    },
    skillRouting: args.skillRouting,
    skillUsed: args.skillRouting.skillFound,
    skillConfidence: args.skillRouting.skillFound ? args.skillRouting.confidence : null,
    skillOutcome: args.skillRouting.skillFound ? "fallback" : "not_found",
    agentRouting: args.agentRouting,
    agentOutcome: args.agentRouting.agentFound ? "fallback_core" : "not_found",
    fallbackUsed: true,
    agentRecommendation: args.agentRouting.recommendation,
    toolGapDetected: false,
    toolCandidateCreated: false,
    toolCandidateId: null,
    missingCapabilityReason: null,
    decision: {
      shouldUse: true,
      mode: args.decision.plan?.mode ?? "targeted_verify",
      expectedValue: args.decision.expectedValue,
      expectedCostMs: args.decision.expectedCostMs,
      triggerSignals: args.decision.triggerSignals,
      targetClaims: args.decision.targetClaims,
      reasoning: sanitizeResearchDecisionReasoning(args.reason)
    },
    queryPlan: {
      intent: args.decision.plan?.intent ?? "fact_check",
      queries: args.decision.plan?.queries ?? [],
      selectedQuery: args.decision.plan?.queries?.[0] ?? null,
      requiredTerms: args.decision.plan?.requiredTerms ?? [],
      preferredDomains: args.decision.plan?.preferredDomains ?? [],
      factFocusTerms: args.decision.plan?.factFocusTerms ?? [],
      entityTerms: args.decision.plan?.entityTerms ?? [],
      temporalProfile
    },
    query: args.decision.plan?.queries?.[0] ?? null,
    reasons: args.decision.reasons,
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: [],
      freshnessSatisfied: missingRequiredInput || !temporalProfile.isTemporal,
      freshnessWindow: temporalProfile.isTemporal ? "current" : "none",
      mostRecentSourceDate: null,
      oldestAcceptedSourceDate: null,
      staleSourcesRejectedCount: 0
    },
    truth: {
      verified_facts: [],
      uncertain_claims: [args.reason].slice(0, 4),
      conflicting_info: [],
      confidence_score: 0,
      no_reliable_source: !missingRequiredInput
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
      netImpact: missingRequiredInput ? "neutral" : "negative"
    },
    impactNotes: [args.reason],
    durationMs: 0
  };
}

function isMissingRequiredInputReason(reason: string) {
  return /\b(?:missing|required input|which city|ask the user|clarify|manque|preciser|precise|ville|demande|not provided|no accessible|private|access|not available in this runtime|unavailable in this runtime)\b/i.test(
    reason
  );
}

function buildLocalToolFailureReason(routing: ToolRoutingDecision) {
  const language = routing.extractedArgs?.language === "fr" ? "fr" : "en";

  if (routing.toolType === "weather" && routing.intent === "current_weather") {
    const location = typeof routing.extractedArgs?.location === "string"
      ? routing.extractedArgs.location.trim()
      : "";
    if (!location) {
      return language === "fr"
        ? "Il manque la ville pour executer l'outil meteo. Demande a l'utilisateur quelle ville utiliser, ou utilise une ville seulement si elle est explicitement presente dans la question ou le contexte."
          : "The city is missing for the weather tool. Ask the user which city to use, or use a city only when it is explicitly present in the question or context.";
    }
  }

  if (routing.toolType === "calculator" && routing.intent === "arithmetic") {
    return language === "fr"
      ? "Il manque une expression de calcul complete. Demande a l'utilisateur de preciser le calcul a effectuer."
      : "A complete arithmetic expression is missing. Ask the user to clarify the calculation.";
  }

  if (routing.toolType === "calculator" && routing.intent === "unit_conversion") {
    return language === "fr"
      ? "Il manque la valeur ou les unites pour executer la conversion. Demande a l'utilisateur de preciser la valeur, l'unite de depart et l'unite cible."
      : "The value or units are missing for the conversion. Ask the user to clarify the value, source unit, and target unit.";
  }

  if (routing.toolType === "calculator" && routing.intent === "currency_conversion") {
    return language === "fr"
      ? "Il manque un montant, des devises, ou un taux explicite pour executer la conversion. N'invente pas de taux de change; demande la precision manquante."
      : "The amount, currencies, or explicit rate are missing for the conversion. Do not invent an exchange rate; ask for the missing detail.";
  }

  if (routing.toolType === "finance" && routing.intent === "current_price") {
    return language === "fr"
      ? "Le prix actuel demande une source de marche en direct, mais l'outil finance n'a pas retourne de resultat structure. N'invente pas de prix; explique que le prix ne peut pas etre verifie maintenant."
      : "The current price requires a live market source, but the finance tool did not return a structured result. Do not invent a price; say the price cannot be verified right now.";
  }

  return `Required local tool path ${routing.toolType}/${routing.intent} did not return a structured result, so the request cannot be answered safely without tool output.`;
}

export class ResearchToolService {
  private readonly decisionPolicyService: Pick<ResearchDecisionPolicyService, "decide">;
  private readonly acquisitionService: ResearchAcquisitionService;
  private readonly verifier: Pick<
    ResearchVerifier,
    "buildLog" | "buildFailureLog" | "finalizeImpact" | "finalizeRoundAccounting"
  >;
  private readonly toolRoutingService: Pick<ToolRoutingService, "route">;
  private readonly toolRegistry: Pick<ToolRegistry, "findToolsByIntent">;
  private readonly toolGapDetectorService: Pick<ToolGapDetectorService, "detectFromRequest">;
  private readonly skillRoutingService: Pick<SkillRoutingService, "route">;
  private readonly skillRegistry: Pick<SkillRegistry, "incrementUsage">;
  private readonly agentRoutingService: Pick<AgentRoutingService, "route">;
  private readonly localToolExecutionService: {
    tryExecute(routing: ToolRoutingDecision): LocalToolExecutionResult | null | Promise<LocalToolExecutionResult | null>;
  };
  private readonly planner: Pick<ResearchPlanner, "buildPlan">;

  constructor(options: ResearchToolServiceOptions = {}) {
    const acquisitionOptions: ResearchAcquisitionServiceOptions = {
      acquisitionMode: options.acquisitionMode,
      fixtureFile: options.fixtureFile,
      sourceCacheEnabled: options.sourceCacheEnabled
    };

    this.decisionPolicyService = options.decisionPolicyService ?? new ResearchDecisionPolicyService();
    this.acquisitionService = new ResearchAcquisitionService(acquisitionOptions);
    this.verifier = options.verifier ?? new ResearchVerifier();
    this.toolRoutingService = options.toolRoutingService ?? new ToolRoutingService();
    this.toolRegistry = options.toolRegistry ?? new ToolRegistry();
    this.toolGapDetectorService = options.toolGapDetectorService ?? new ToolGapDetectorService();
    this.skillRoutingService = options.skillRoutingService ?? new SkillRoutingService();
    this.skillRegistry = options.skillRegistry ?? new SkillRegistry();
    this.agentRoutingService = options.agentRoutingService ?? new AgentRoutingService();
    this.localToolExecutionService =
      options.localToolExecutionService ?? new LocalToolExecutionService();
    this.planner = options.planner ?? new ResearchPlanner();
  }

  async maybeCollect(args: ResearchDecisionArgs): Promise<ResearchToolLog> {
    const toolRouting = this.toolRoutingService.route({
      question: args.question,
      category: args.category
    });
    const skillRouting = await this.skillRoutingService.route({
      question: args.question,
      category: args.category,
      toolRouting
    });
    const agentRouting = await this.agentRoutingService.route({
      question: args.question,
      category: args.category,
      toolRouting,
      skillRouting
    });
    if (skillRouting.skillFound && skillRouting.skillId) {
      await this.skillRegistry.incrementUsage(skillRouting.skillId);
    }
    const policyDecision = await this.decisionPolicyService.decide(args);
    const decision = this.mergeDecisionWithToolRouting(
      args,
      policyDecision,
      toolRouting,
      skillRouting,
      agentRouting
    );

    const localToolResult = await this.localToolExecutionService.tryExecute(toolRouting);
    if (localToolResult) {
      return this.attachToolGapMetadata(
        args.question,
        toolRouting,
        buildToolDirectLog({
          decision,
          routing: toolRouting,
          skillRouting,
          agentRouting,
          verifiedFacts: localToolResult.verifiedFacts,
          summary: localToolResult.summary,
          resultLabel: localToolResult.resultLabel,
          confidenceScore: localToolResult.confidenceScore,
          sources: localToolResult.sources,
          appliedTo: {
            A: args.shouldRefineA,
            B: args.shouldRefineB
          }
        })
      );
    }

    if (toolRouting.toolRequired && this.isDirectLocalTool(toolRouting)) {
      return this.attachToolGapMetadata(
        args.question,
        toolRouting,
        buildRequiredToolFailureLog({
          decision,
          routing: toolRouting,
          skillRouting,
          agentRouting,
          reason: buildLocalToolFailureReason(toolRouting)
        })
      );
    }

    if (toolRouting.toolRequired && this.isExplicitlyUnsupportedToolRoute(toolRouting)) {
      return this.attachToolGapMetadata(
        args.question,
        toolRouting,
        buildRequiredToolFailureLog({
          decision,
          routing: toolRouting,
          skillRouting,
          agentRouting,
          reason: `Required tool path ${toolRouting.toolType}/${toolRouting.intent} is not available in this runtime, so the request cannot be answered safely without tool output.`
        })
      );
    }

    if (!decision.shouldUse || !decision.plan || decision.plan.queries.length === 0) {
      return this.attachToolGapMetadata(args.question, toolRouting, buildEmptyResearchLog(decision));
    }

    const startedAt = Date.now();
    const plan = decision.plan;

    try {
      const acquisition = await this.acquisitionService.collect(plan);

      return this.attachToolGapMetadata(
        args.question,
        toolRouting,
        this.verifier.buildLog({
          decision,
          args,
          searchResults: acquisition.searchResults,
          sources: acquisition.sources,
          startedAt
        })
      );
    } catch (error) {
      logger.warn("Research tool failed", {
        question: args.question,
        category: args.category,
        error: String(error)
      });

      return this.attachToolGapMetadata(
        args.question,
        toolRouting,
        this.verifier.buildFailureLog({
          decision,
          startedAt,
          error
        })
      );
    }
  }

  finalizeImpact(args: ResearchImpactArgs): ResearchToolLog {
    return this.verifier.finalizeImpact(args);
  }

  finalizeRoundAccounting(log: ResearchToolLog, totalRoundMs: number): ResearchToolLog {
    return this.verifier.finalizeRoundAccounting(log, totalRoundMs);
  }

  private mergeDecisionWithToolRouting(
    args: ResearchDecisionArgs,
    decision: ResearchDecision,
    toolRouting: ToolRoutingDecision,
    skillRouting: SkillRoutingDecision,
    agentRouting: AgentRoutingDecision
  ): ResearchDecision {
    if (!toolRouting.toolRequired && !toolRouting.toolRecommended) {
      return {
        ...decision,
        reasons: skillRouting.skillFound || agentRouting.agentFound
          ? [
              ...(agentRouting.agentFound ? [agentRouting.reason] : []),
              ...(skillRouting.skillFound ? [skillRouting.reason] : []),
              ...decision.reasons
            ].slice(0, 6)
          : decision.reasons,
        triggerSignals:
          (skillRouting.skillFound && skillRouting.skillId) || agentRouting.agentFound
          ? [...new Set([
              ...(agentRouting.agentFound && agentRouting.agentId ? [`agent_${agentRouting.agentId}`] : []),
              ...(skillRouting.skillFound && skillRouting.skillId ? [`skill_${skillRouting.skillId}`] : []),
              ...decision.triggerSignals
            ])].slice(0, 8)
          : decision.triggerSignals,
        toolRouting,
        skillRouting,
        agentRouting
      };
    }

    if (!toolRouting.toolRequired) {
      if (toolRouting.toolRecommended && toolRouting.fallbackAllowed === false) {
        return {
          ...decision,
          shouldUse: false,
          reasons: [
            toolRouting.reason,
            ...(agentRouting.agentFound ? [agentRouting.reason] : []),
            ...(skillRouting.skillFound ? [skillRouting.reason] : []),
            "Tool recommendation is blocked because the required user-provided input or private data is missing.",
            ...decision.reasons
          ].slice(0, 6),
          triggerSignals: [...new Set([
            `tool_recommended_${toolRouting.toolType}`,
            `tool_intent_${toolRouting.intent}`,
            "missing_user_input",
            ...(agentRouting.agentFound && agentRouting.agentId ? [`agent_${agentRouting.agentId}`] : []),
            ...(skillRouting.skillFound && skillRouting.skillId ? [`skill_${skillRouting.skillId}`] : []),
            ...decision.triggerSignals
          ])].slice(0, 8),
          expectedValue: "low",
          expectedCostMs: 0,
          plan: null,
          toolRouting,
          skillRouting,
          agentRouting
        };
      }

      return {
        ...decision,
        reasons: [
          toolRouting.reason,
          ...(agentRouting.agentFound ? [agentRouting.reason] : []),
          ...(skillRouting.skillFound ? [skillRouting.reason] : []),
          ...decision.reasons
        ].slice(0, 6),
        triggerSignals: [...new Set([
          `tool_recommended_${toolRouting.toolType}`,
          `tool_intent_${toolRouting.intent}`,
          ...(agentRouting.agentFound && agentRouting.agentId ? [`agent_${agentRouting.agentId}`] : []),
          ...(skillRouting.skillFound && skillRouting.skillId ? [`skill_${skillRouting.skillId}`] : []),
          ...decision.triggerSignals
        ])].slice(0, 8),
        toolRouting,
        skillRouting,
        agentRouting
      };
    }

    const directToolOnly = this.isDirectLocalTool(toolRouting);
    const plan =
      directToolOnly
        ? null
        : this.isExplicitlyUnsupportedToolRoute(toolRouting) &&
      toolRouting.intent !== "github_repo_lookup"
          ? null
          : this.planner.buildPlan(
              args,
              decision.knowledgeStrategy,
              args.orchestration ?? null,
              toolRouting
            );

    return {
      ...decision,
      shouldUse: true,
      reasons: [
        `Tool-first routing requires ${toolRouting.toolType}/${toolRouting.intent}: ${toolRouting.reason}`,
        ...(agentRouting.agentFound ? [agentRouting.reason] : []),
        ...(skillRouting.skillFound ? [skillRouting.reason] : []),
        ...decision.reasons
      ].slice(0, 6),
      triggerSignals: [...new Set([
        `tool_required_${toolRouting.toolType}`,
        `tool_intent_${toolRouting.intent}`,
        ...(agentRouting.agentFound && agentRouting.agentId ? [`agent_${agentRouting.agentId}`] : []),
        ...(skillRouting.skillFound && skillRouting.skillId ? [`skill_${skillRouting.skillId}`] : []),
        ...decision.triggerSignals
      ])].slice(0, 8),
      expectedValue: "high",
      expectedCostMs: plan ? RESEARCH_MODE_COST_MS[plan.mode] : 0,
      plan,
      toolRouting,
      skillRouting,
      agentRouting
    };
  }

  private isExplicitlyUnsupportedToolRoute(routing: ToolRoutingDecision) {
    return [
      "repo_analysis",
      "file_analysis",
      "run_tests",
      "generate_file"
    ].includes(routing.intent);
  }

  private isDirectLocalTool(routing: ToolRoutingDecision) {
    return (
      (routing.toolType === "time" &&
        (routing.intent === "current_time" || routing.intent === "current_date")) ||
      (routing.toolType === "weather" && routing.intent === "current_weather") ||
      (routing.toolType === "finance" && routing.intent === "current_price") ||
      (routing.toolType === "web" && routing.intent === "latest_release") ||
      (routing.toolType === "repo" && routing.intent === "repo_analysis") ||
      (routing.toolType === "calculator" &&
        (routing.intent === "arithmetic" ||
          routing.intent === "unit_conversion" ||
          routing.intent === "currency_conversion"))
    );
  }

  private async attachToolGapMetadata(
    question: string,
    routing: ToolRoutingDecision,
    log: ResearchToolLog
  ): Promise<ResearchToolLog> {
    if (routing.intent === "none" || routing.toolType === "none") {
      return log;
    }

    const existingTools = await this.toolRegistry.findToolsByIntent(routing.intent);
    const gap = this.toolGapDetectorService.detectFromRequest({
      question,
      routing,
      researchLog: log,
      existingTools
    });
    const matchingManifest = existingTools[0] ?? null;

    return {
      ...log,
      toolGapDetected: gap?.detected ?? false,
      toolCandidateCreated: matchingManifest !== null,
      toolCandidateId: matchingManifest?.candidateId ?? matchingManifest?.id ?? null,
      missingCapabilityReason: gap?.reason ?? null
    };
  }
}

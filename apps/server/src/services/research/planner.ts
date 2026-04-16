import type {
  OrchestrationPolicyDetails,
  QuestionCategory
} from "../../types/arena.js";
import type { KnowledgeCategoryStrategy } from "../../types/knowledge.js";
import type { ResearchDecisionArgs, SearchPlan } from "./common.js";
import {
  CATEGORY_SUFFIX,
  extractLiteralTokens,
  extractTerms,
  formatQueryTerm,
  normalizeSpace,
  stripQuestionNoise,
  TERM_DOMAIN_HINTS,
  uniqueStrings
} from "./common.js";

export class ResearchPlanner {
  buildPlan(
    args: ResearchDecisionArgs,
    strategy: KnowledgeCategoryStrategy | null,
    orchestration: OrchestrationPolicyDetails | null
  ): SearchPlan {
    const combinedText = `${args.question} ${args.respondentA.answer} ${args.respondentB.answer} ${args.redTeam.potentially_false_claims.join(" ")}`;
    const signalHints = this.collectSignalHints(combinedText);
    const preferredDomains = uniqueStrings(signalHints.flatMap((hint) => hint.domains));
    const signalTerms = uniqueStrings(signalHints.map((hint) => hint.canonical));
    const questionTerms = extractTerms(stripQuestionNoise(args.question)).slice(0, 6);
    const literalTokens = extractLiteralTokens(
      `${args.question} ${args.redTeam.potentially_false_claims.join(" ")}`
    );
    const factFocusTerms = uniqueStrings([
      ...extractTerms(args.redTeam.potentially_false_claims.join(" "))
        .filter((term) => questionTerms.includes(term) || signalTerms.includes(term))
        .slice(0, 4),
      ...extractTerms(args.redTeam.shared_risks.join(" "))
        .filter((term) => questionTerms.includes(term) || signalTerms.includes(term))
        .slice(0, 3),
      ...literalTokens
    ]).slice(0, 5);
    const requiredTerms = uniqueStrings([...signalTerms, ...questionTerms, ...factFocusTerms]).slice(
      0,
      8
    );
    const baseQuestion = normalizeSpace(args.question.replace(/[?]/g, ""));
    const queryTerms = uniqueStrings([...signalTerms, ...literalTokens, ...questionTerms])
      .slice(0, 6)
      .map((term) => formatQueryTerm(term))
      .filter(Boolean);
    const coreTopic = queryTerms.join(" ") || baseQuestion;
    const standardsQuery =
      preferredDomains.length === 0
        ? `${coreTopic} ${CATEGORY_SUFFIX[args.category]} documentation reference standard`
        : coreTopic;
    const primaryFocus = formatQueryTerm(
      signalTerms[0] ?? literalTokens[0] ?? questionTerms[0] ?? baseQuestion
    );
    const factFocusQuery = factFocusTerms.map((term) => formatQueryTerm(term)).join(" ");

    const withDomains = (query: string, focusSuffix: string) =>
      preferredDomains.length > 0
        ? [
            ...preferredDomains
              .slice(0, 2)
              .map((domain) => `${primaryFocus} ${focusSuffix} site:${domain}`),
            query
          ]
        : [query];

    const strategyMode = this.selectModeForStrategy(args.category, strategy);
    const orchestrationMode = this.selectModeForOrchestration(
      strategyMode,
      args.category,
      orchestration
    );
    const strategyReasoning = strategy
      ? `${strategy.note} Tool recommendation: ${strategy.toolRecommendation}.`
      : "Using category-default research behavior because no knowledge layer strategy was available.";
    const orchestrationReasoning = orchestration
      ? `Orchestration focus ${orchestration.focus}; research policy ${orchestration.researchPolicy}; cost policy ${orchestration.costPolicy}.`
      : "No orchestration policy available.";

    switch (args.category) {
      case "technical_explanation":
        return {
          intent: "definition",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official documentation reference ${factFocusQuery}`,
              "documentation reference"
            ).concat(preferredDomains.length === 0 ? [`${standardsQuery} rfc mdn`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Technical explanation benefits from documentation-grade definitions and precise factual distinctions. ${strategyReasoning} ${orchestrationReasoning}`
        };
      case "debug_diagnostic":
        return {
          intent: "diagnostic_docs",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} troubleshooting documentation ${factFocusQuery}`,
              "troubleshooting documentation"
            ).concat(preferredDomains.length === 0 ? [`${coreTopic} error reference troubleshooting`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Debug diagnostics only benefit from grounding when the issue maps to concrete product behavior or documented errors. ${strategyReasoning} ${orchestrationReasoning}`
        };
      case "mixed_reasoning":
        return {
          intent: "fact_check",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} documentation examples ${factFocusQuery}`,
              "documentation reference"
            ).concat(preferredDomains.length === 0 ? [`${standardsQuery} examples`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Mixed reasoning needs verification only for the factual subpart, not for the whole reasoning chain. ${strategyReasoning} ${orchestrationReasoning}`
        };
      case "incident_response":
        return {
          intent: "incident_guidance",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official incident response guidance ${factFocusQuery}`,
              "official incident response guidance"
            ).concat(preferredDomains.length === 0 ? [`${coreTopic} official policy guidance`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Incident response research should verify provider-, standard-, or policy-specific claims only. ${strategyReasoning} ${orchestrationReasoning}`
        };
      case "architecture_design":
        return {
          intent: "constraint_check",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} architecture constraints documentation ${factFocusQuery}`,
              "constraints documentation"
            ).concat(
              preferredDomains.length === 0
                ? [`${coreTopic} limits throughput latency failover documentation`]
                : []
            )
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Architecture research should verify hard constraints and concrete platform behaviors, not fetch generic design advice. ${strategyReasoning} ${orchestrationReasoning}`
        };
      case "product_strategy":
        return {
          intent: "metric_verification",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} market metrics adoption benchmark ${factFocusQuery}`,
              "benchmark adoption metrics"
            ).concat(preferredDomains.length === 0 ? [`${coreTopic} benchmark report adoption metrics`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Product strategy research should only verify external claims, not replace strategic judgment. ${strategyReasoning} ${orchestrationReasoning}`
        };
      case "operational_writing":
        return {
          intent: "fact_check",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official communication policy ${factFocusQuery}`,
              "official communication guidance"
            ).concat(
              preferredDomains.length === 0
                ? [`${coreTopic} official incident communication guidance`]
                : []
            )
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Operational writing research should only validate required facts, chronology, or official wording. ${strategyReasoning} ${orchestrationReasoning}`
        };
      case "other":
      default:
        return {
          intent: "fact_check",
          mode: orchestrationMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official guidance ${factFocusQuery}`,
              "official guidance"
            ).concat(preferredDomains.length === 0 ? [`${standardsQuery}`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `General research should stay focused on externally verifiable claims. ${strategyReasoning} ${orchestrationReasoning}`
        };
    }
  }

  private collectSignalHints(text: string) {
    return TERM_DOMAIN_HINTS.flatMap((hint) =>
      hint.pattern.test(text)
        ? [
            {
              canonical: hint.canonical,
              domains: hint.domains
            }
          ]
        : []
    );
  }

  private selectModeForStrategy(
    category: QuestionCategory,
    strategy: KnowledgeCategoryStrategy | null
  ) {
    if (!strategy) {
      switch (category) {
        case "technical_explanation":
        case "debug_diagnostic":
          return "targeted_verify" as const;
        case "architecture_design":
          return "constraint_check" as const;
        case "mixed_reasoning":
          return "verify_factual_subpart" as const;
        default:
          return "fact_check_only" as const;
      }
    }

    switch (strategy.toolRecommendation) {
      case "prefer_grounded":
        if (category === "mixed_reasoning") {
          return "verify_factual_subpart" as const;
        }
        return category === "architecture_design" ? "constraint_check" : "targeted_verify";
      case "verify_only":
        return category === "architecture_design" ? "constraint_check" : "fact_check_only";
      case "conditional":
        if (category === "mixed_reasoning") {
          return "verify_factual_subpart" as const;
        }
        if (category === "architecture_design") {
          return "constraint_check" as const;
        }
        return category === "technical_explanation" || category === "debug_diagnostic"
          ? "targeted_verify"
          : "fact_check_only";
      case "avoid":
      default:
        return "fact_check_only" as const;
    }
  }

  private selectModeForOrchestration(
    defaultMode: SearchPlan["mode"],
    category: QuestionCategory,
    orchestration: OrchestrationPolicyDetails | null
  ): SearchPlan["mode"] {
    if (!orchestration) {
      return defaultMode;
    }

    switch (orchestration.researchPolicy) {
      case "targeted":
        return category === "architecture_design" ? "constraint_check" : "targeted_verify";
      case "verify_only":
        return category === "architecture_design" ? "constraint_check" : "fact_check_only";
      case "ground_if_needed":
        return category === "mixed_reasoning" ? "verify_factual_subpart" : defaultMode;
      case "off":
      default:
        return defaultMode;
    }
  }
}

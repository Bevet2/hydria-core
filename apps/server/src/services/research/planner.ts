import type {
  OrchestrationPolicyDetails,
  QuestionCategory
} from "../../types/arena.js";
import type { KnowledgeCategoryStrategy } from "../../types/knowledge.js";
import type { ResearchDecisionArgs, SearchPlan } from "./common.js";
import {
  CATEGORY_SUFFIX,
  extractFocusTerms,
  extractLiteralTokens,
  extractTerms,
  formatQueryTerm,
  normalizeSpace,
  stripQuestionNoise,
  uniqueStrings
} from "./common.js";
import {
  describeTemporalWindow,
  detectTemporalQuery,
  formatIsoDayForSearch
} from "./temporal.js";
import { TERM_DOMAIN_HINTS } from "./trust.js";

export class ResearchPlanner {
  buildPlan(
    args: ResearchDecisionArgs,
    strategy: KnowledgeCategoryStrategy | null,
    orchestration: OrchestrationPolicyDetails | null
  ): SearchPlan {
    const temporalProfile = detectTemporalQuery(args.question);
    const combinedText = `${args.question} ${args.respondentA.answer} ${args.respondentB.answer} ${args.redTeam.potentially_false_claims.join(" ")}`;
    const signalHints = this.collectSignalHints(combinedText);
    const preferredDomains = uniqueStrings(signalHints.flatMap((hint) => hint.domains));
    const signalTerms = uniqueStrings(signalHints.map((hint) => hint.canonical));
    const questionTerms = extractTerms(stripQuestionNoise(args.question)).slice(0, 6);
    const currentStatusRoleTerms =
      temporalProfile.queryType === "current_status"
        ? this.extractCurrentStatusRoleTerms(args.question)
        : [];
    const literalTokens = extractLiteralTokens(
      `${args.question} ${args.redTeam.potentially_false_claims.join(" ")}`
    );
    const factFocusTerms = uniqueStrings([
      ...currentStatusRoleTerms,
      ...extractTerms(args.redTeam.potentially_false_claims.join(" "))
        .filter((term) => questionTerms.includes(term) || signalTerms.includes(term))
        .slice(0, 4),
      ...extractTerms(args.redTeam.shared_risks.join(" "))
        .filter((term) => questionTerms.includes(term) || signalTerms.includes(term))
        .slice(0, 3),
      ...literalTokens
    ]).slice(0, 5);
    const requiredTerms = uniqueStrings([
      ...signalTerms,
      ...questionTerms,
      ...currentStatusRoleTerms,
      ...factFocusTerms
    ]).slice(0, 8);
    const baseQuestion = normalizeSpace(args.question.replace(/[?]/g, ""));
    const queryTerms = uniqueStrings([...signalTerms, ...literalTokens, ...questionTerms])
      .slice(0, 6)
      .map((term) => formatQueryTerm(term))
      .filter(Boolean);
    const coreTopic = queryTerms.join(" ") || baseQuestion;
    const temporalSubject = temporalProfile.isTemporal
      ? this.buildTemporalSubject({
          question: args.question,
          signalTerms,
          literalTokens,
          questionTerms,
          factFocusTerms
        })
      : null;
    const entityTerms = this.buildEntityTerms({
      question: args.question,
      temporalSubject,
      signalTerms,
      literalTokens,
      questionTerms,
      factFocusTerms
    });
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

    const strategyMode = temporalProfile.isTemporal
      ? ("targeted_verify" as const)
      : this.selectModeForStrategy(args.category, strategy);
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

    if (temporalProfile.isTemporal) {
      return {
        intent: this.selectTemporalIntent(temporalProfile),
        mode: orchestrationMode,
        queries: this.buildTemporalQueries({
          category: args.category,
          coreTopic: temporalSubject ?? coreTopic,
          subject: temporalSubject ?? primaryFocus ?? coreTopic,
          preferredDomains,
          temporalProfile
        }),
        requiredTerms,
        preferredDomains,
        factFocusTerms,
        entityTerms,
        temporalProfile,
        reasoning: `Temporal research requires a freshness-aware retrieval path for ${temporalProfile.queryType.replaceAll("_", " ")}. Anchor verification to ${describeTemporalWindow(temporalProfile) ?? temporalProfile.absoluteDateHint ?? "the current date"} and prefer dated primary sources. ${strategyReasoning} ${orchestrationReasoning}`.trim()
      };
    }

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
          entityTerms,
          temporalProfile,
          reasoning: `Technical explanation benefits from documentation-grade definitions and precise factual distinctions. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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
          entityTerms,
          temporalProfile,
          reasoning: `Debug diagnostics only benefit from grounding when the issue maps to concrete product behavior or documented errors. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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
          entityTerms,
          temporalProfile,
          reasoning: `Mixed reasoning needs verification only for the factual subpart, not for the whole reasoning chain. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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
          entityTerms,
          temporalProfile,
          reasoning: `Incident response research should verify provider-, standard-, or policy-specific claims only. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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
          entityTerms,
          temporalProfile,
          reasoning: `Architecture research should verify hard constraints and concrete platform behaviors, not fetch generic design advice. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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
          entityTerms,
          temporalProfile,
          reasoning: `Product strategy research should only verify external claims, not replace strategic judgment. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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
          entityTerms,
          temporalProfile,
          reasoning: `Operational writing research should only validate required facts, chronology, or official wording. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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
          entityTerms,
          temporalProfile,
          reasoning: `General research should stay focused on externally verifiable claims. ${strategyReasoning} ${orchestrationReasoning}`.trim()
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

  private buildTemporalQueries(args: {
    category: QuestionCategory;
    coreTopic: string;
    subject: string;
    preferredDomains: string[];
    temporalProfile: SearchPlan["temporalProfile"];
  }) {
    const anchor = this.buildTemporalAnchor(args.temporalProfile);
    const categoryTerms = this.buildTemporalCategoryTerms(args.category);

    switch (args.temporalProfile.queryType) {
      case "current_status":
        return this.buildCurrentStatusQueries(
          args.subject,
          anchor,
          categoryTerms,
          args.preferredDomains
        );
      case "recent_updates":
        return this.buildRecentUpdateQueries(
          args.coreTopic,
          anchor,
          categoryTerms,
          args.preferredDomains,
          args.temporalProfile
        );
      case "release_freshness":
        return this.buildReleaseFreshnessQueries(
          args.coreTopic,
          anchor,
          categoryTerms,
          args.preferredDomains
        );
      default:
        return [];
    }
  }

  private buildTemporalAnchor(profile: SearchPlan["temporalProfile"]) {
    if (profile.dateRangeStart && profile.dateRangeEnd) {
      return `${formatIsoDayForSearch(profile.dateRangeStart)} ${formatIsoDayForSearch(profile.dateRangeEnd)}`;
    }

    return profile.absoluteDateHint ?? "";
  }

  private buildTemporalCategoryTerms(category: QuestionCategory) {
    switch (category) {
      case "technical_explanation":
        return "official documentation reference release notes";
      case "debug_diagnostic":
        return "official troubleshooting advisory status";
      case "incident_response":
        return "official advisory incident update";
      case "architecture_design":
        return "official documentation limits release notes";
      case "product_strategy":
        return "official report announcement benchmark";
      case "operational_writing":
        return "official statement communication update";
      case "mixed_reasoning":
        return "official documentation announcement";
      case "other":
      default:
        return "official guidance announcement";
    }
  }

  private selectTemporalIntent(profile: SearchPlan["temporalProfile"]): SearchPlan["intent"] {
    switch (profile.queryType) {
      case "current_status":
        return "current_status";
      case "recent_updates":
        return "recent_updates";
      case "release_freshness":
        return "release_freshness";
      default:
        return "fact_check";
    }
  }

  private buildCurrentStatusQueries(
    subject: string,
    anchor: string,
    categoryTerms: string,
    preferredDomains: string[]
  ) {
    const domainQueries = preferredDomains.slice(0, 2).map((domain) =>
      normalizeSpace(`${subject} current official ${anchor} site:${domain}`)
    );

    return uniqueStrings(
      [
        ...domainQueries,
        `${subject} current official ${anchor}`,
        `${subject} as of ${anchor} official`,
        `${subject} current status official ${categoryTerms}`
      ].map((query) => normalizeSpace(query))
    ).slice(0, 3);
  }

  private buildRecentUpdateQueries(
    coreTopic: string,
    anchor: string,
    categoryTerms: string,
    preferredDomains: string[],
    temporalProfile: SearchPlan["temporalProfile"]
  ) {
    const windowPhrase =
      temporalProfile.focus === "this_week"
        ? "this week"
        : temporalProfile.focus === "this_month"
          ? "this month"
          : "recent";
    const domainQueries = preferredDomains.slice(0, 2).map((domain) =>
      normalizeSpace(`${coreTopic} ${windowPhrase} announcements ${anchor} site:${domain}`)
    );

    return uniqueStrings(
      [
        ...domainQueries,
        `${coreTopic} ${windowPhrase} updates ${anchor}`,
        `${coreTopic} recent announcements ${anchor}`,
        `${coreTopic} latest updates ${anchor} ${categoryTerms}`
      ].map((query) => normalizeSpace(query))
    ).slice(0, 3);
  }

  private buildReleaseFreshnessQueries(
    coreTopic: string,
    anchor: string,
    categoryTerms: string,
    preferredDomains: string[]
  ) {
    const domainQueries = preferredDomains.slice(0, 2).map((domain) =>
      normalizeSpace(`${coreTopic} latest release official ${anchor} site:${domain}`)
    );

    return uniqueStrings(
      [
        ...domainQueries,
        `${coreTopic} latest release official ${anchor}`,
        `${coreTopic} latest version official ${anchor}`,
        `${coreTopic} release notes changelog ${anchor} ${categoryTerms}`
      ].map((query) => normalizeSpace(query))
    ).slice(0, 3);
  }

  private buildTemporalSubject(args: {
    question: string;
    signalTerms: string[];
    literalTokens: string[];
    questionTerms: string[];
    factFocusTerms: string[];
  }) {
    const strippedQuestion = normalizeSpace(
      args.question
        .replace(/[?]/g, " ")
        .replace(/\bwhat recent updates were announced for\b/gi, " ")
        .replace(/\bwhat recent updates were announced\b/gi, " ")
        .replace(/\bwhat were the main\b/gi, " ")
        .replace(/\bwhat were the recent\b/gi, " ")
        .replace(/\bwhat were the\b/gi, " ")
        .replace(/\bwhat are the latest\b/gi, " ")
        .replace(/\bwhat is the latest\b/gi, " ")
        .replace(/\bwhat is the current\b/gi, " ")
        .replace(/\b(?:who is|who are|what is|what are|what was|what were|show me|tell me|give me|list|summarize)\b/gi, " ")
        .replace(/\b(?:main|current|currently|latest|newest|most recent|recent|recently|today|right now|this week|this month|as of|announced|announcement|announcements|released|release|releases|release notes|updates?|version|major|new)\b/gi, " ")
        .replace(/\b(?:official|status)\b/gi, " ")
    );
    const candidate = normalizeSpace(
      strippedQuestion
        .replace(/\s+/g, " ")
        .replace(/^(?:the|a|an|for|of|about|on)\s+/i, "")
        .replace(/\s+(?:for|of|about|on)$/i, "")
    );
    if (candidate.length >= 3) {
      return candidate;
    }

    const fallbackTerms = uniqueStrings([
      ...args.factFocusTerms,
      ...args.signalTerms,
      ...args.literalTokens,
      ...args.questionTerms
    ]).filter(
      (term) =>
        ![
          "current",
          "latest",
          "recent",
          "updates",
          "update",
          "main",
          "release",
          "releases",
          "version",
          "today"
        ].includes(term.toLowerCase())
    );

    return fallbackTerms.slice(0, 3).join(" ");
  }

  private buildEntityTerms(args: {
    question: string;
    temporalSubject: string | null;
    signalTerms: string[];
    literalTokens: string[];
    questionTerms: string[];
    factFocusTerms: string[];
  }) {
    return uniqueStrings([
      ...extractFocusTerms(args.temporalSubject ?? ""),
      ...args.signalTerms.flatMap((term) => extractFocusTerms(term)),
      ...args.literalTokens.flatMap((term) => extractFocusTerms(term)),
      ...args.questionTerms.flatMap((term) => extractFocusTerms(term)),
      ...args.factFocusTerms.flatMap((term) => extractFocusTerms(term)),
      ...extractFocusTerms(args.question)
    ]).slice(0, 8);
  }

  private extractCurrentStatusRoleTerms(question: string) {
    const lowered = question.toLowerCase();
    const roleTerms: string[] = [];

    const patterns: Array<{ pattern: RegExp; term: string }> = [
      { pattern: /\bceo\b|chief executive officer/i, term: "ceo" },
      { pattern: /\bcto\b|chief technology officer/i, term: "cto" },
      { pattern: /\bcfo\b|chief financial officer/i, term: "cfo" },
      { pattern: /\bcpo\b|chief product officer|chief people officer/i, term: "cpo" },
      { pattern: /\bchief scientist\b/i, term: "chief scientist" },
      { pattern: /\bchief economist\b/i, term: "chief economist" },
      { pattern: /\bpresident\b/i, term: "president" },
      { pattern: /\bfounder\b|co-founder/i, term: "founder" },
      { pattern: /\bchair\b|chairman|chairwoman/i, term: "chair" },
      { pattern: /\bleadership\b/i, term: "leadership" },
      { pattern: /\bboard\b/i, term: "board" }
    ];

    for (const entry of patterns) {
      if (entry.pattern.test(lowered)) {
        roleTerms.push(entry.term);
      }
    }

    return uniqueStrings(roleTerms).slice(0, 4);
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

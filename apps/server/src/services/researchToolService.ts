import { load } from "cheerio";
import type {
  QuestionCategory,
  RedTeamOutput,
  ResearchDecisionMode,
  ResearchExpectedValue,
  ResearchIntent,
  ResearchNetImpact,
  ResearchSource,
  ResearchToolLog,
  RespondentOutput
} from "../types/arena.js";
import type { KnowledgeCategoryInsight, KnowledgeCategoryStrategy } from "../types/knowledge.js";
import { logger } from "../utils/logger.js";
import { KnowledgeLayerService } from "./knowledgeLayerService.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36";

const CATEGORY_SUFFIX: Record<QuestionCategory, string> = {
  incident_response: "incident response best practices security operations",
  architecture_design: "software architecture tradeoffs reliability scalability",
  technical_explanation: "official documentation explanation examples",
  debug_diagnostic: "debugging troubleshooting root cause investigation",
  product_strategy: "product strategy adoption metrics prioritization",
  operational_writing: "incident update postmortem engineering communication",
  mixed_reasoning: "tradeoffs decision examples explanation",
  other: "official guidance examples"
};

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "already",
  "although",
  "always",
  "because",
  "being",
  "between",
  "could",
  "during",
  "every",
  "first",
  "found",
  "from",
  "have",
  "into",
  "itself",
  "might",
  "other",
  "should",
  "their",
  "there",
  "these",
  "those",
  "under",
  "using",
  "where",
  "which",
  "while",
  "would",
  "your",
  "neither",
  "either",
  "request",
  "requests",
  "response",
  "responses",
  "question",
  "questions",
  "together"
]);

const LOW_TRUST_DOMAIN_PATTERNS = [
  /stackoverflow\.com$/i,
  /stackexchange\.com$/i,
  /reddit\.com$/i,
  /quora\.com$/i,
  /linkedin\.com$/i,
  /medium\.com$/i,
  /substack\.com$/i,
  /dev\.to$/i,
  /fastercapital\.com$/i,
  /aalpha\.net$/i,
  /beefed\.ai$/i,
  /eleken\.co$/i,
  /truefoundry\.com$/i
];

const DOC_HINT_PATTERNS = [
  /\bdocs?\b/i,
  /\bdocumentation\b/i,
  /\breference\b/i,
  /\bguide\b/i,
  /\bmanual\b/i,
  /\bofficial\b/i
];

const OFFICIAL_DOMAIN_PATTERNS = [
  /\.gov$/i,
  /\.edu$/i,
  /(^|\.)ietf\.org$/i,
  /(^|\.)rfc-editor\.org$/i,
  /(^|\.)apache\.org$/i,
  /(^|\.)w3\.org$/i,
  /(^|\.)whatwg\.org$/i,
  /(^|\.)docs\./i,
  /(^|\.)developer\./i,
  /(^|\.)developers\./i,
  /(^|\.)learn\./i,
  /(^|\.)web\.dev$/i,
  /(^|\.)nodejs\.org$/i,
  /(^|\.)expressjs\.com$/i,
  /(^|\.)postgresql\.org$/i,
  /(^|\.)mysql\.com$/i,
  /(^|\.)mongodb\.com$/i,
  /(^|\.)redis\.io$/i,
  /(^|\.)kubernetes\.io$/i,
  /(^|\.)cloud\.google\.com$/i,
  /(^|\.)docs\.aws\.amazon\.com$/i,
  /(^|\.)learn\.microsoft\.com$/i,
  /(^|\.)developers\.cloudflare\.com$/i,
  /(^|\.)oauth\.net$/i,
  /(^|\.)jwt\.io$/i,
  /(^|\.)europa\.eu$/i,
  /(^|\.)hhs\.gov$/i,
  /(^|\.)pcisecuritystandards\.org$/i,
  /(^|\.)csrc\.nist\.gov$/i,
  /(^|\.)nist\.gov$/i
];

const COMMUNITY_PATH_PATTERNS = [
  /\/blog\//i,
  /\/community\//i,
  /\/forum/i,
  /\/forums\//i,
  /\/discuss\//i,
  /\/questions\//i,
  /\/learn\//i
];

const SEARCH_ENGINE_HOST_PATTERNS = [
  /(^|\.)duckduckgo\.com$/i,
  /(^|\.)bing\.com$/i,
  /(^|\.)search\.yahoo\.com$/i
];

const TERM_DOMAIN_HINTS: Array<{
  pattern: RegExp;
  canonical: string;
  domains: string[];
}> = [
  { pattern: /\bnode\.?js\b/i, canonical: "node.js", domains: ["nodejs.org"] },
  { pattern: /\bexpress\b/i, canonical: "express", domains: ["expressjs.com"] },
  { pattern: /\bkafka\b/i, canonical: "kafka", domains: ["kafka.apache.org", "confluent.io"] },
  { pattern: /\bpostgres(?:ql)?\b/i, canonical: "postgresql", domains: ["postgresql.org"] },
  { pattern: /\bmysql\b/i, canonical: "mysql", domains: ["mysql.com"] },
  { pattern: /\bmongodb\b/i, canonical: "mongodb", domains: ["mongodb.com"] },
  { pattern: /\bredis\b/i, canonical: "redis", domains: ["redis.io"] },
  { pattern: /\bkubernetes\b/i, canonical: "kubernetes", domains: ["kubernetes.io"] },
  { pattern: /\bdocker\b/i, canonical: "docker", domains: ["docs.docker.com"] },
  { pattern: /\baws\b/i, canonical: "aws", domains: ["docs.aws.amazon.com"] },
  { pattern: /\bazure\b/i, canonical: "azure", domains: ["learn.microsoft.com"] },
  { pattern: /\bgcp\b|\bgoogle cloud\b/i, canonical: "google cloud", domains: ["cloud.google.com"] },
  { pattern: /\bcloudflare\b/i, canonical: "cloudflare", domains: ["developers.cloudflare.com"] },
  { pattern: /\boauth\b/i, canonical: "oauth", domains: ["datatracker.ietf.org", "oauth.net"] },
  { pattern: /\bjwt\b/i, canonical: "jwt", domains: ["datatracker.ietf.org", "jwt.io"] },
  { pattern: /\bsaml\b/i, canonical: "saml", domains: ["docs.oasis-open.org"] },
  { pattern: /\brfc\b/i, canonical: "rfc", domains: ["rfc-editor.org", "datatracker.ietf.org"] },
  { pattern: /\bidempoten/i, canonical: "idempotency", domains: ["developer.mozilla.org", "rfc-editor.org", "datatracker.ietf.org"] },
  { pattern: /\brate limit/i, canonical: "rate limiting", domains: ["developer.mozilla.org", "cloud.google.com", "docs.aws.amazon.com"] },
  { pattern: /\bcaching?\b/i, canonical: "caching", domains: ["developer.mozilla.org", "web.dev", "redis.io"] },
  { pattern: /\bfeature flags?\b/i, canonical: "feature flags", domains: ["launchdarkly.com", "docs.getunleash.io"] },
  { pattern: /\beventual consistency\b/i, canonical: "eventual consistency", domains: ["learn.microsoft.com", "docs.aws.amazon.com"] },
  { pattern: /\bcap theorem\b/i, canonical: "cap theorem", domains: ["learn.microsoft.com", "cloud.google.com"] },
  { pattern: /\bnist\b/i, canonical: "nist", domains: ["nist.gov", "csrc.nist.gov"] },
  { pattern: /\bgdpr\b/i, canonical: "gdpr", domains: ["europa.eu"] },
  { pattern: /\bhipaa\b/i, canonical: "hipaa", domains: ["hhs.gov"] },
  { pattern: /\bpci\b/i, canonical: "pci", domains: ["pcisecuritystandards.org"] }
];

const RESEARCH_MODE_COST_MS: Record<ResearchDecisionMode, number> = {
  off: 0,
  targeted_verify: 2600,
  constraint_check: 2200,
  fact_check_only: 1800,
  verify_factual_subpart: 2100
};

type ResearchDecisionArgs = {
  question: string;
  category: QuestionCategory;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
  shouldRefineA: boolean;
  shouldRefineB: boolean;
};

type SearchCandidate = {
  title: string;
  url: string;
  snippet: string;
};

type ScoredCandidate = {
  candidate: SearchCandidate;
  score: number;
  trustScore: number;
};

type SearchPlan = {
  intent: ResearchIntent;
  mode: ResearchDecisionMode;
  queries: string[];
  requiredTerms: string[];
  preferredDomains: string[];
  factFocusTerms: string[];
  reasoning: string;
};

type ResearchDecision = {
  shouldUse: boolean;
  reasons: string[];
  triggerSignals: string[];
  targetClaims: string[];
  expectedValue: ResearchExpectedValue;
  expectedCostMs: number;
  knowledgeStrategy: KnowledgeCategoryStrategy | null;
  plan: SearchPlan | null;
};

type ResearchImpactArgs = {
  log: ResearchToolLog;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  refineA: { improved_answer: string; fixes_applied: string[] };
  refineB: { improved_answer: string; fixes_applied: string[] };
};

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((entry) => normalizeSpace(entry))
    .filter((entry) => entry.length >= 30);
}

function extractTerms(value: string) {
  const counts = new Map<string, number>();
  for (const token of value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)) {
    if (token.length < 6 || STOPWORDS.has(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([term]) => term);
}

function buildEmptyResearchLog(decision: ResearchDecision): ResearchToolLog {
  const emptyPlan = {
    intent: "fact_check" as const,
    queries: [],
    selectedQuery: null,
    requiredTerms: [],
    preferredDomains: [],
    factFocusTerms: []
  };

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
    queryPlan: emptyPlan,
    query: null,
    reasons: decision.reasons,
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: []
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

function hasUncertaintySignals(respondent: RespondentOutput) {
  const joined = `${respondent.answer} ${respondent.assumptions.join(" ")}`.toLowerCase();
  const patterns = [
    "assum",
    "depends",
    "generic",
    "without context",
    "uncertain",
    "varies",
    "if applicable",
    "not provided"
  ];

  return patterns.reduce(
    (count, pattern) => count + (joined.includes(pattern) ? 1 : 0),
    0
  );
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function countRegexMatches(value: string, pattern: RegExp) {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stripQuestionNoise(value: string) {
  return normalizeSpace(
    value
      .replace(/[?]/g, " ")
      .replace(/\b(?:design|propose|write|explain|describe|how would you|what are|what is)\b/gi, " ")
  );
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getPathname(url: string) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function stripSiteOperators(query: string) {
  return normalizeSpace(query.replace(/\s+site:[^\s]+/gi, " "));
}

function formatQueryTerm(term: string) {
  const normalized = normalizeSpace(term);
  if (!normalized) {
    return "";
  }

  return /\s/.test(normalized) ? `"${normalized}"` : normalized;
}

function extractLiteralTokens(value: string) {
  return uniqueStrings(
    (value.match(/\b(?:\d{3}|oauth|jwt|saml|rfc|nist|gdpr|hipaa|pci|soc ?2)\b/gi) ?? []).map(
      (entry) => normalizeSpace(entry.toLowerCase())
    )
  );
}

export class ResearchToolService {
  private readonly knowledgeLayerService = new KnowledgeLayerService();
  private knowledgeLayerPromise: Promise<Awaited<ReturnType<KnowledgeLayerService["loadKnowledgeLayer"]>>> | null =
    null;

  async maybeCollect(args: ResearchDecisionArgs): Promise<ResearchToolLog> {
    const decision = await this.decide(args);
    if (!decision.shouldUse || !decision.plan || decision.plan.queries.length === 0) {
      return buildEmptyResearchLog(decision);
    }

    const startedAt = Date.now();

    try {
      const searchResults = await this.searchAll(decision.plan);
      const sources = await this.extractSources(searchResults.slice(0, 3), decision.plan);
      const sourceTexts = sources.map((source) => `${source.snippet} ${source.excerpt}`).join(" ");
      const corroboratedSignals = extractTerms(sourceTexts)
        .filter((term) => sources.filter((source) => source.excerpt.toLowerCase().includes(term)).length >= 2)
        .slice(0, 6);

      const summary = sources
        .map((source) => `${source.title}: ${splitSentences(source.excerpt)[0] ?? source.snippet}`)
        .map((entry) => normalizeSpace(entry))
        .slice(0, 4);

      return {
        considered: true,
        used: sources.length > 0,
        route: sources.length > 0 ? "used" : "failed",
        decision: {
          shouldUse: true,
          mode: decision.plan.mode,
          expectedValue: decision.expectedValue,
          expectedCostMs: decision.expectedCostMs,
          triggerSignals: decision.triggerSignals,
          targetClaims: decision.targetClaims,
          reasoning: decision.plan.reasoning
        },
        queryPlan: {
          intent: decision.plan.intent,
          queries: decision.plan.queries,
          selectedQuery: decision.plan.queries[0] ?? null,
          requiredTerms: decision.plan.requiredTerms,
          preferredDomains: decision.plan.preferredDomains,
          factFocusTerms: decision.plan.factFocusTerms
        },
        query: decision.plan.queries[0] ?? decision.plan.queries.join(" || "),
        reasons: decision.reasons,
        summary,
        sources,
        verification: {
          sourceCount: searchResults.length,
          extractedSourceCount: sources.length,
          corroboratedSignals
        },
        appliedTo: {
          A: args.shouldRefineA && sources.length > 0,
          B: args.shouldRefineB && sources.length > 0
        },
        impact: {
          refineChangedBecauseOfTool: false,
          addedFactsCount: 0,
          correctedClaimsCount: 0,
          sourceBackedClaimsCount: this.countBackedClaims(
            decision.targetClaims,
            sourceTexts,
            sourceTexts
          ),
          costSharePct: 0,
          netImpact: sources.length > 0 ? "neutral" : "negative"
        },
        impactNotes:
          sources.length > 0
            ? [`Research injected ${sources.length} extracted sources into the refine step.`]
            : ["Research was triggered, but no extractable sources were recovered."],
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      logger.warn("Research tool failed", {
        question: args.question,
        category: args.category,
        error: String(error)
      });

      return {
        considered: true,
        used: false,
        route: "failed",
        decision: {
          shouldUse: true,
          mode: decision.plan.mode,
          expectedValue: decision.expectedValue,
          expectedCostMs: decision.expectedCostMs,
          triggerSignals: decision.triggerSignals,
          targetClaims: decision.targetClaims,
          reasoning: decision.plan.reasoning
        },
        queryPlan: {
          intent: decision.plan.intent,
          queries: decision.plan.queries,
          selectedQuery: decision.plan.queries[0] ?? null,
          requiredTerms: decision.plan.requiredTerms,
          preferredDomains: decision.plan.preferredDomains,
          factFocusTerms: decision.plan.factFocusTerms
        },
        query: decision.plan.queries[0] ?? decision.plan.queries.join(" || "),
        reasons: decision.reasons,
        summary: [],
        sources: [],
        verification: {
          sourceCount: 0,
          extractedSourceCount: 0,
          corroboratedSignals: []
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
          netImpact: "negative"
        },
        impactNotes: [`Research failed before refinement: ${String(error)}`],
        durationMs: Date.now() - startedAt
      };
    }
  }

  finalizeImpact(args: ResearchImpactArgs): ResearchToolLog {
    if (!args.log.used) {
      return args.log;
    }

    const sourceTerms = extractTerms(
      [...args.log.summary, ...args.log.sources.map((source) => source.excerpt)].join(" ")
    ).slice(0, 20);
    const beforeText = `${args.respondentA.answer} ${args.respondentB.answer}`;
    const afterText = `${args.refineA.improved_answer} ${args.refineB.improved_answer}`;
    const addedFactsCount = sourceTerms.filter(
      (term) => afterText.toLowerCase().includes(term) && !beforeText.toLowerCase().includes(term)
    ).length;
    const correctedClaimsCount = this.countBackedClaims(
      args.log.decision.targetClaims,
      [...args.log.summary, ...args.log.sources.map((source) => source.excerpt)].join(" "),
      afterText,
      beforeText
    );
    const sourceBackedClaimsCount = this.countBackedClaims(
      args.log.decision.targetClaims,
      [...args.log.summary, ...args.log.sources.map((source) => source.excerpt)].join(" "),
      afterText
    );
    const refineChangedBecauseOfTool =
      addedFactsCount > 0 ||
      correctedClaimsCount > 0 ||
      (sourceBackedClaimsCount > 0 &&
        args.refineA.fixes_applied.length + args.refineB.fixes_applied.length > 0);
    const netImpact: ResearchNetImpact = refineChangedBecauseOfTool ? "positive" : "neutral";

    const impactNotes = [...args.log.impactNotes];
    impactNotes.push(
      ...this.buildSlotImpactNotes(
        "A",
        sourceTerms,
        args.respondentA.answer,
        args.refineA.improved_answer,
        args.refineA.fixes_applied
      )
    );
    impactNotes.push(
      ...this.buildSlotImpactNotes(
        "B",
        sourceTerms,
        args.respondentB.answer,
        args.refineB.improved_answer,
        args.refineB.fixes_applied
      )
    );

    return {
      ...args.log,
      impact: {
        ...args.log.impact,
        refineChangedBecauseOfTool,
        addedFactsCount: Math.min(20, addedFactsCount),
        correctedClaimsCount: Math.min(12, correctedClaimsCount),
        sourceBackedClaimsCount: Math.min(12, sourceBackedClaimsCount),
        netImpact
      },
      impactNotes: impactNotes.slice(0, 12)
    };
  }

  finalizeRoundAccounting(log: ResearchToolLog, totalRoundMs: number): ResearchToolLog {
    const costSharePct =
      totalRoundMs > 0 ? Math.round((log.durationMs / totalRoundMs) * 100) : 0;

    return {
      ...log,
      impact: {
        ...log.impact,
        costSharePct: Math.max(0, Math.min(100, costSharePct))
      }
    };
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

  private buildSlotImpactNotes(
    slot: "A" | "B",
    sourceTerms: string[],
    before: string,
    after: string,
    fixesApplied: string[]
  ) {
    const beforeText = before.toLowerCase();
    const afterText = after.toLowerCase();
    const newTerms = sourceTerms
      .filter((term) => afterText.includes(term) && !beforeText.includes(term))
      .slice(0, 4);

    if (newTerms.length > 0) {
      return [
        `Refine ${slot} incorporated externally sourced signals: ${newTerms.join(", ")}.`
      ];
    }

    if (fixesApplied.length > 0) {
      return [
        `Refine ${slot} had research context available and produced ${fixesApplied.length} concrete fixes.`
      ];
    }

    return [`Refine ${slot} had research context available but showed limited visible source uptake.`];
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

  private countBackedClaims(
    targetClaims: string[],
    sourceText: string,
    afterText: string,
    beforeText = ""
  ) {
    const normalizedSource = sourceText.toLowerCase();
    const normalizedAfter = afterText.toLowerCase();
    const normalizedBefore = beforeText.toLowerCase();

    return targetClaims.filter((claim) => {
      const claimTerms = extractTerms(claim).slice(0, 4);
      if (claimTerms.length === 0) {
        return false;
      }

      const sourceBacked = claimTerms.some((term) => normalizedSource.includes(term));
      if (!sourceBacked) {
        return false;
      }

      const presentAfter = claimTerms.some((term) => normalizedAfter.includes(term));
      const absentBefore =
        beforeText.length === 0 ||
        claimTerms.some((term) => !normalizedBefore.includes(term));

      return presentAfter && absentBefore;
    }).length;
  }

  private derivePlan(
    args: ResearchDecisionArgs,
    strategy: KnowledgeCategoryStrategy | null
  ): SearchPlan {
    const combinedText = `${args.question} ${args.respondentA.answer} ${args.respondentB.answer} ${args.redTeam.potentially_false_claims.join(" ")}`;
    const signalHints = this.collectSignalHints(combinedText);
    const preferredDomains = uniqueStrings(signalHints.flatMap((hint) => hint.domains));
    const signalTerms = uniqueStrings(signalHints.map((hint) => hint.canonical));
    const questionTerms = extractTerms(stripQuestionNoise(args.question)).slice(0, 6);
    const literalTokens = extractLiteralTokens(`${args.question} ${args.redTeam.potentially_false_claims.join(" ")}`);
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
    const coreTopic =
      queryTerms.join(" ") ||
      baseQuestion;
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
    const strategyReasoning = strategy
      ? `${strategy.note} Tool recommendation: ${strategy.toolRecommendation}.`
      : "Using category-default research behavior because no knowledge layer strategy was available.";

    switch (args.category) {
      case "technical_explanation":
        return {
          intent: "definition",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official documentation reference ${factFocusQuery}`,
              "documentation reference"
            )
              .concat(preferredDomains.length === 0 ? [`${standardsQuery} rfc mdn`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Technical explanation benefits from documentation-grade definitions and precise factual distinctions. ${strategyReasoning}`
        };
      case "debug_diagnostic":
        return {
          intent: "diagnostic_docs",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} troubleshooting documentation ${factFocusQuery}`,
              "troubleshooting documentation"
            )
              .concat(preferredDomains.length === 0 ? [`${coreTopic} error reference troubleshooting`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Debug diagnostics only benefit from grounding when the issue maps to concrete product behavior or documented errors. ${strategyReasoning}`
        };
      case "mixed_reasoning":
        return {
          intent: "fact_check",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} documentation examples ${factFocusQuery}`,
              "documentation reference"
            )
              .concat(preferredDomains.length === 0 ? [`${standardsQuery} examples`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Mixed reasoning needs verification only for the factual subpart, not for the whole reasoning chain. ${strategyReasoning}`
        };
      case "incident_response":
        return {
          intent: "incident_guidance",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official incident response guidance ${factFocusQuery}`,
              "official incident response guidance"
            )
              .concat(preferredDomains.length === 0 ? [`${coreTopic} official policy guidance`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Incident response research should verify provider-, standard-, or policy-specific claims only. ${strategyReasoning}`
        };
      case "architecture_design":
        return {
          intent: "constraint_check",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} architecture constraints documentation ${factFocusQuery}`,
              "constraints documentation"
            )
              .concat(preferredDomains.length === 0 ? [`${coreTopic} limits throughput latency failover documentation`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Architecture research should verify hard constraints and concrete platform behaviors, not fetch generic design advice. ${strategyReasoning}`
        };
      case "product_strategy":
        return {
          intent: "metric_verification",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} market metrics adoption benchmark ${factFocusQuery}`,
              "benchmark adoption metrics"
            )
              .concat(preferredDomains.length === 0 ? [`${coreTopic} benchmark report adoption metrics`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Product strategy research should only verify external claims, not replace strategic judgment. ${strategyReasoning}`
        };
      case "operational_writing":
        return {
          intent: "fact_check",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official communication policy ${factFocusQuery}`,
              "official communication guidance"
            )
              .concat(preferredDomains.length === 0 ? [`${coreTopic} official incident communication guidance`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `Operational writing research should only validate required facts, chronology, or official wording. ${strategyReasoning}`
        };
      case "other":
      default:
        return {
          intent: "fact_check",
          mode: strategyMode,
          queries: uniqueStrings(
            withDomains(
              `${coreTopic} official guidance ${factFocusQuery}`,
              "official guidance"
            )
              .concat(preferredDomains.length === 0 ? [`${standardsQuery}`] : [])
          ).slice(0, 3),
          requiredTerms,
          preferredDomains,
          factFocusTerms,
          reasoning: `General research should stay focused on externally verifiable claims. ${strategyReasoning}`
        };
    }
  }

  private selectModeForStrategy(
    category: QuestionCategory,
    strategy: KnowledgeCategoryStrategy | null
  ): ResearchDecisionMode {
    if (!strategy) {
      switch (category) {
        case "technical_explanation":
        case "debug_diagnostic":
          return "targeted_verify";
        case "architecture_design":
          return "constraint_check";
        case "mixed_reasoning":
          return "verify_factual_subpart";
        default:
          return "fact_check_only";
      }
    }

    switch (strategy.toolRecommendation) {
      case "prefer_grounded":
        if (category === "mixed_reasoning") {
          return "verify_factual_subpart";
        }
        return category === "architecture_design" ? "constraint_check" : "targeted_verify";
      case "verify_only":
        return category === "architecture_design" ? "constraint_check" : "fact_check_only";
      case "conditional":
        if (category === "mixed_reasoning") {
          return "verify_factual_subpart";
        }
        if (category === "architecture_design") {
          return "constraint_check";
        }
        return category === "technical_explanation" || category === "debug_diagnostic"
          ? "targeted_verify"
          : "fact_check_only";
      case "avoid":
      default:
        return "fact_check_only";
    }
  }

  private scoreCandidate(candidate: SearchCandidate, plan: SearchPlan) {
    const domain = getHostname(candidate.url);
    const path = getPathname(candidate.url);
    const haystack = `${candidate.title} ${candidate.snippet}`.toLowerCase();
    let score = this.getDomainTrustScore(domain, path, plan);

    if (plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
      score += 20;
    }

    score += Math.min(
      24,
      plan.requiredTerms.reduce(
        (total, term) => total + (term.length >= 4 && haystack.includes(term.toLowerCase()) ? 6 : 0),
        0
      )
    );

    if (DOC_HINT_PATTERNS.some((pattern) => pattern.test(candidate.title))) {
      score += 12;
    }

    if (DOC_HINT_PATTERNS.some((pattern) => pattern.test(candidate.snippet))) {
      score += 6;
    }

    if (
      matchesAny(path, [
        /\/docs?\//i,
        /\/documentation/i,
        /\/reference/i,
        /\/guide/i,
        /\/manual/i,
        /\/troubleshoot/i,
        /\/learn\//i
      ])
    ) {
      score += 10;
    }

    if (matchesAny(path, [/\/blog\//i, /\/news\//i, /\/release/i, /\/releases\//i])) {
      score -= plan.intent === "metric_verification" ? 3 : 8;
    }

    score += Math.min(
      12,
      plan.factFocusTerms.reduce(
        (total, term) => total + (term.length >= 4 && haystack.includes(term.toLowerCase()) ? 4 : 0),
        0
      )
    );

    switch (plan.intent) {
      case "definition":
        if (matchesAny(haystack, [/\bwhat is\b/i, /\bexplained\b/i, /\bguide\b/i])) {
          score += 8;
        }
        break;
      case "diagnostic_docs":
        if (matchesAny(haystack, [/\btroubleshoot\b/i, /\berror\b/i, /\bdebug\b/i])) {
          score += 10;
        }
        break;
      case "constraint_check":
        if (matchesAny(haystack, [/\bscalab/i, /\blatency\b/i, /\bthroughput\b/i, /\bfailover\b/i])) {
          score += 8;
        }
        break;
      case "incident_guidance":
        if (matchesAny(haystack, [/\bincident\b/i, /\bresponse\b/i, /\bbreach\b/i, /\bcredential\b/i])) {
          score += 8;
        }
        break;
      case "metric_verification":
        if (matchesAny(haystack, [/\bmetric\b/i, /\badoption\b/i, /\bbenchmark\b/i, /\broi\b/i])) {
          score += 8;
        }
        break;
      default:
        break;
    }

    return score;
  }

  private getDomainTrustScore(domain: string, path: string, plan: SearchPlan) {
    if (!domain) {
      return -20;
    }

    if (LOW_TRUST_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
      return -35;
    }

    if (plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
      return 55;
    }

    if (OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
      return COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? 20 : 38;
    }

    if (domain.includes("docs.") || domain.includes("developer.") || domain.includes("developers.")) {
      return 26;
    }

    return COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? -8 : 0;
  }

  private buildRelevantExcerpt(
    rawText: string,
    plan: SearchPlan,
    fallbackSnippet = "",
    title = ""
  ) {
    const sentences = splitSentences(rawText);
    if (sentences.length === 0) {
      const fallback = normalizeSpace(`${title}. ${fallbackSnippet}`);
      return fallback.length >= 80 ? fallback.slice(0, 600) : null;
    }

    const scored = sentences
      .map((sentence, index) => {
        const normalized = sentence.toLowerCase();
        let score = 0;

        score += plan.requiredTerms.reduce(
          (total, term) => total + (term.length >= 4 && normalized.includes(term.toLowerCase()) ? 5 : 0),
          0
        );
        score += plan.factFocusTerms.reduce(
          (total, term) => total + (term.length >= 4 && normalized.includes(term.toLowerCase()) ? 4 : 0),
          0
        );

        if (countRegexMatches(sentence, /\b\d+(?:\.\d+)?%?\b/g) > 0) {
          score += 2;
        }
        if (matchesAny(sentence, DOC_HINT_PATTERNS)) {
          score += 3;
        }
        if (sentence.length >= 80 && sentence.length <= 320) {
          score += 2;
        }
        if (matchesAny(sentence, [/\bmust\b/i, /\bshould\b/i, /\brequires?\b/i, /\bmeans\b/i])) {
          score += 2;
        }

        return { index, sentence, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 6)
      .sort((left, right) => left.index - right.index);

    const selected = scored.length > 0 ? scored.map((entry) => entry.sentence) : sentences.slice(0, 4);
    const excerpt = normalizeSpace([title, ...selected].filter(Boolean).join(" ")).slice(0, 1600);
    if (excerpt.length >= 120) {
      return excerpt;
    }

    const fallback = normalizeSpace(`${title}. ${fallbackSnippet}`.replace(/^\.\s*/, ""));
    return fallback.length >= 80 ? fallback.slice(0, 600) : null;
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
    const category = args.category;
    const targetClaims = uniqueStrings([
      ...args.redTeam.potentially_false_claims.slice(0, 4),
      ...args.redTeam.shared_risks.slice(0, 2)
    ]).slice(0, 6);
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
      categoryBias;
    const thresholdAdjustment =
      knowledgeStrategy?.toolRecommendation === "prefer_grounded"
        ? -8
        : knowledgeStrategy?.toolRecommendation === "verify_only"
          ? 2
          : knowledgeStrategy?.toolRecommendation === "avoid"
            ? 10
            : 0;

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

    if (falseClaimCount > 0) {
      addSignal("potentially_false_claims");
    }
    if (highFactualRisk) {
      addSignal("high_factual_risk");
    } else if (mediumFactualRisk) {
      addSignal("medium_factual_risk");
    } else if (elevatedFactualRisk) {
      addSignal("elevated_factual_risk");
    }
    if (providerSpecific) {
      addSignal("provider_or_product_specific");
    }
    if (regulatoryOrStandardCue) {
      addSignal("regulatory_or_standard");
    }
    if (hardConstraintCue) {
      addSignal("hard_constraints");
    }
    if (debugDocCue) {
      addSignal("diagnostic_doc_needed");
    }
    if (explicitMetricCue) {
      addSignal("explicit_metric_claims");
    }
    if (uncertaintySignals >= 3) {
      addSignal("respondent_uncertainty");
    }
    if (structuralRiskCount >= 7) {
      addSignal("redteam_structural_pressure");
    }
    if (knowledgeStrategy) {
      addSignal(`knowledge_tool_${knowledgeStrategy.toolRecommendation}`);
    }

    if (knowledgeStrategy?.toolRecommendation === "avoid") {
      addReason(
        `Knowledge layer marks ${category} as low-value for grounding unless a strong external-verification signal appears.`
      );
    } else if (knowledgeStrategy?.toolRecommendation === "prefer_grounded") {
      addReason(
        `Knowledge layer marks ${category} as a category where grounded verification has historically added value.`
      );
    } else if (knowledgeStrategy?.toolRecommendation === "verify_only") {
      addReason(
        `Knowledge layer marks ${category} as verify-only: use research only to confirm externally checkable claims.`
      );
    } else if (knowledgeStrategy?.toolRecommendation === "conditional") {
      addReason(
        `Knowledge layer marks ${category} as conditional: research should only fire when the factual sub-problem is explicit.`
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

    const shouldUse = this.shouldUseResearch({
      category,
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
      knowledgeStrategy
    });
    const plan = shouldUse ? this.derivePlan(args, knowledgeStrategy) : null;
    const expectedValue: ResearchExpectedValue = shouldUse
      ? baseNeedScore >= 55
        ? "high"
        : baseNeedScore >= 35
          ? "medium"
          : "low"
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
            `Research not needed for this round: ${category} currently benefits more from reasoning/refinement than external grounding for the observed signals and knowledge-layer priors.`
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
  }) {
    const threshold = 38 + args.thresholdAdjustment;

    if (
      args.knowledgeStrategy?.toolRecommendation === "avoid" &&
      !(args.falseClaimCount >= 1 && args.highFactualRisk && (args.providerSpecific || args.regulatoryOrStandardCue || args.explicitMetricCue || args.temporalOrOfficialCue))
    ) {
      return false;
    }

    if (
      args.knowledgeStrategy?.toolRecommendation === "prefer_grounded" &&
      (args.falseClaimCount >= 1 ||
        (args.elevatedFactualRisk && (args.factualCue || args.providerSpecific || args.temporalOrOfficialCue)))
    ) {
      return true;
    }

    if (
      args.knowledgeStrategy?.toolRecommendation === "verify_only" &&
      args.falseClaimCount >= 1 &&
      (args.providerSpecific || args.regulatoryOrStandardCue || args.hardConstraintCue || args.temporalOrOfficialCue)
    ) {
      return true;
    }

    if (
      args.knowledgeStrategy?.toolRecommendation === "conditional" &&
      ((args.falseClaimCount >= 2 && args.elevatedFactualRisk) ||
        ((args.providerSpecific || args.debugDocCue || args.hardConstraintCue) && args.mediumFactualRisk))
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

  private minimumCandidateScore(plan: SearchPlan) {
    switch (plan.intent) {
      case "definition":
      case "product_docs":
      case "diagnostic_docs":
      case "constraint_check":
        return 14;
      case "incident_guidance":
      case "metric_verification":
        return 12;
      case "fact_check":
      default:
        return 10;
    }
  }

  private isHighTrustDomain(domain: string, plan: SearchPlan) {
    if (!domain) {
      return false;
    }

    return this.getDomainTrustScore(domain, "", plan) >= 26;
  }

  private async searchAll(plan: SearchPlan) {
    const resultSets = await Promise.all(
      plan.queries.slice(0, 3).map(async (query) => {
        try {
          return await this.search(query);
        } catch (error) {
          logger.warn("Research search query failed", {
            query,
            intent: plan.intent,
            error: String(error)
          });
          return [];
        }
      })
    );

    const bestByUrl = new Map<string, ScoredCandidate>();
    for (const candidate of resultSets.flat()) {
      const score = this.scoreCandidate(candidate, plan);
      const trustScore = this.getDomainTrustScore(
        getHostname(candidate.url),
        getPathname(candidate.url),
        plan
      );
      const existing = bestByUrl.get(candidate.url);
      if (!existing || score > existing.score) {
        bestByUrl.set(candidate.url, { candidate, score, trustScore });
      }
    }

    const ranked = [...bestByUrl.values()]
      .sort(
        (left, right) =>
          right.trustScore - left.trustScore || right.score - left.score || left.candidate.url.localeCompare(right.candidate.url)
      )
      .filter((entry) => entry.score >= this.minimumCandidateScore(plan))
      .slice(0, 8)
      .map((entry) => entry.candidate);

    if (ranked.length > 0) {
      const trustedRanked = ranked.filter((candidate) =>
        this.isHighTrustDomain(getHostname(candidate.url), plan)
      );
      if (trustedRanked.length > 0) {
        return trustedRanked.slice(0, 5);
      }
    }

    const relaxed = [...bestByUrl.values()]
      .sort(
        (left, right) =>
          right.trustScore - left.trustScore || right.score - left.score || left.candidate.url.localeCompare(right.candidate.url)
      )
      .filter((entry) => !LOW_TRUST_DOMAIN_PATTERNS.some((pattern) => pattern.test(getHostname(entry.candidate.url))))
      .filter((entry) => entry.score >= Math.max(6, this.minimumCandidateScore(plan) - 4))
      .filter((entry) => entry.trustScore >= 0)
      .slice(0, 5)
      .map((entry) => entry.candidate);

    if (relaxed.length > 0) {
      return relaxed;
    }

    return [...bestByUrl.values()]
      .sort((left, right) => right.score - left.score)
      .filter((entry) => entry.score >= Math.max(4, this.minimumCandidateScore(plan) - 6))
      .slice(0, 3)
      .map((entry) => entry.candidate);
  }

  private async search(query: string, allowBroaden = true): Promise<SearchCandidate[]> {
    const sanitize = (results: SearchCandidate[]) =>
      results.filter((candidate) => {
        const host = getHostname(candidate.url);
        return (
          candidate.title.length >= 3 &&
          candidate.snippet.length >= 20 &&
          !SEARCH_ENGINE_HOST_PATTERNS.some((pattern) => pattern.test(host))
        );
      });
    const enforceQueryRelevance = (results: SearchCandidate[]) => {
      const quotedPhrases = [...query.matchAll(/"([^"]+)"/g)]
        .map((match) => match[1]?.toLowerCase() ?? "")
        .filter(Boolean);
      const siteHosts = [...query.matchAll(/\bsite:([^\s]+)/gi)]
        .map((match) => match[1]?.toLowerCase() ?? "")
        .filter(Boolean);

      return results.filter((candidate) => {
        const host = getHostname(candidate.url);
        const haystack = `${candidate.title} ${candidate.snippet} ${candidate.url}`.toLowerCase();

        if (siteHosts.length > 0 && !siteHosts.some((siteHost) => host.endsWith(siteHost))) {
          return false;
        }

        if (quotedPhrases.length > 0 && !quotedPhrases.some((phrase) => haystack.includes(phrase))) {
          return false;
        }

        return true;
      });
    };

    try {
      const results = enforceQueryRelevance(sanitize(await this.searchDuckDuckGo(query)));
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logger.warn("DuckDuckGo search failed; trying Bing fallback", {
        query,
        error: String(error)
      });
    }

    try {
      const results = enforceQueryRelevance(sanitize(await this.searchDuckDuckGoLite(query)));
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logger.warn("DuckDuckGo Lite search failed; trying Bing fallback", {
        query,
        error: String(error)
      });
    }

    try {
      const results = enforceQueryRelevance(sanitize(await this.searchBing(query)));
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logger.warn("Bing search failed", {
        query,
        error: String(error)
      });
    }

    if (allowBroaden && /\bsite:/i.test(query)) {
      const broadened = stripSiteOperators(query);
      if (broadened && broadened !== query) {
        return this.search(broadened, false);
      }
    }

    return [];
  }

  private async searchDuckDuckGo(query: string) {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $(".result").each((_index, element) => {
      const anchor = $(element).find(".result__a").first();
      const title = normalizeSpace(anchor.text());
      const href = anchor.attr("href") ?? "";
      const snippet = normalizeSpace($(element).find(".result__snippet").first().text());
      const url = this.unwrapDuckDuckGoUrl(href);

      if (!title || !url) {
        return;
      }

      if (!/^https?:\/\//i.test(url)) {
        return;
      }

      if (results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title
      });
    });

    if (results.length === 0) {
      throw new Error("DuckDuckGo search returned no usable results.");
    }

    return results;
  }

  private async searchBing(query: string) {
    try {
      const rssResults = await this.searchBingRss(query);
      if (rssResults.length > 0) {
        return rssResults;
      }
    } catch (error) {
      logger.warn("Bing RSS search failed; trying HTML fallback", {
        query,
        error: String(error)
      });
    }

    return this.searchBingHtml(query);
  }

  private async searchBingRss(query: string) {
    const response = await fetch(
      `https://www.bing.com/search?cc=us&setlang=en-US&format=rss&q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      throw new Error(`Bing RSS search returned ${response.status}`);
    }

    const xml = await response.text();
    const $ = load(xml, { xml: true });
    const results: SearchCandidate[] = [];

    $("item").each((_index, element) => {
      const title = normalizeSpace($(element).find("title").first().text());
      const url = normalizeSpace($(element).find("link").first().text());
      const snippet = normalizeSpace($(element).find("description").first().text());

      if (!title || !url || !/^https?:\/\//i.test(url)) {
        return;
      }

      if (results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title
      });
    });

    if (results.length === 0) {
      throw new Error("Bing RSS search returned no usable results.");
    }

    return results.slice(0, 10);
  }

  private async searchBingHtml(query: string) {
    const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`Bing search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $(".b_algo").each((_index, element) => {
      const anchor = $(element).find("h2 a").first();
      const title = normalizeSpace(anchor.text());
      const url = this.unwrapBingUrl(anchor.attr("href") ?? "");
      const snippet = normalizeSpace(
        $(element).find(".b_caption p").first().text() || $(element).find("p").first().text()
      );

      if (!title || !url) {
        return;
      }

      if (!/^https?:\/\//i.test(url)) {
        return;
      }

      if (results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title
      });
    });

    if (results.length === 0) {
      throw new Error("Bing search returned no usable results.");
    }

    return results;
  }

  private async searchDuckDuckGoLite(query: string) {
    const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo Lite search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $("a").each((_index, element) => {
      const anchor = $(element);
      const title = normalizeSpace(anchor.text());
      const href = anchor.attr("href") ?? "";
      const url = this.unwrapDuckDuckGoUrl(href);

      if (!title || !url || !/^https?:\/\//i.test(url)) {
        return;
      }

      const rowText = normalizeSpace(anchor.parent().text());
      const snippet = rowText.length > title.length ? rowText : title;

      if (results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet
      });
    });

    if (results.length === 0) {
      throw new Error("DuckDuckGo Lite search returned no usable results.");
    }

    return results.slice(0, 10);
  }

  private unwrapDuckDuckGoUrl(url: string) {
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      const redirected = parsed.searchParams.get("uddg");
      return redirected ? decodeURIComponent(redirected) : parsed.toString();
    } catch {
      return url;
    }
  }

  private unwrapBingUrl(url: string) {
    try {
      const parsed = new URL(url, "https://www.bing.com");
      const encoded = parsed.searchParams.get("u");
      if (!encoded) {
        return parsed.toString();
      }

      const payload = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded =
        normalized.length % 4 === 2
          ? `${normalized}==`
          : normalized.length % 4 === 3
            ? `${normalized}=`
            : normalized;
      const decoded = Buffer.from(padded, "base64").toString("utf8");

      return /^https?:\/\//i.test(decoded) ? decoded : parsed.toString();
    } catch {
      return url;
    }
  }

  private async extractSources(results: SearchCandidate[], plan: SearchPlan) {
    const settled = await Promise.allSettled(
      results.map(async (result) => {
        const excerpt = await this.extractPage(result, plan);
        if (!excerpt) {
          return null;
        }

        return {
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          excerpt
        } satisfies ResearchSource;
      })
    );

    const sources: ResearchSource[] = [];
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") {
        if (outcome.value) {
          sources.push(outcome.value);
        }
        continue;
      }

      logger.warn("Research source extraction failed", {
        url: results[index]?.url ?? "unknown",
        error: String(outcome.reason)
      });
    }

    return sources.slice(0, 4);
  }

  private async extractPage(result: SearchCandidate, plan: SearchPlan) {
    const direct = await this.tryExtractDirect(result, plan);
    if (direct) {
      return direct;
    }

    const reader = await this.tryExtractViaReader(result, plan);
    if (reader) {
      return reader;
    }

    return this.tryBuildSnippetFallback(result, plan);
  }

  private async tryExtractDirect(result: SearchCandidate, plan: SearchPlan) {
    const response = await fetch(result.url, {
      headers: {
        "User-Agent": USER_AGENT
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Direct extract returned ${response.status}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/pdf")) {
      return null;
    }

    const html = await response.text();
    const $ = load(html);
    $("script,style,noscript,svg,nav,footer,header,aside,form").remove();
    const metaDescription = normalizeSpace(
      $('meta[name="description"]').attr("content") ??
        $('meta[property="og:description"]').attr("content") ??
        ""
    );
    const root =
      $("article").first().length > 0
        ? $("article").first()
        : $("main").first().length > 0
          ? $("main").first()
          : $("body").first();

    const chunks: string[] = [];
    root.find("h1,h2,h3,p,li").each((_index, element) => {
      const text = normalizeSpace($(element).text());
      if (text.length >= 40) {
        chunks.push(text);
      }
      if (chunks.length >= 14) {
        return false;
      }
    });

    const rawText = normalizeSpace([metaDescription, ...chunks].filter(Boolean).join(" "));
    return this.buildRelevantExcerpt(rawText, plan, result.snippet, result.title);
  }

  private async tryExtractViaReader(result: SearchCandidate, plan: SearchPlan) {
    const readerUrl = `https://r.jina.ai/http://${result.url.replace(/^https?:\/\//i, "")}`;
    const response = await fetch(readerUrl, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Reader extract returned ${response.status}`);
    }

    const text = normalizeSpace(await response.text());
    return this.buildRelevantExcerpt(text, plan, result.snippet, result.title);
  }

  private tryBuildSnippetFallback(result: SearchCandidate, plan: SearchPlan) {
    const domain = getHostname(result.url);
    if (!this.isHighTrustDomain(domain, plan)) {
      return null;
    }

    const fallback = normalizeSpace(`${result.title}. ${result.snippet}`.replace(/^\.\s*/, ""));
    return fallback.length >= 80 ? fallback.slice(0, 600) : null;
  }
}

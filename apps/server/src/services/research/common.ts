import type {
  OrchestrationPolicyDetails,
  QuestionCategory,
  ResearchDecisionMode,
  ResearchExpectedValue,
  ResearchIntent,
  ResearchSourceRetrievalChannel,
  ResearchSourceRetrievalEngine,
  ResearchSourceRetrievalOrigin,
  ResearchTemporalProfile,
  RedTeamOutput,
  RespondentOutput,
  ToolRoutingDecision
} from "../../types/arena.js";
import type { AgentRoutingDecision } from "../../types/agents.js";
import type { KnowledgeCategoryStrategy } from "../../types/knowledge.js";
import type { SkillRoutingDecision } from "../../types/skills.js";
import type { StudentResponseStrategy } from "../../types/student.js";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36";

export const CATEGORY_SUFFIX: Record<QuestionCategory, string> = {
  incident_response: "incident response best practices security operations",
  architecture_design: "software architecture tradeoffs reliability scalability",
  technical_explanation: "official documentation explanation examples",
  debug_diagnostic: "debugging troubleshooting root cause investigation",
  product_strategy: "product strategy adoption metrics prioritization",
  operational_writing: "incident update postmortem engineering communication",
  mixed_reasoning: "tradeoffs decision examples explanation",
  other: "official guidance examples"
};

export const STOPWORDS = new Set([
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
  "together",
  "explique",
  "decris",
  "definis",
  "definition",
  "phrase",
  "phrases",
  "simple",
  "simples"
]);

const FOCUS_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "to",
  "in",
  "on",
  "is",
  "are",
  "was",
  "were",
  "be",
  "by",
  "at",
  "who",
  "what",
  "when",
  "where",
  "which",
  "qui",
  "quoi",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "est",
  "sont",
  "etait",
  "tait",
  "etre",
  "pourquoi",
  "comment",
  "explique",
  "decris",
  "definis",
  "definition",
  "phrase",
  "phrases",
  "simple",
  "simples",
  "current",
  "currently",
  "latest",
  "newest",
  "recent",
  "recently",
  "official",
  "today",
  "week",
  "month",
  "right",
  "status",
  "guidance",
  "announcement",
  "announcements",
  "updates",
  "update",
  "release",
  "releases",
  "released",
  "announced",
  "about",
  "this",
  "that",
  "from",
  "with",
  "have",
  "into"
]);

export const RESEARCH_MODE_COST_MS: Record<ResearchDecisionMode, number> = {
  off: 0,
  targeted_verify: 2600,
  constraint_check: 2200,
  fact_check_only: 1800,
  verify_factual_subpart: 2100
};

export const RESEARCH_DECISION_REASONING_MAX_LENGTH = 400;
const TRUNCATION_SUFFIX = " [truncated]";

export type SearchCandidate = {
  title: string;
  url: string;
  snippet: string;
  retrievalChannel?: ResearchSourceRetrievalChannel;
  retrievalOrigin?: ResearchSourceRetrievalOrigin;
  retrievalEngine?: ResearchSourceRetrievalEngine;
};

export type ScoredCandidate = {
  candidate: SearchCandidate;
  score: number;
  trustScore: number;
};

export type SearchPlan = {
  intent: ResearchIntent;
  mode: ResearchDecisionMode;
  queries: string[];
  requiredTerms: string[];
  preferredDomains: string[];
  factFocusTerms: string[];
  entityTerms: string[];
  temporalProfile: ResearchTemporalProfile;
  reasoning: string;
};

export type ResearchDecisionArgs = {
  question: string;
  category: QuestionCategory;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
  shouldRefineA: boolean;
  shouldRefineB: boolean;
  orchestration?: OrchestrationPolicyDetails | null;
  studentStrategy?: StudentResponseStrategy | null;
};

export type ResearchDecision = {
  shouldUse: boolean;
  reasons: string[];
  triggerSignals: string[];
  targetClaims: string[];
  expectedValue: ResearchExpectedValue;
  expectedCostMs: number;
  knowledgeStrategy: KnowledgeCategoryStrategy | null;
  plan: SearchPlan | null;
  toolRouting?: ToolRoutingDecision | null;
  skillRouting?: SkillRoutingDecision | null;
  agentRouting?: AgentRoutingDecision | null;
};

export function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateWithSuffix(value: string, maxLength: number, suffix = TRUNCATION_SUFFIX) {
  const normalized = normalizeSpace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const availableLength = Math.max(1, maxLength - suffix.length);
  return `${normalized.slice(0, availableLength).trimEnd()}${suffix}`;
}

export function sanitizeResearchDecisionReasoning(value: string) {
  return truncateWithSuffix(value, RESEARCH_DECISION_REASONING_MAX_LENGTH);
}

export function splitSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((entry) => normalizeSpace(entry))
    .filter((entry) => entry.length >= 30);
}

export function extractTerms(value: string) {
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

export function normalizeFocusToken(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/node\.js/g, "nodejs")
    .replace(/next\.js/g, "nextjs")
    .replace(/type\s*script/g, "typescript")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  if (normalized.length < 3 || FOCUS_STOPWORDS.has(normalized)) {
    return "";
  }

  return normalized;
}

export function extractFocusTerms(value: string) {
  return uniqueStrings(
    value
      .replace(/node\.js/gi, "nodejs")
      .replace(/next\.js/gi, "nextjs")
      .replace(/type\s*script/gi, "typescript")
      .split(/[^a-zA-Z0-9.+-]+/)
      .map((token) => normalizeFocusToken(token))
      .filter(Boolean)
  );
}

export function extractPreferredDomainFocusTerms(preferredDomains: string[]) {
  return uniqueStrings(
    preferredDomains.flatMap((domain) =>
      domain
        .replace(/\./g, " ")
        .split(/[^a-zA-Z0-9]+/)
        .map((token) => normalizeFocusToken(token))
        .filter(Boolean)
    )
  );
}

export function countEntityTermHits(
  text: string,
  entityTerms: string[],
  preferredDomains: string[]
) {
  const normalizedText = normalizeSpace(text)
    .toLowerCase()
    .replace(/node\.js/g, "nodejs")
    .replace(/next\.js/g, "nextjs")
    .replace(/type\s*script/g, "typescript");
  const normalizedTerms = uniqueStrings(
    entityTerms.map((term) => normalizeFocusToken(term)).filter(Boolean)
  );
  const domainTerms = new Set(extractPreferredDomainFocusTerms(preferredDomains));
  const matchedTerms = normalizedTerms.filter((term) => normalizedText.includes(term));
  const matchedIdentityTerms = matchedTerms.filter((term) => domainTerms.has(term));
  const matchedSpecificTerms = matchedTerms.filter((term) => !domainTerms.has(term));

  return {
    totalHits: matchedTerms.length,
    identityHits: matchedIdentityTerms.length,
    specificHits: matchedSpecificTerms.length,
    matchedTerms,
    matchedIdentityTerms,
    matchedSpecificTerms
  };
}

export function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export function countRegexMatches(value: string, pattern: RegExp) {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function stripQuestionNoise(value: string) {
  return normalizeSpace(
    value
      .replace(/[?]/g, " ")
      .replace(
        /\b(?:design|propose|write|explain|describe|how would you|what are|what is|who is|who was|who are|qui est|qui etait|qui était|qui sont)\b/gi,
        " "
      )
  );
}

export function getHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function getPathname(url: string) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

export function stripSiteOperators(query: string) {
  return normalizeSpace(query.replace(/\s+site:[^\s]+/gi, " "));
}

export function formatQueryTerm(term: string) {
  const normalized = normalizeSpace(term);
  if (!normalized) {
    return "";
  }

  return /\s/.test(normalized) ? `"${normalized}"` : normalized;
}

export function extractLiteralTokens(value: string) {
  return uniqueStrings(
    (value.match(/\b(?:\d{3}|oauth|jwt|saml|rfc|nist|gdpr|hipaa|pci|soc ?2)\b/gi) ?? []).map(
      (entry) => normalizeSpace(entry.toLowerCase())
    )
  );
}

export function hasUncertaintySignals(respondent: RespondentOutput) {
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

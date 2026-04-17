import type {
  OrchestrationPolicyDetails,
  QuestionCategory,
  ResearchDecisionMode,
  ResearchExpectedValue,
  ResearchIntent,
  RedTeamOutput,
  RespondentOutput
} from "../../types/arena.js";
import type { KnowledgeCategoryStrategy } from "../../types/knowledge.js";
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
  "together"
]);

export const LOW_TRUST_DOMAIN_PATTERNS = [
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

export const DOC_HINT_PATTERNS = [
  /\bdocs?\b/i,
  /\bdocumentation\b/i,
  /\breference\b/i,
  /\bguide\b/i,
  /\bmanual\b/i,
  /\bofficial\b/i
];

export const OFFICIAL_DOMAIN_PATTERNS = [
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

export const COMMUNITY_PATH_PATTERNS = [
  /\/blog\//i,
  /\/community\//i,
  /\/forum/i,
  /\/forums\//i,
  /\/discuss\//i,
  /\/questions\//i,
  /\/learn\//i
];

export const SEARCH_ENGINE_HOST_PATTERNS = [
  /(^|\.)duckduckgo\.com$/i,
  /(^|\.)bing\.com$/i,
  /(^|\.)search\.yahoo\.com$/i
];

export const TERM_DOMAIN_HINTS: Array<{
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

export const RESEARCH_MODE_COST_MS: Record<ResearchDecisionMode, number> = {
  off: 0,
  targeted_verify: 2600,
  constraint_check: 2200,
  fact_check_only: 1800,
  verify_factual_subpart: 2100
};

export type SearchCandidate = {
  title: string;
  url: string;
  snippet: string;
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
};

export function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
      .replace(/\b(?:design|propose|write|explain|describe|how would you|what are|what is)\b/gi, " ")
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

export function getDomainTrustScore(
  domain: string,
  path: string,
  preferredDomains: string[]
) {
  if (!domain) {
    return -20;
  }

  if (preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
    return 55;
  }

  if (OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
    return COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? 20 : 38;
  }

  if (
    domain.includes("docs.") ||
    domain.includes("developer.") ||
    domain.includes("developers.") ||
    domain.includes("learn.")
  ) {
    return 26;
  }

  if (LOW_TRUST_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
    return -12;
  }

  return COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? -8 : 0;
}

export function getSourceTrustScore(url: string, preferredDomains: string[]) {
  return getDomainTrustScore(getHostname(url), getPathname(url), preferredDomains);
}

export function isHighTrustResearchSource(url: string, preferredDomains: string[], minimum = 26) {
  return getSourceTrustScore(url, preferredDomains) >= minimum;
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

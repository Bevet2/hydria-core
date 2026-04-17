import type {
  OrchestrationPolicyDetails,
  QuestionCategory,
  ResearchDecisionMode,
  ResearchExpectedValue,
  ResearchFreshnessWindow,
  ResearchIntent,
  ResearchTemporalProfile,
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

const MONTH_NAME_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const ISO_DATE_PATTERN = /\b20\d{2}-\d{2}-\d{2}\b/g;
const SLASH_DATE_PATTERN = /\b\d{1,2}\/\d{1,2}\/20\d{2}\b/g;
const MONTH_DAY_YEAR_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2})?,\s+20\d{2}\b/gi;
const MONTH_YEAR_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b/gi;
const RELATIVE_DATE_PATTERN = /\b(\d{1,2})\s+(hours?|days?|weeks?)\s+ago\b/gi;

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function startOfUtcWeek(value: Date) {
  const day = value.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return shiftUtcDays(startOfUtcDay(value), delta);
}

function shiftUtcDays(value: Date, deltaDays: number) {
  const shifted = new Date(value);
  shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
  return shifted;
}

function toIsoDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function formatCalendarDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

export function formatCalendarMonth(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

export function formatIsoDayForSearch(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : formatCalendarDate(parsed);
}

export function buildDefaultTemporalProfile(): ResearchTemporalProfile {
  return {
    isTemporal: false,
    focus: "none",
    queryType: "none",
    recencyDays: null,
    absoluteDateHint: null,
    dateRangeStart: null,
    dateRangeEnd: null,
    queryDirectives: [],
    answerDirectives: []
  };
}

export function describeTemporalWindow(profile: ResearchTemporalProfile) {
  if (!profile.isTemporal) {
    return null;
  }

  if (profile.dateRangeStart && profile.dateRangeEnd) {
    return `${formatIsoDayForSearch(profile.dateRangeStart)} to ${formatIsoDayForSearch(profile.dateRangeEnd)}`;
  }

  return profile.absoluteDateHint;
}

export function detectTemporalQuery(value: string, now = new Date()): ResearchTemporalProfile {
  const normalized = value.toLowerCase();
  const today = startOfUtcDay(now);
  const absoluteDateHint = formatCalendarDate(today);
  const thisWeekStart = startOfUtcWeek(today);
  const thisWeekEnd = shiftUtcDays(thisWeekStart, 6);
  const thisMonthStart = startOfUtcMonth(today);
  const thisMonthLabel = formatCalendarMonth(today);
  const hasCurrentStateCue = matchesAny(normalized, [
    /\bcurrent\b/i,
    /\bcurrently\b/i,
    /\bas of\b/i,
    /\bright now\b/i,
    /\bwho is\b/i,
    /\bceo\b/i,
    /\bpresident\b/i,
    /\bprime minister\b/i,
    /\bgovernor\b/i,
    /\bchair\b/i,
    /\bleader(ship)?\b/i,
    /\bowner\b/i,
    /\bstatus\b/i,
    /\bavailability\b/i,
    /\bavailable\b/i,
    /\bprice\b/i
  ]);
  const hasReleaseCue = matchesAny(normalized, [
    /\brelease(?:d|s| notes?)?\b/i,
    /\bversion\b/i,
    /\bchangelog\b/i,
    /\bannounce(?:d|ment|ments)?\b/i,
    /\blaunch(?:ed)?\b/i,
    /\broll(?:ed)? out\b/i,
    /\bga\b/i,
    /\bgeneral availability\b/i,
    /\bwhat'?s new\b/i,
    /\bnew features?\b/i
  ]);
  const hasRecentUpdatesCue =
    matchesAny(normalized, [
      /\brecent\b/i,
      /\brecently\b/i,
      /\bthis week\b/i,
      /\bthis month\b/i,
      /\blast 7 days\b/i,
      /\blast 30 days\b/i,
      /\bpast week\b/i,
      /\bpast month\b/i,
      /\bnews\b/i,
      /\bheadline(?:s)?\b/i,
      /\bupdates?\b/i,
      /\bwhat happened\b/i,
      /\bmajor\b/i
    ]) ||
    (/\bnew\b/i.test(normalized) &&
      matchesAny(normalized, [/\bupdates?\b/i, /\bfeatures?\b/i, /\bannouncements?\b/i, /\bmodels?\b/i]));

  const buildTemporalProfile = (profile: Partial<ResearchTemporalProfile>): ResearchTemporalProfile => ({
    ...buildDefaultTemporalProfile(),
    isTemporal: true,
    absoluteDateHint,
    ...profile
  });

  if (/\bthis week\b|\bpast week\b|\blast 7 days\b|\bseven days\b/i.test(normalized)) {
    const windowLabel = `${formatCalendarDate(thisWeekStart)} to ${formatCalendarDate(thisWeekEnd)}`;
    return buildTemporalProfile({
      focus: "this_week",
      queryType: "recent_updates",
      recencyDays: 7,
      dateRangeStart: toIsoDay(thisWeekStart),
      dateRangeEnd: toIsoDay(thisWeekEnd),
      queryDirectives: [
        `Resolve "this week" to ${windowLabel} before searching.`,
        "Prefer primary sources with an explicit publication or update date in that window.",
        "Prefer official announcements, release notes, advisories, or status pages over commentary."
      ],
      answerDirectives: [
        `State the exact window ${windowLabel}.`,
        "Do not paraphrase the result as just 'this week' without the concrete dates.",
        "If no reliable source falls inside the window, say that the weekly claim could not be verified."
      ]
    });
  }

  if (/\bthis month\b|\bpast month\b|\blast 30 days\b/i.test(normalized)) {
    const windowLabel = `${formatCalendarDate(thisMonthStart)} to ${absoluteDateHint}`;
    return buildTemporalProfile({
      focus: "this_month",
      queryType: "recent_updates",
      recencyDays: 30,
      absoluteDateHint: thisMonthLabel,
      dateRangeStart: toIsoDay(thisMonthStart),
      dateRangeEnd: toIsoDay(today),
      queryDirectives: [
        `Resolve "this month" to ${thisMonthLabel} and treat the active window as ${windowLabel}.`,
        "Prefer primary sources with an explicit publication or update date in the resolved month window.",
        "Prefer official announcements, release posts, advisories, or status updates over timeless docs."
      ],
      answerDirectives: [
        `State the resolved month ${thisMonthLabel} and, when useful, the active window ${windowLabel}.`,
        "Do not leave 'this month' implicit in the final wording.",
        "If no reliable source falls inside the resolved month window, say that the monthly claim could not be verified."
      ]
    });
  }

  if (/\btoday\b|\bas of today\b|\bright now\b/i.test(normalized)) {
    return buildTemporalProfile({
      focus: "today",
      queryType: hasReleaseCue ? "release_freshness" : "current_status",
      recencyDays: 2,
      dateRangeStart: toIsoDay(today),
      dateRangeEnd: toIsoDay(today),
      queryDirectives: [
        `Resolve "today" to ${absoluteDateHint} before searching.`,
        "Prefer sources that expose a concrete update date or status timestamp.",
        "Prefer official pages over secondary summaries."
      ],
      answerDirectives: [
        `State that the answer is anchored to ${absoluteDateHint}.`,
        "Do not claim something is true today unless a reliable source supports that current state.",
        "If freshness is unclear, say that current status could not be confirmed."
      ]
    });
  }

  if (
    (/\blatest\b|\bnewest\b|\bmost recent\b/i.test(normalized) && hasReleaseCue) ||
    (hasReleaseCue && /\bnew\b/i.test(normalized))
  ) {
    return buildTemporalProfile({
      focus: "latest",
      queryType: "release_freshness",
      recencyDays: 365,
      dateRangeStart: null,
      dateRangeEnd: null,
      queryDirectives: [
        `Replace "latest" with an as-of date anchored to ${absoluteDateHint}.`,
        "Prefer release notes, changelogs, official announcements, or canonical version pages.",
        "Prefer sources that expose an explicit publication or update date."
      ],
      answerDirectives: [
        `State that the answer is verified as of ${absoluteDateHint}.`,
        "Use concrete dates or version markers instead of repeating 'latest' loosely.",
        "If reliable sources do not establish what is latest, say that explicitly."
      ]
    });
  }

  if (hasCurrentStateCue) {
    return buildTemporalProfile({
      focus: "current",
      queryType: "current_status",
      recencyDays: 120,
      dateRangeStart: null,
      dateRangeEnd: null,
      queryDirectives: [
        `Replace "current" with an as-of date anchored to ${absoluteDateHint}.`,
        "Prefer official documentation, status pages, canonical leadership pages, or product pages describing the current state.",
        "Prefer sources that expose an explicit update date when available."
      ],
      answerDirectives: [
        `State that the answer is anchored to ${absoluteDateHint}.`,
        "Use exact dates, versions, or status labels instead of generic 'currently' phrasing.",
        "If a reliable source does not confirm the present state, say that explicitly."
      ]
    });
  }

  if (
    hasRecentUpdatesCue ||
    /\brecent\b|\brecently\b/i.test(normalized) ||
    /\bannounced\b/i.test(normalized)
  ) {
    const recentStart = shiftUtcDays(today, -29);
    const windowLabel = `${formatCalendarDate(recentStart)} to ${absoluteDateHint}`;
    return buildTemporalProfile({
      focus: "recent",
      queryType: "recent_updates",
      recencyDays: 30,
      dateRangeStart: toIsoDay(recentStart),
      dateRangeEnd: toIsoDay(today),
      queryDirectives: [
        `Resolve "recent" to the rolling window ${windowLabel}.`,
        "Prefer primary sources with a clear publication or update date inside that window.",
        "Discard stale or undated sources when fresher primary sources are available."
      ],
      answerDirectives: [
        `State the exact recent window ${windowLabel}.`,
        "Do not leave 'recent' undefined in the final wording.",
        "If reliable sources do not support the claim inside that window, say so explicitly."
      ]
    });
  }

  if (/\blatest\b|\bnewest\b|\bmost recent\b/i.test(normalized)) {
    return buildTemporalProfile({
      focus: "latest",
      queryType: "current_status",
      recencyDays: 120,
      queryDirectives: [
        `Replace "latest" with an as-of date anchored to ${absoluteDateHint}.`,
        "Prefer official or primary sources that describe the present state and expose a date when available.",
        "Do not rely on timeless background pages when a dated current-state source exists."
      ],
      answerDirectives: [
        `State that the answer is verified as of ${absoluteDateHint}.`,
        "Use a concrete date or status marker instead of vague 'latest' phrasing.",
        "If no reliable current-state source can be established, say that explicitly."
      ]
    });
  }

  return buildDefaultTemporalProfile();
}

export function resolveFreshnessWindow(profile: ResearchTemporalProfile): ResearchFreshnessWindow {
  if (!profile.isTemporal) {
    return "none";
  }

  if (profile.queryType === "current_status" || profile.queryType === "release_freshness") {
    return "current";
  }

  if (profile.focus === "this_week") {
    return "7d";
  }

  if (profile.focus === "recent") {
    return "30d";
  }

  return profile.dateRangeStart && profile.dateRangeEnd ? "explicit_date_range" : "current";
}

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

export function hasExplicitDateSignal(value: string) {
  return (
    MONTH_NAME_PATTERN.test(value) ||
    /\b20\d{2}\b/.test(value) ||
    /\b\d{1,2}\s+(?:hours?|days?|weeks?)\s+ago\b/i.test(value) ||
    /\bupdated\b|\bpublished\b|\breleased\b|\bannounced\b/i.test(value)
  );
}

export function scoreTemporalFreshness(value: string, profile: ResearchTemporalProfile, now = new Date()) {
  if (!profile.isTemporal) {
    return 0;
  }

  const dates = extractDateCandidates(value, now);
  const lower = value.toLowerCase();
  let score = 0;

  if (dates.length > 0) {
    const freshest = dates.reduce((best, current) =>
      current.getTime() > best.getTime() ? current : best
    );
    const ageDays = Math.max(
      0,
      Math.round((startOfUtcDay(now).getTime() - startOfUtcDay(freshest).getTime()) / 86_400_000)
    );

    if (profile.recencyDays !== null) {
      if (ageDays <= profile.recencyDays) {
        score += 12;
      } else if (ageDays <= profile.recencyDays * 2) {
        score += 4;
      } else {
        score -= 10;
      }
    } else {
      score += 5;
    }
  } else if (profile.focus === "recent" || profile.focus === "this_week" || profile.focus === "today") {
    score -= 6;
  } else {
    score -= 2;
  }

  if (/\bupdated\b|\blast updated\b|\bpublished\b|\bannounced\b|\breleased\b|\bchangelog\b|\brelease notes?\b/i.test(lower)) {
    score += 4;
  }

  if (profile.focus === "latest" || profile.focus === "current") {
    if (/\bcurrent\b|\blatest\b|\bversion\b|\bnow available\b|\bgenerally available\b/i.test(lower)) {
      score += 3;
    }
  }

  return score;
}

export function extractDateCandidates(value: string, now = new Date()) {
  const dates: Date[] = [];

  for (const match of value.matchAll(ISO_DATE_PATTERN)) {
    const parsed = new Date(`${match[0]}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(SLASH_DATE_PATTERN)) {
    const parsed = new Date(match[0]);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(MONTH_DAY_YEAR_PATTERN)) {
    const parsed = new Date(match[0]);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(MONTH_YEAR_PATTERN)) {
    const parsed = new Date(`${match[0]} 1`);
    if (!Number.isNaN(parsed.getTime())) {
      dates.push(parsed);
    }
  }

  for (const match of value.matchAll(RELATIVE_DATE_PATTERN)) {
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase() ?? "";
    if (!Number.isFinite(amount)) {
      continue;
    }

    const multiplier = unit.startsWith("hour") ? 0 : unit.startsWith("week") ? 7 : 1;
    dates.push(shiftUtcDays(startOfUtcDay(now), -(amount * multiplier)));
  }

  return dates;
}

export function toIsoDateTime(value: Date) {
  return value.toISOString();
}

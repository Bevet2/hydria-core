import type { ResearchIntent } from "../../types/arena.js";
import { getHostname, getPathname } from "./common.js";

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
  /(^|\.)openai\.com$/i,
  /(^|\.)vercel\.com$/i,
  /(^|\.)nextjs\.org$/i,
  /(^|\.)typescriptlang\.org$/i,
  /(^|\.)devblogs\.microsoft\.com$/i,
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

export const REFERENCE_DOMAIN_PATTERNS = [
  /(^|\.)wikipedia\.org$/i,
  /(^|\.)wikidata\.org$/i,
  /(^|\.)britannica\.com$/i,
  /(^|\.)larousse\.fr$/i,
  /(^|\.)universalis\.fr$/i,
  /(^|\.)worldhistory\.org$/i
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
  { pattern: /\bopenai\b/i, canonical: "openai", domains: ["openai.com"] },
  { pattern: /\bvercel\b/i, canonical: "vercel", domains: ["vercel.com"] },
  { pattern: /\bnext\.?js\b/i, canonical: "next.js", domains: ["nextjs.org", "github.com"] },
  {
    pattern: /\btypescript\b/i,
    canonical: "typescript",
    domains: ["typescriptlang.org", "devblogs.microsoft.com", "github.com"]
  },
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

export function getSearchDomainTrustScore(args: {
  domain: string;
  path: string;
  preferredDomains: string[];
  intent: ResearchIntent;
}) {
  const { domain, path, preferredDomains, intent } = args;

  if (!domain) {
    return -20;
  }

  if (LOW_TRUST_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
    return -35;
  }

  if (preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
    return 55;
  }

  if (
    domain === "github.com" &&
    (/\/releases?(?:\/|$)/i.test(path) || /\/tags(?:\/|$)/i.test(path))
  ) {
    return intent === "release_freshness" || intent === "recent_updates" ? 34 : 24;
  }

  if (OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
    if (COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      return intent === "recent_updates" || intent === "release_freshness" ? 34 : 20;
    }
    return 38;
  }

  if (REFERENCE_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
    return intent === "current_status" || intent === "recent_updates" || intent === "release_freshness"
      ? 12
      : 32;
  }

  if (
    domain.includes("docs.") ||
    domain.includes("developer.") ||
    domain.includes("developers.")
  ) {
    return 26;
  }

  return COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? -8 : 0;
}

export function getSourceTrustScore(
  url: string,
  preferredDomains: string[],
  intent: ResearchIntent = "fact_check"
) {
  const domain = getHostname(url);
  const path = getPathname(url);

  if (!domain) {
    return -20;
  }

  if (preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
    return 55;
  }

  if (
    domain === "github.com" &&
    (/\/releases?(?:\/|$)/i.test(path) || /\/tags(?:\/|$)/i.test(path))
  ) {
    return 34;
  }

  if (OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
    return COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? 20 : 38;
  }

  if (REFERENCE_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
    return intent === "current_status" || intent === "recent_updates" || intent === "release_freshness"
      ? 12
      : 32;
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

export function isHighTrustResearchSource(
  url: string,
  preferredDomains: string[],
  minimum = 26
) {
  return getSourceTrustScore(url, preferredDomains) >= minimum;
}

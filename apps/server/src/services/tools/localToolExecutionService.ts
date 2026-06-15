import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { relative } from "node:path";
import { load } from "cheerio";
import type { ResearchSource, ResearchToolLog, ToolRoutingDecision } from "../../types/arena.js";
import type { ExecutionGovernanceRequestInput } from "../../types/execution.js";
import { projectRoot } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import { ExecutionGovernanceService } from "../execution/executionGovernanceService.js";
import {
  extractComparisonSubjects,
  normalizeLooseText,
  rewriteGeneralKnowledgeQuery,
  subjectMatchesText
} from "../research/generalKnowledgeQueryRewriter.js";
import { ResearchAcquisitionService } from "../research/acquisitionService.js";
import type { SearchPlan } from "../research/common.js";
import { buildDefaultTemporalProfile } from "../research/temporal.js";
import { TERM_DOMAIN_HINTS } from "../research/trust.js";
import {
  buildSemanticSearchCandidates,
  semanticFrameFromRouting,
  sourceMatchesSemanticFrame,
  type SemanticFrame
} from "../orchestration/semanticMissionPlanner.js";

export type LocalToolExecutionResult = {
  toolType: ToolRoutingDecision["toolType"];
  intent: string;
  summary: string[];
  verifiedFacts: string[];
  confidenceScore: number;
  resultLabel: string;
  sources?: ResearchToolLog["sources"];
  executionAuditIds?: string[];
};

type LocalToolExecutionServiceOptions = {
  executionGovernanceService?: Pick<ExecutionGovernanceService, "plan"> | null;
};

type WeatherLanguage = "en" | "fr";

type WeatherLocation = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

type WeatherGeocodingResponse = {
  results?: WeatherLocation[];
};

type WeatherForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weather_code?: number[];
  };
};

type CoinGeckoSimplePriceResponse = Record<
  string,
  Record<string, number | undefined> & {
    last_updated_at?: number;
  }
>;

type FrankfurterLatestResponse = {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number | undefined>;
};

type GitHubContentItem = {
  name?: string;
  path?: string;
  type?: "file" | "dir" | "symlink" | "submodule";
};

type GitHubStatusResponse = {
  page?: {
    name?: string;
    url?: string;
  };
  status?: {
    indicator?: string;
    description?: string;
  };
};

type GitHubReleaseResponse = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
};

type NodeReleaseEntry = {
  version?: string;
  date?: string;
  lts?: false | string;
};

type CurrentStatusMatch = {
  label: string;
  fact: string;
  excerpt: string;
  sources: ResearchToolLog["sources"];
};

type RecentUpdateFeed = {
  id: string;
  title: string;
  url: string;
};

type RecentUpdateEntry = {
  feed: RecentUpdateFeed;
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
};

type WikipediaSearchResponse = {
  query?: {
    search?: Array<{
      title?: string;
      snippet?: string;
    }>;
  };
};

type WikipediaSummaryResponse = {
  title?: string;
  description?: string;
  extract?: string;
  timestamp?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

type WikipediaExtractResponse = {
  query?: {
    pages?: Record<
      string,
      {
        extract?: string;
      }
    >;
  };
};

type WikidataSearchResponse = {
  search?: Array<{
    id?: string;
    label?: string;
    description?: string;
    concepturi?: string;
  }>;
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type GeneralKnowledgeEvidence = {
  title: string;
  url: string;
  snippet: string;
  excerpt: string;
  engine: ResearchSource["retrievalEngine"];
  origin: ResearchSource["retrievalOrigin"];
  confidence: number;
  language?: WeatherLanguage | "unknown";
  modifiedAt?: string | null;
  dateSource?: ResearchSource["dateSource"];
};

type TechnicalResearchAspect = {
  query: string;
  matchTerms: string[];
};

const CITY_TIMEZONES: Record<string, string> = {
  paris: "Europe/Paris",
  london: "Europe/London",
  berlin: "Europe/Berlin",
  madrid: "Europe/Madrid",
  rome: "Europe/Rome",
  tokyo: "Asia/Tokyo",
  seoul: "Asia/Seoul",
  singapore: "Asia/Singapore",
  sydney: "Australia/Sydney",
  "new york": "America/New_York",
  nyc: "America/New_York",
  chicago: "America/Chicago",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  montreal: "America/Toronto",
  toronto: "America/Toronto",
  utc: "UTC"
};

const UNIT_ALIASES: Record<string, string> = {
  km: "km",
  kilometer: "km",
  kilometers: "km",
  mile: "mi",
  miles: "mi",
  m: "m",
  meter: "m",
  meters: "m",
  ft: "ft",
  feet: "ft",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  c: "c",
  celsius: "c",
  f: "f",
  fahrenheit: "f",
  hour: "h",
  hours: "h",
  minute: "min",
  minutes: "min",
  second: "s",
  seconds: "s"
};

const CRYPTO_ASSETS: Record<string, { id: string; label: string }> = {
  BTC: { id: "bitcoin", label: "Bitcoin" },
  BITCOIN: { id: "bitcoin", label: "Bitcoin" },
  ETH: { id: "ethereum", label: "Ethereum" },
  ETHEREUM: { id: "ethereum", label: "Ethereum" },
  SOL: { id: "solana", label: "Solana" },
  SOLANA: { id: "solana", label: "Solana" }
};

const EQUITY_ASSETS: Record<string, { symbol: string; stooqSymbol: string; label: string }> = {
  NVDA: { symbol: "NVDA", stooqSymbol: "nvda.us", label: "Nvidia" },
  NVIDIA: { symbol: "NVDA", stooqSymbol: "nvda.us", label: "Nvidia" },
  TSLA: { symbol: "TSLA", stooqSymbol: "tsla.us", label: "Tesla" },
  TESLA: { symbol: "TSLA", stooqSymbol: "tsla.us", label: "Tesla" },
  MSFT: { symbol: "MSFT", stooqSymbol: "msft.us", label: "Microsoft" },
  MICROSOFT: { symbol: "MSFT", stooqSymbol: "msft.us", label: "Microsoft" }
};

const AI_RECENT_UPDATE_FEEDS: RecentUpdateFeed[] = [
  {
    id: "openai-news",
    title: "OpenAI News",
    url: "https://openai.com/news/rss.xml"
  },
  {
    id: "huggingface-blog",
    title: "Hugging Face Blog",
    url: "https://huggingface.co/blog/feed.xml"
  },
  {
    id: "google-ai-blog",
    title: "Google AI Blog",
    url: "https://blog.google/technology/ai/rss/"
  },
  {
    id: "google-research-blog",
    title: "Google Research Blog",
    url: "https://research.google/blog/rss/"
  }
];

const WEATHER_CODE_LABELS: Record<number, { en: string; fr: string }> = {
  0: { en: "clear sky", fr: "ciel d\u00e9gag\u00e9" },
  1: { en: "mainly clear", fr: "ciel plutot d\u00e9gag\u00e9" },
  2: { en: "partly cloudy", fr: "partiellement nuageux" },
  3: { en: "overcast", fr: "couvert" },
  45: { en: "fog", fr: "brouillard" },
  48: { en: "depositing rime fog", fr: "brouillard givrant" },
  51: { en: "light drizzle", fr: "bruine faible" },
  53: { en: "moderate drizzle", fr: "bruine mod\u00e9r\u00e9e" },
  55: { en: "dense drizzle", fr: "bruine dense" },
  56: { en: "light freezing drizzle", fr: "bruine vergla\u00e7ante faible" },
  57: { en: "dense freezing drizzle", fr: "bruine vergla\u00e7ante dense" },
  61: { en: "slight rain", fr: "pluie faible" },
  63: { en: "moderate rain", fr: "pluie mod\u00e9r\u00e9e" },
  65: { en: "heavy rain", fr: "forte pluie" },
  66: { en: "light freezing rain", fr: "pluie vergla\u00e7ante faible" },
  67: { en: "heavy freezing rain", fr: "forte pluie vergla\u00e7ante" },
  71: { en: "slight snow fall", fr: "neige faible" },
  73: { en: "moderate snow fall", fr: "neige mod\u00e9r\u00e9e" },
  75: { en: "heavy snow fall", fr: "forte neige" },
  77: { en: "snow grains", fr: "neige en grains" },
  80: { en: "slight rain showers", fr: "averses faibles" },
  81: { en: "moderate rain showers", fr: "averses mod\u00e9r\u00e9es" },
  82: { en: "violent rain showers", fr: "averses violentes" },
  85: { en: "slight snow showers", fr: "averses de neige faibles" },
  86: { en: "heavy snow showers", fr: "fortes averses de neige" },
  95: { en: "thunderstorm", fr: "orage" },
  96: { en: "thunderstorm with slight hail", fr: "orage avec grele faible" },
  99: { en: "thunderstorm with heavy hail", fr: "orage avec forte grele" }
};

function normalizeNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
}

function evaluateArithmetic(expression: string) {
  const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "").trim();
  if (!sanitized || /[A-Za-z]/.test(sanitized)) {
    return null;
  }

  const value = Function(`"use strict"; return (${sanitized});`)();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractLocation(args: ToolRoutingDecision) {
  const location = args.extractedArgs?.location;
  return typeof location === "string" ? location.trim() : null;
}

function extractLanguage(args: ToolRoutingDecision): WeatherLanguage {
  return args.extractedArgs?.language === "fr" ? "fr" : "en";
}

function extractStringArg(args: ToolRoutingDecision, key: string) {
  const value = args.extractedArgs?.[key];
  return typeof value === "string" ? value.trim() : null;
}

function buildToolExecutionActionId(routing: ToolRoutingDecision) {
  return `local-tool::${routing.toolType}::${routing.intent}::${randomUUID()}`;
}

function buildExecutionProvenance(routing: ToolRoutingDecision, actionId: string, reason: string) {
  return {
    requestedBy: "core" as const,
    requestId: actionId,
    source: "local-tool-execution",
    parentTraceId: null,
    reason: `${routing.toolType}/${routing.intent}: ${reason}`
  };
}

function hasExplicitCurrencyRate(routing: ToolRoutingDecision) {
  const rate = routing.extractedArgs?.rate;
  return typeof rate === "number" && Number.isFinite(rate);
}

function getRepoHint(routing: ToolRoutingDecision) {
  return (
    extractStringArg(routing, "repo") ??
    extractStringArg(routing, "url") ??
    extractStringArg(routing, "repository") ??
    extractStringArg(routing, "fileHint")
  );
}

function buildLocalToolGovernanceRequest(
  routing: ToolRoutingDecision
): ExecutionGovernanceRequestInput | null {
  if (!routing.toolRequired) {
    return null;
  }

  const actionId = buildToolExecutionActionId(routing);
  const liveAcquisition = (description: string): ExecutionGovernanceRequestInput => ({
    actionId,
    subject: "local_tool",
    actionKind: "acquisition_fetch",
    capability: "fetcher_http",
    description,
    requestedPermissions: ["network:read"],
    provenance: buildExecutionProvenance(routing, actionId, description)
  });

  if (routing.toolType === "weather" || routing.toolType === "finance" || routing.toolType === "sports") {
    return liveAcquisition("Live data local tool requires bounded external acquisition.");
  }
  if (routing.toolType === "web" || routing.toolType === "research") {
    return liveAcquisition("Source-backed tool requires external acquisition before model synthesis.");
  }
  if (routing.toolType === "calculator" && routing.intent === "currency_conversion" && !hasExplicitCurrencyRate(routing)) {
    return liveAcquisition("Currency conversion without explicit rate requires external rate acquisition.");
  }
  if (routing.toolType === "repo" && routing.intent === "repo_analysis") {
    const repoHint = getRepoHint(routing);
    if (repoHint && /github\.com/i.test(repoHint)) {
      return {
        actionId,
        subject: "dev_agent_candidate",
        actionKind: "dev_repo_read",
        capability: "dev_agent",
        description: "Public repository structure lookup is audited as a future dev-agent read path.",
        url: repoHint,
        requestedPermissions: ["repo:read", "network:read"],
        provenance: buildExecutionProvenance(routing, actionId, "Public repository read preflight.")
      };
    }
    return {
      actionId,
      subject: "filesystem_candidate",
      actionKind: "filesystem_read",
      capability: "sandbox_command",
      description: "Local repository inspection is audited as a filesystem read candidate.",
      requestedPermissions: ["filesystem:read"],
      provenance: buildExecutionProvenance(routing, actionId, "Local repository filesystem read preflight.")
    };
  }
  if (routing.toolType === "file") {
    const writesFile = /generate|write|create|patch|modify|delete/i.test(routing.intent);
    return {
      actionId,
      subject: "filesystem_candidate",
      actionKind: writesFile ? "filesystem_write" : "filesystem_read",
      capability: "sandbox_command",
      description: writesFile
        ? "File tool candidate would write to the filesystem and must be gated."
        : "File tool candidate would read user-provided or workspace files and must be audited.",
      requestedPermissions: [writesFile ? "filesystem:write" : "filesystem:read"],
      riskHints: {
        writesFilesystem: writesFile
      },
      provenance: buildExecutionProvenance(routing, actionId, writesFile ? "File write preflight." : "File read preflight.")
    };
  }
  if (routing.intent === "run_tests") {
    return {
      actionId,
      subject: "future_tool",
      actionKind: "command_execution",
      capability: "sandbox_command",
      description: "Test execution is a future OS command path and is blocked in Core.",
      requestedPermissions: ["shell:run"],
      riskHints: {
        commandExecution: true
      },
      provenance: buildExecutionProvenance(routing, actionId, "Command execution preflight.")
    };
  }

  return null;
}

function extractWeatherLocation(args: ToolRoutingDecision) {
  const location = extractLocation(args);
  return location && location.length > 0 ? location : null;
}

function formatWeatherNumber(value: number | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Number.isInteger(value) || digits === 0
    ? String(Math.round(value))
    : value.toFixed(digits).replace(/\.?0+$/, "");
}

function formatWeatherDateTime(value: string | undefined, timeZone: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function weatherDescription(code: number | undefined, language: WeatherLanguage) {
  if (typeof code !== "number") {
    return language === "fr" ? "conditions non pr\u00e9cis\u00e9es" : "conditions unavailable";
  }

  return WEATHER_CODE_LABELS[code]?.[language] ?? (language === "fr" ? `code m\u00e9t\u00e9o ${code}` : `weather code ${code}`);
}

function windDirectionLabel(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const labels = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return labels[Math.round(value / 45) % labels.length] ?? null;
}

function formatResolvedLocation(location: WeatherLocation) {
  const parts = [location.name, location.admin1, location.country].filter(
    (part, index, list): part is string =>
      typeof part === "string" && part.length > 0 && list.indexOf(part) === index
  );
  return parts.join(", ");
}

async function fetchWeatherJson<T>(url: URL): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: URL): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/rss+xml,application/xml,text/xml,text/html,text/plain"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

async function fetchReadableText(url: string): Promise<string | null> {
  return (await fetchText(url)) ?? fetchText(`https://r.jina.ai/http://${url}`);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);

  return values.map((value) => value.trim());
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isAiRecentUpdatesRoute(args: ToolRoutingDecision) {
  const subject = [
    extractStringArg(args, "subject"),
    extractStringArg(args, "topic"),
    extractStringArg(args, "rawQuestion")
  ].filter(Boolean).join(" ");
  return /\b(?:ai|ia|llm|openai|anthropic|hugging\s*face|deepmind|google\s+ai|intelligence artificielle|artificial intelligence|modeles?\s+ia|mod[eè]les?\s+ia)\b/i.test(
    normalizeLooseText(subject)
  );
}

function parseRecentFeedEntries(feed: RecentUpdateFeed, body: string): RecentUpdateEntry[] {
  const $ = load(body, { xml: true });
  const entries: RecentUpdateEntry[] = [];

  $("item, entry").slice(0, 10).each((_index, element) => {
    const node = $(element);
    const title = normalizeSpaces(node.find("title").first().text());
    const linkNode = node.find("link").first();
    const url = normalizeSpaces(linkNode.attr("href") ?? linkNode.text() ?? feed.url);
    const summary = stripHtml(
      node.find("description").first().text() ||
        node.find("summary").first().text() ||
        node.find("content").first().text() ||
        node.find("content\\:encoded").first().text()
    );
    const rawDate = normalizeSpaces(
      node.find("updated").first().text() ||
        node.find("published").first().text() ||
        node.find("pubDate").first().text()
    );
    const parsedDate = rawDate ? new Date(rawDate) : null;
    entries.push({
      feed,
      title,
      url: url || feed.url,
      summary,
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null
    });
  });

  return entries.filter((entry) => entry.title.length > 0);
}

function isRecentEnoughForThisWeek(entry: RecentUpdateEntry, now = new Date()) {
  if (!entry.publishedAt) {
    return false;
  }
  const publishedAt = new Date(entry.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) {
    return false;
  }
  const maxAgeMs = 8 * 24 * 60 * 60 * 1000;
  return publishedAt >= now.getTime() - maxAgeMs && publishedAt <= now.getTime() + 24 * 60 * 60 * 1000;
}

function formatRecentUpdateDate(value: string | null) {
  if (!value) {
    return "date non precisee";
  }
  return value.slice(0, 10);
}

async function tryFetchRecentUpdates(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  if (!isAiRecentUpdatesRoute(args)) {
    return null;
  }

  const language = extractLanguage(args);
  const fetchedFeeds = await Promise.allSettled(
    AI_RECENT_UPDATE_FEEDS.map(async (feed) => ({
      feed,
      body: await fetchText(feed.url)
    }))
  );
  const allEntries = fetchedFeeds.flatMap((outcome) => {
    if (outcome.status !== "fulfilled" || !outcome.value.body) {
      return [];
    }
    return parseRecentFeedEntries(outcome.value.feed, outcome.value.body);
  });
  const recentEntries = allEntries
    .filter((entry) => isRecentEnoughForThisWeek(entry))
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""))
    .filter((entry, index, list) => {
      const key = `${entry.title.toLowerCase()}|${entry.url.toLowerCase()}`;
      return list.findIndex((candidate) => `${candidate.title.toLowerCase()}|${candidate.url.toLowerCase()}` === key) === index;
    })
    .slice(0, 6);

  if (recentEntries.length === 0) {
    return null;
  }

  const verifiedFacts = recentEntries.map((entry) => {
    const date = formatRecentUpdateDate(entry.publishedAt);
    return language === "fr"
      ? `${entry.feed.title} a publie "${entry.title}" le ${date}.`
      : `${entry.feed.title} published "${entry.title}" on ${date}.`;
  });
  const summary =
    language === "fr"
      ? [`Recherche IA recente: ${recentEntries.length} entree(s) datee(s) trouvee(s) dans des flux officiels.`]
      : [`Recent AI research/news: ${recentEntries.length} dated entries found in official feeds.`];

  return {
    toolType: "research",
    intent: args.intent,
    summary,
    verifiedFacts,
    confidenceScore: 0.84,
    resultLabel: `${recentEntries.length} recent AI updates`,
    sources: recentEntries.map((entry) => ({
      title: `${entry.feed.title}: ${entry.title}`,
      url: entry.url,
      snippet: entry.summary || `RSS entry from ${entry.feed.title}.`,
      excerpt: entry.summary || entry.title,
      publishedAt: entry.publishedAt,
      modifiedAt: entry.publishedAt,
      effectiveDate: entry.publishedAt,
      dateSource: entry.publishedAt ? "text" : "unknown",
      retrievalChannel: "live",
      retrievalOrigin: "known_endpoint",
      retrievalEngine: "known_endpoint"
    }))
  };
}

function extractResearchSubject(args: ToolRoutingDecision) {
  const raw =
    extractStringArg(args, "subject") ??
    extractStringArg(args, "query") ??
    extractStringArg(args, "rawQuestion") ??
    "";
  const language = extractLanguage(args);
  const rewrite = rewriteGeneralKnowledgeQuery({
    question: extractStringArg(args, "query") ?? raw,
    subject: raw,
    language
  });
  return rewrite.canonicalSubject.length >= 2 ? rewrite.canonicalSubject : raw.trim();
}

function rewriteResearchQuery(args: ToolRoutingDecision) {
  const subject = extractResearchSubject(args);
  return rewriteGeneralKnowledgeQuery({
    question: extractStringArg(args, "query") ?? subject,
    subject,
    language: extractLanguage(args)
  });
}

const TECHNICAL_RESEARCH_ASPECTS: Array<{
  pattern: RegExp;
  aspect: TechnicalResearchAspect;
}> = [
  {
    pattern: /\b(?:durabilite|durability|persistence|persistant|persistent)\b/,
    aspect: {
      query: "durability persistence",
      matchTerms: [
        "durability",
        "durable",
        "persistence",
        "persistent",
        "write-ahead",
        "write ahead",
        "wal",
        "fsync",
        "crash safety",
        "reliability"
      ]
    }
  },
  {
    pattern: /\b(?:concurrence|concurrency|concurrent|simultane|simultaneous)\b/,
    aspect: {
      query: "concurrency control",
      matchTerms: ["concurrency", "concurrent", "locking", "isolation", "mvcc"]
    }
  },
  {
    pattern: /\b(?:reprise|recovery|recover|restauration|restore|crash|incident|sinistre|disaster)\b/,
    aspect: {
      query: "crash recovery backup restore",
      matchTerms: ["recovery", "recover", "backup", "restore", "crash", "replay"]
    }
  },
  {
    pattern: /\b(?:securite|security|authentification|authentication|autorisation|authorization)\b/,
    aspect: {
      query: "security authentication authorization",
      matchTerms: ["security", "authentication", "authorization", "access control"]
    }
  },
  {
    pattern: /\b(?:performance|latence|latency|debit|throughput)\b/,
    aspect: {
      query: "performance latency throughput",
      matchTerms: ["performance", "latency", "throughput", "optimization"]
    }
  },
  {
    pattern: /\b(?:scalabilite|scalability|scale|dimensionnement)\b/,
    aspect: {
      query: "scalability scaling",
      matchTerms: ["scalability", "scaling", "scale", "partitioning", "sharding"]
    }
  },
  {
    pattern: /\b(?:disponibilite|availability|fiabilite|reliability|failover)\b/,
    aspect: {
      query: "availability reliability failover",
      matchTerms: ["availability", "reliability", "failover", "redundancy"]
    }
  },
  {
    pattern: /\b(?:replication|replica)\b/,
    aspect: {
      query: "replication replicas",
      matchTerms: ["replication", "replica", "standby"]
    }
  },
  {
    pattern: /\b(?:coherence|consistency|consistent)\b/,
    aspect: {
      query: "consistency guarantees",
      matchTerms: ["consistency", "consistent", "isolation"]
    }
  },
  {
    pattern: /\b(?:transaction|transactions|transactionnel|transactional)\b/,
    aspect: {
      query: "transactions transaction management",
      matchTerms: ["transaction", "transactions", "commit", "rollback"]
    }
  },
  {
    pattern: /\b(?:index|indexes|indices|indexation|indexing)\b/,
    aspect: {
      query: "indexes indexing",
      matchTerms: ["index", "indexes", "indexing"]
    }
  }
];

const TECHNICAL_QUERY_NOISE = new Set([
  "ainsi",
  "answer",
  "avec",
  "cite",
  "citer",
  "comment",
  "dans",
  "detail",
  "details",
  "donne",
  "explain",
  "explique",
  "fiable",
  "fiables",
  "moins",
  "mots",
  "plusieurs",
  "profondeur",
  "reponse",
  "response",
  "source",
  "sources",
  "structure",
  "structured",
  "the",
  "with"
]);

function extractTechnicalResearchAspects(question: string, subject: string) {
  const normalizedQuestion = normalizeLooseText(question);
  const matched = TECHNICAL_RESEARCH_ASPECTS
    .filter((entry) => entry.pattern.test(normalizedQuestion))
    .map((entry) => entry.aspect);
  if (matched.length > 0) {
    return matched.slice(0, 3);
  }

  const subjectTokens = new Set(normalizeLooseText(subject).split(/\s+/).filter(Boolean));
  const fallbackTerms = normalizedQuestion
    .split(/\s+/)
    .map((term) => term.replace(/[^a-z0-9-]/g, ""))
    .filter(
      (term) =>
        term.length >= 4 &&
        !subjectTokens.has(term) &&
        !TECHNICAL_QUERY_NOISE.has(term)
    )
    .slice(0, 3);

  return fallbackTerms.length > 0
    ? fallbackTerms.map((term) => ({ query: term, matchTerms: [term] }))
    : [{ query: "overview official documentation", matchTerms: [] }];
}

function resolveOfficialResearchDomains(subject: string, question: string) {
  const subjectDomains = uniqueStrings(
    TERM_DOMAIN_HINTS.filter((hint) => hint.pattern.test(subject)).flatMap((hint) => hint.domains)
  );
  if (subjectDomains.length > 0) {
    return subjectDomains.slice(0, 3);
  }

  return uniqueStrings(
    TERM_DOMAIN_HINTS.filter((hint) => hint.pattern.test(question)).flatMap((hint) => hint.domains)
  ).slice(0, 3);
}

function buildOfficialTechnicalResearchPlan(args: {
  subject: string;
  question: string;
  aspects: TechnicalResearchAspect[];
  preferredDomains: string[];
}): SearchPlan {
  const subjectTerms = normalizeLooseText(args.subject).split(/\s+/).filter((term) => term.length >= 2);
  const aspectTerms = uniqueStrings(args.aspects.flatMap((aspect) => aspect.matchTerms));
  const primaryDomain = args.preferredDomains[0] ?? "";
  const queries = args.aspects.map((aspect) =>
    primaryDomain
      ? `site:${primaryDomain} ${args.subject} current ${aspect.query} documentation`
      : `${args.subject} ${aspect.query} official documentation`
  );

  return {
    intent: "fact_check",
    mode: "targeted_verify",
    queries: uniqueStrings(queries).slice(0, 3),
    requiredTerms: uniqueStrings([...subjectTerms, ...aspectTerms]).slice(0, 10),
    preferredDomains: args.preferredDomains,
    factFocusTerms: aspectTerms.slice(0, 8),
    entityTerms: subjectTerms.slice(0, 6),
    temporalProfile: buildDefaultTemporalProfile(),
    reasoning: `Official technical documentation lookup for ${args.subject}, split by the requested aspects.`
  };
}

function officialDocumentationRootUrls(domain: string) {
  return [
    `https://${domain}/docs/current/`,
    `https://${domain}/docs/`,
    `https://${domain}/documentation/`,
    `https://${domain}/`
  ];
}

function officialDocumentationLinkScore(args: {
  label: string;
  url: string;
  aspect: TechnicalResearchAspect;
  subject: string;
}) {
  const text = normalizeLooseText(`${args.label} ${args.url}`);
  const aspectMatches = args.aspect.matchTerms.filter((term) =>
    text.includes(normalizeLooseText(term))
  ).length;
  if (aspectMatches === 0) {
    return 0;
  }

  const subjectMatches = normalizeLooseText(args.subject)
    .split(/\s+/)
    .filter((term) => term.length >= 3 && text.includes(term)).length;
  const docsBonus = /\/(?:docs?|documentation|manual|reference)\//i.test(args.url) ? 3 : 0;
  const currentBonus = /\/(?:current|latest|stable)\//i.test(args.url) ? 2 : 0;
  return aspectMatches * 5 + subjectMatches * 2 + docsBonus + currentBonus;
}

function extractRelevantOfficialExcerpt(body: string, aspect: TechnicalResearchAspect) {
  const $ = load(body);
  $("script, style, nav, footer, header").remove();
  const title = normalizeSpaces($("h1").first().text() || $("title").first().text());
  const text = normalizeSpaces(
    $("main").first().text() ||
      $("article").first().text() ||
      $("[role='main']").first().text() ||
      $("body").text()
  );
  if (text.length < 120) {
    return null;
  }

  const normalizedText = normalizeLooseText(text);
  const matchedTerm = aspect.matchTerms.find((term) =>
    normalizedText.includes(normalizeLooseText(term))
  );
  if (!matchedTerm) {
    return null;
  }

  const normalizedTerm = normalizeLooseText(matchedTerm);
  const matchIndex = normalizedText.indexOf(normalizedTerm);
  const start = Math.max(0, matchIndex - 220);
  const excerpt = normalizeSpaces(text.slice(start, start + 1600));
  return excerpt.length >= 120 ? { title, excerpt } : null;
}

async function discoverOfficialTechnicalEvidence(args: {
  subject: string;
  semanticFrame: SemanticFrame;
  aspects: TechnicalResearchAspect[];
  preferredDomains: string[];
  usedUrls: Set<string>;
}) {
  const selected: GeneralKnowledgeEvidence[] = [];

  for (const domain of args.preferredDomains.slice(0, 2)) {
    const rootCandidates = await Promise.all(
      officialDocumentationRootUrls(domain).map(async (url) => ({
        url,
        body: await fetchText(url)
      }))
    );
    const root = rootCandidates.find((candidate) => candidate.body);
    if (!root?.body) {
      continue;
    }

    const $ = load(root.body);
    const links = $("a[href]")
      .map((_index, element) => {
        const label = normalizeSpaces($(element).text());
        const href = $(element).attr("href") ?? "";
        try {
          const url = new URL(href, root.url);
          const host = url.hostname.replace(/^www\./, "");
          if (
            !args.preferredDomains.some((preferred) => host.endsWith(preferred)) ||
            !["http:", "https:"].includes(url.protocol) ||
            /\.(?:css|js|png|jpe?g|gif|svg|ico|zip|tar|gz|pdf)$/i.test(url.pathname)
          ) {
            return null;
          }
          url.hash = "";
          return { label, url: url.toString() };
        } catch {
          return null;
        }
      })
      .get()
      .filter((value): value is { label: string; url: string } => Boolean(value?.url));

    for (const aspect of args.aspects) {
      const candidates = links
        .map((link) => ({
          ...link,
          score: officialDocumentationLinkScore({
            ...link,
            aspect,
            subject: args.subject
          })
        }))
        .filter((candidate) => candidate.score > 0 && !args.usedUrls.has(candidate.url))
        .sort((left, right) => right.score - left.score)
        .slice(0, 4);

      for (const candidate of candidates) {
        const body = await fetchText(candidate.url);
        if (!body) {
          continue;
        }
        const relevant = extractRelevantOfficialExcerpt(body, aspect);
        if (!relevant) {
          continue;
        }
        const evidenceText = `${args.subject} ${relevant.title} ${relevant.excerpt}`;
        if (
          !sourceMatchesSemanticFrame(
            { ...args.semanticFrame, subject: args.subject },
            evidenceText
          ).passed
        ) {
          continue;
        }

        args.usedUrls.add(candidate.url);
        selected.push({
          title: relevant.title || candidate.label || `${args.subject} official documentation`,
          url: candidate.url,
          snippet: relevant.excerpt.slice(0, 280),
          excerpt: relevant.excerpt,
          engine: "known_endpoint",
          origin: "known_endpoint",
          confidence: 0.94,
          modifiedAt: null,
          dateSource: "unknown"
        });
        break;
      }
    }
  }

  return selected;
}

async function fetchOfficialTechnicalEvidence(args: {
  subject: string;
  question: string;
  semanticFrame: SemanticFrame;
}): Promise<GeneralKnowledgeEvidence[]> {
  if (!["software_technology", "code_debug"].includes(args.semanticFrame.domain)) {
    return [];
  }

  const preferredDomains = resolveOfficialResearchDomains(args.subject, args.question);
  if (preferredDomains.length === 0) {
    return [];
  }

  const aspects = extractTechnicalResearchAspects(args.question, args.subject);

  try {
    const acquisitions = await Promise.all(
      aspects.map((aspect) =>
        new ResearchAcquisitionService({
          sourceCacheEnabled: false,
          knownEndpointService: {
            getCandidates: () => []
          }
        }).collect(
          buildOfficialTechnicalResearchPlan({
            subject: args.subject,
            question: args.question,
            aspects: [aspect],
            preferredDomains
          })
        )
      )
    );
    const usedUrls = new Set<string>();
    const selected: GeneralKnowledgeEvidence[] = [];

    for (const [index, acquisition] of acquisitions.entries()) {
      const aspect = aspects[index];
      if (!aspect) {
        continue;
      }
      const matchingSources = acquisition.sources
        .filter((source) => {
          const text = `${source.title} ${source.snippet} ${source.excerpt}`;
          const host = (() => {
            try {
              return new URL(source.url).hostname.replace(/^www\./, "");
            } catch {
              return "";
            }
          })();
          const officialDomainMatch = preferredDomains.some((domain) => host.endsWith(domain));
          const semanticCheck = sourceMatchesSemanticFrame(
            { ...args.semanticFrame, subject: args.subject },
            text
          );
          const aspectMatch =
            aspect.matchTerms.length === 0 ||
            aspect.matchTerms.some((term) =>
              normalizeLooseText(text).includes(normalizeLooseText(term))
            );
          return (
            officialDomainMatch &&
            semanticCheck.passed &&
            aspectMatch &&
            source.excerpt.length >= 120
          );
        })
        .sort((left, right) => {
          const leftCurrent = /\/docs\/current\//i.test(left.url) ? 1 : 0;
          const rightCurrent = /\/docs\/current\//i.test(right.url) ? 1 : 0;
          return rightCurrent - leftCurrent || right.excerpt.length - left.excerpt.length;
        });
      const source =
        matchingSources.find((candidate) => !usedUrls.has(candidate.url)) ?? matchingSources[0];
      if (!source || usedUrls.has(source.url)) {
        continue;
      }
      usedUrls.add(source.url);
      selected.push({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        excerpt: source.excerpt,
        engine: source.retrievalEngine,
        origin: source.retrievalOrigin,
        confidence: 0.93,
        modifiedAt: source.modifiedAt,
        dateSource: source.dateSource
      });
    }

    if (selected.length < aspects.length) {
      for (const evidence of await discoverOfficialTechnicalEvidence({
        subject: args.subject,
        semanticFrame: args.semanticFrame,
        aspects,
        preferredDomains,
        usedUrls
      })) {
        if (!selected.some((current) => current.url === evidence.url)) {
          selected.push(evidence);
        }
      }
    }

    return selected.slice(0, aspects.length);
  } catch (error) {
    logger.warn("Official technical research acquisition failed", {
      subject: args.subject,
      error: String(error)
    });
    return discoverOfficialTechnicalEvidence({
      subject: args.subject,
      semanticFrame: args.semanticFrame,
      aspects,
      preferredDomains,
      usedUrls: new Set<string>()
    });
  }
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = normalizeLooseText(value);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function wikipediaLanguageOrder(language: WeatherLanguage) {
  return language === "fr" ? ["fr", "en"] : ["en", "fr"];
}

function wikipediaPageUrl(language: string, title: string) {
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

function entityTitleKey(value: string) {
  return normalizeLooseText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:corporation|corp|company|inc|incorporated|limited|ltd|plc|sa|sarl|ag|gmbh|societe|société|entreprise)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function subjectTitleScore(subject: string, title: string) {
  const subjectKey = entityTitleKey(subject);
  const titleKey = entityTitleKey(title);
  if (!subjectKey || !titleKey) {
    return 0;
  }
  if (titleKey === subjectKey) {
    return 4;
  }
  if (titleKey.startsWith(`${subjectKey} `) || titleKey.endsWith(` ${subjectKey}`)) {
    return /\b(?:corporation|corp|company|inc|soci[eé]t[eé]|entreprise)\b/i.test(title) ? 3 : 1;
  }
  return titleKey.includes(subjectKey) ? 1 : 0;
}

function requiresStrictSourceTitle(subject: string) {
  const compact = subject.trim().replace(/[^A-Za-z0-9]/g, "");
  return compact.length >= 4 && compact === compact.toUpperCase() && /[A-Z]/.test(compact);
}

function sourceTitleMatchesResolvedSubject(expectedSubject: string, title: string) {
  const titleScore = subjectTitleScore(expectedSubject, title);
  if (titleScore >= 3) {
    return true;
  }
  if (requiresStrictSourceTitle(expectedSubject)) {
    return false;
  }
  return titleScore > 0 || subjectMatchesText(expectedSubject, title);
}

async function searchWikipediaTitles(searchQuery: string, language: string, expectedSubject: string) {
  const searchUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srsearch", searchQuery);
  searchUrl.searchParams.set("srlimit", "5");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("origin", "*");
  const search = await fetchJson<WikipediaSearchResponse>(searchUrl);
  const titles = (search?.query?.search ?? [])
    .map((result, index) => ({
      title: result.title?.trim() ?? "",
      index
    }))
    .filter((result) => result.title.length > 0)
    .sort((left, right) => {
      const scoreDelta = subjectTitleScore(expectedSubject, right.title) - subjectTitleScore(expectedSubject, left.title);
      return scoreDelta !== 0 ? scoreDelta : left.index - right.index;
    })
    .map((result) => result.title);
  return titles.length > 0 ? titles : [searchQuery];
}

async function fetchWikipediaSummary(
  searchQuery: string,
  language: string,
  semanticFrame: SemanticFrame,
  expectedSubject: string
) {
  const candidateTitles = await searchWikipediaTitles(searchQuery, language, expectedSubject);
  for (const title of candidateTitles) {
    if (!title) {
      continue;
    }
    const summaryUrl = new URL(
      `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, "_"))}`
    );
    const summary = await fetchJson<WikipediaSummaryResponse>(summaryUrl);
    if (!summary?.extract || summary.extract.trim().length < 40) {
      continue;
    }

    const pageTitle = summary.title?.trim() || title;
    const pageUrl = summary.content_urls?.desktop?.page ?? wikipediaPageUrl(language, pageTitle);
    const timestamp = summary.timestamp && !Number.isNaN(new Date(summary.timestamp).getTime())
      ? new Date(summary.timestamp).toISOString()
      : null;
    const summaryExcerpt = normalizeSpaces(summary.extract);
    const focusedExcerpt =
      semanticFrame.intent === "rules"
        ? await fetchWikipediaFocusedExtract(pageTitle, language, semanticFrame)
        : null;
    const excerpt = focusedExcerpt ?? summaryExcerpt;
    const description = summary.description ? normalizeSpaces(summary.description) : null;
    if (!sourceTitleMatchesResolvedSubject(expectedSubject, pageTitle)) {
      continue;
    }
    if (!subjectMatchesText(expectedSubject, `${pageTitle} ${description ?? ""} ${excerpt}`)) {
      continue;
    }
    const semanticCheck = sourceMatchesSemanticFrame(
      { ...semanticFrame, subject: semanticFrame.subject ?? expectedSubject },
      `${pageTitle} ${description ?? ""} ${excerpt}`
    );
    if (!semanticCheck.passed) {
      continue;
    }
    return {
      title: pageTitle,
      url: pageUrl,
      description,
      excerpt,
      timestamp
    };
  }
  return null;
}

function scoreFocusedWikipediaParagraph(paragraph: string, semanticFrame: SemanticFrame) {
  const normalized = normalizeLooseText(paragraph);
  const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
  const matchedTerms = semanticFrame.expectedSenseTerms.filter((term) => {
    const normalizedTerm = normalizeLooseText(term);
    return normalizedTerm.includes(" ")
      ? normalized.includes(normalizedTerm)
      : tokens.has(normalizedTerm);
  });
  const scoringDetailHits = (
    normalized.match(
      /\b(?:scoring|score|points|frame|frames|strike|spare|carreau|carreaux|abat|reserve|lancer supplementaire|dix jeux?)\b/g
    ) ?? []
  ).length;
  const sectionHeadingBonus =
    /\b(?:deroulement du jeu|comptage des points|gameplay|scoring|how to play)\b/.test(normalized)
      ? 5
      : 0;
  const numericBonus = /\b\d+\b/.test(paragraph) ? 1 : 0;
  return matchedTerms.length * 2 + Math.min(10, scoringDetailHits * 2) + sectionHeadingBonus + numericBonus;
}

async function fetchWikipediaFocusedExtract(
  title: string,
  language: string,
  semanticFrame: SemanticFrame
) {
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "extracts");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("exsectionformat", "plain");
  url.searchParams.set("titles", title);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const body = await fetchJson<WikipediaExtractResponse>(url);
  const extract = Object.values(body?.query?.pages ?? {})[0]?.extract;
  if (!extract) {
    return null;
  }

  const paragraphs = extract
    .split(/\n{2,}/)
    .map((paragraph) => normalizeSpaces(paragraph))
    .filter((paragraph) => paragraph.length >= 80);
  const ranked = paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: scoreFocusedWikipediaParagraph(paragraph, semanticFrame)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  return best && best.score >= 4 ? best.paragraph.slice(0, 1800) : null;
}

function unwrapDuckDuckGoUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return parsed.href;
  } catch {
    return rawUrl;
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = new URL("https://duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const body = await fetchText(url.toString());
  if (!body) {
    return [];
  }

  const $ = load(body);
  const results: SearchResult[] = [];
  $(".result, .web-result").slice(0, 5).each((_index, element) => {
    const node = $(element);
    const anchor = node.find("a.result__a, a.result-link").first();
    const title = normalizeSpaces(anchor.text());
    const rawHref = anchor.attr("href") ?? "";
    const urlValue = unwrapDuckDuckGoUrl(rawHref);
    const snippet = normalizeSpaces(stripHtml(node.find(".result__snippet, .result-snippet").first().text()));
    if (title && urlValue && snippet) {
      results.push({ title, url: urlValue, snippet });
    }
  });
  return results.slice(0, 3);
}

async function fetchWikidataEntity(
  searchQuery: string,
  language: string,
  semanticFrame: SemanticFrame,
  expectedSubject: string
): Promise<GeneralKnowledgeEvidence | null> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", searchQuery);
  url.searchParams.set("language", language === "fr" ? "fr" : "en");
  url.searchParams.set("uselang", language === "fr" ? "fr" : "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  url.searchParams.set("limit", "5");

  const body = await fetchJson<WikidataSearchResponse>(url);
  const matches = body?.search ?? [];
  if (matches.length === 0) {
    return null;
  }

  const candidates = matches
    .map((match) => {
      const label = match?.label?.trim();
      const description = match?.description?.trim();
      const id = match?.id?.trim();
      if (!label || !description || !id) {
        return null;
      }
      const excerpt = normalizeSpaces(`${label}: ${description}.`);
      if (!sourceTitleMatchesResolvedSubject(expectedSubject, label)) {
        return null;
      }
      if (!subjectMatchesText(expectedSubject, excerpt)) {
        return null;
      }
      const semanticCheck = sourceMatchesSemanticFrame(
        { ...semanticFrame, subject: semanticFrame.subject ?? expectedSubject },
        excerpt
      );
      if (!semanticCheck.passed) {
        return null;
      }
      if (
        semanticFrame.ambiguityLevel === "high" &&
        semanticFrame.expectedSenseTerms.length > 0 &&
        semanticCheck.matchedExpectedTerms.length === 0
      ) {
        return null;
      }
      return {
        match,
        label,
        description,
        id,
        excerpt,
        semanticCheck
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => {
      const titleDelta = subjectTitleScore(expectedSubject, right.label) - subjectTitleScore(expectedSubject, left.label);
      if (titleDelta !== 0) {
        return titleDelta;
      }
      const expectedDelta =
        right.semanticCheck.matchedExpectedTerms.length - left.semanticCheck.matchedExpectedTerms.length;
      return expectedDelta !== 0 ? expectedDelta : right.semanticCheck.score - left.semanticCheck.score;
    });

  const best = candidates[0];
  if (!best) {
    return null;
  }

  return {
    title: `Wikidata: ${best.label}`,
    url: best.match.concepturi ?? `https://www.wikidata.org/wiki/${best.id}`,
    snippet: best.description,
    excerpt: best.excerpt,
    engine: "known_endpoint",
    origin: "known_endpoint",
    confidence: Math.max(0.72, best.semanticCheck.score),
    language: language === "fr" ? "fr" : "en",
    modifiedAt: null,
    dateSource: "unknown"
  };
}

async function searchBritannica(
  searchQuery: string,
  semanticFrame: SemanticFrame,
  expectedSubject: string
): Promise<GeneralKnowledgeEvidence | null> {
  const results = await searchDuckDuckGo(`site:britannica.com ${searchQuery}`);
  const match = results.find((result) => {
    try {
      const host = new URL(result.url).hostname.replace(/^www\./, "");
      const text = `${result.title} ${result.snippet}`;
      return (
        host.endsWith("britannica.com") &&
        sourceTitleMatchesResolvedSubject(expectedSubject, result.title) &&
        subjectMatchesText(expectedSubject, text) &&
        sourceMatchesSemanticFrame({ ...semanticFrame, subject: semanticFrame.subject ?? expectedSubject }, text).passed
      );
    } catch {
      return false;
    }
  });
  if (!match) {
    return null;
  }

  return {
    title: match.title,
    url: match.url,
    snippet: match.snippet,
    excerpt: match.snippet,
    engine: "duckduckgo",
    origin: "generic_search",
    confidence: 0.74,
    language: "en",
    modifiedAt: null,
    dateSource: "search_result"
  };
}

function inferEvidenceLanguage(text: string, url: string): WeatherLanguage | "unknown" {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.startsWith("fr.")) {
      return "fr";
    }
    if (hostname.startsWith("en.") || hostname.endsWith("britannica.com")) {
      return "en";
    }
  } catch {
    // Continue with lightweight text detection.
  }

  const normalized = normalizeLooseText(text);
  const frenchHits = (
    normalized.match(
      /\b(?:le|la|les|des|une|est|sont|avec|dans|pour|jeu|joueur|regle|points)\b/g
    ) ?? []
  ).length;
  const englishHits = (
    normalized.match(
      /\b(?:the|a|an|is|are|with|in|for|game|player|rule|score)\b/g
    ) ?? []
  ).length;
  if (frenchHits >= englishHits + 2) {
    return "fr";
  }
  if (englishHits >= frenchHits + 2) {
    return "en";
  }
  return "unknown";
}

async function searchGenericFactSources(
  searchQuery: string,
  semanticFrame: SemanticFrame,
  expectedSubject: string
): Promise<GeneralKnowledgeEvidence[]> {
  const results = await searchDuckDuckGo(searchQuery);
  return results
    .filter((result) => {
      const text = `${result.title} ${result.snippet}`;
      return (
        sourceTitleMatchesResolvedSubject(expectedSubject, result.title) &&
        subjectMatchesText(expectedSubject, text) &&
        sourceMatchesSemanticFrame({ ...semanticFrame, subject: semanticFrame.subject ?? expectedSubject }, text).passed
      );
    })
    .slice(0, 3)
    .map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      excerpt: result.snippet,
      engine: "duckduckgo",
      origin: "generic_search" as const,
      confidence: 0.64,
      language: inferEvidenceLanguage(`${result.title} ${result.snippet}`, result.url),
      modifiedAt: null,
      dateSource: "search_result" as const
    }));
}

function evidenceKey(evidence: GeneralKnowledgeEvidence) {
  return `${evidence.engine}:${evidence.url}`;
}

function evidenceFamily(evidence: GeneralKnowledgeEvidence) {
  try {
    const host = new URL(evidence.url).hostname.replace(/^www\./, "");
    if (host.endsWith("wikipedia.org")) {
      return "wikipedia";
    }
    if (host.endsWith("wikidata.org")) {
      return "wikidata";
    }
    if (host.endsWith("britannica.com")) {
      return "britannica";
    }
    return host;
  } catch {
    return evidence.engine;
  }
}

function hasReliableGeneralKnowledgeEvidence(evidence: GeneralKnowledgeEvidence[]) {
  const sourceFamilies = new Set(evidence.map(evidenceFamily));
  return sourceFamilies.size >= 2;
}

function hasIntentAdequateEvidence(evidence: GeneralKnowledgeEvidence[], semanticFrame: SemanticFrame) {
  if (semanticFrame.intent !== "rules") {
    return true;
  }
  return evidence.some((item) => {
    const check = sourceMatchesSemanticFrame(
      semanticFrame,
      `${item.title} ${item.snippet} ${item.excerpt}`
    );
    return check.passed && check.matchedExpectedTerms.length >= 2;
  });
}

function evidenceLanguageRank(evidence: GeneralKnowledgeEvidence, requestedLanguage: WeatherLanguage) {
  if (evidence.language === requestedLanguage) {
    return 2;
  }
  if (!evidence.language || evidence.language === "unknown") {
    return 1;
  }
  return 0;
}

function evidenceIntentScore(evidence: GeneralKnowledgeEvidence, semanticFrame: SemanticFrame) {
  return sourceMatchesSemanticFrame(
    semanticFrame,
    `${evidence.title} ${evidence.snippet} ${evidence.excerpt}`
  ).matchedExpectedTerms.length;
}

function addEvidence(list: GeneralKnowledgeEvidence[], evidence: GeneralKnowledgeEvidence | null) {
  if (!evidence) {
    return;
  }
  if (!list.some((current) => evidenceKey(current) === evidenceKey(evidence))) {
    list.push(evidence);
  }
}

function evidenceToSource(evidence: GeneralKnowledgeEvidence): ResearchSource {
  return {
    title: evidence.title,
    url: evidence.url,
    snippet: evidence.snippet,
    excerpt: evidence.excerpt,
    publishedAt: null,
    modifiedAt: evidence.modifiedAt ?? null,
    effectiveDate: evidence.modifiedAt ?? null,
    dateSource: evidence.dateSource ?? "unknown",
    retrievalChannel: "live",
    retrievalOrigin: evidence.origin,
    retrievalEngine: evidence.engine
  };
}

function corroborationScore(evidence: GeneralKnowledgeEvidence[]) {
  const uniqueFamilies = new Set(evidence.map(evidenceFamily)).size;
  const base = Math.max(...evidence.map((item) => item.confidence), 0);
  const corroborationBonus = Math.min(0.12, Math.max(0, uniqueFamilies - 1) * 0.06);
  return Math.min(0.96, base + corroborationBonus);
}

async function tryFetchGeneralFactResearch(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const rewrite = rewriteResearchQuery(args);
  const subject = rewrite.canonicalSubject;
  if (!subject || subject.length < 2) {
    return null;
  }

  const language = extractLanguage(args);
  const question = extractStringArg(args, "query") ?? subject;
  const comparisonSubjects = extractComparisonSubjects(question);
  const resolvedSubjects = comparisonSubjects.length === 2 ? comparisonSubjects : [subject];
  const evidence: GeneralKnowledgeEvidence[] = [];
  for (const resolvedSubject of resolvedSubjects) {
    const subjectRewrite = rewriteGeneralKnowledgeQuery({
      question,
      subject: resolvedSubject,
      language
    });
    const subjectFrame = {
      ...semanticFrameFromRouting({
        routing: args,
        question
      }),
      subject: subjectRewrite.canonicalSubject
    };
    const researchCandidates = uniqueStrings([
      ...buildSemanticSearchCandidates(subjectRewrite.canonicalSubject, subjectFrame),
      ...subjectRewrite.candidates
    ]);
    const subjectEvidence: GeneralKnowledgeEvidence[] = [];
    for (const officialEvidence of await fetchOfficialTechnicalEvidence({
      subject: subjectRewrite.canonicalSubject,
      question,
      semanticFrame: subjectFrame
    })) {
      addEvidence(subjectEvidence, officialEvidence);
    }

    for (const candidate of researchCandidates) {
      for (const wikipediaLanguage of wikipediaLanguageOrder(language)) {
        const summary = await fetchWikipediaSummary(
          candidate,
          wikipediaLanguage,
          subjectFrame,
          subjectRewrite.canonicalSubject
        );
        if (!summary) {
          continue;
        }
        addEvidence(subjectEvidence, {
          title: `Wikipedia: ${summary.title}`,
          url: summary.url,
          snippet: summary.description || summary.excerpt.slice(0, 180),
          excerpt: `${summary.title}: ${summary.excerpt}`,
          engine: "known_endpoint",
          origin: "known_endpoint",
          confidence: 0.88,
          language: wikipediaLanguage === "fr" ? "fr" : "en",
          modifiedAt: summary.timestamp,
          dateSource: summary.timestamp ? "meta" : "unknown"
        });
        break;
      }
      if (subjectEvidence.length > 0) {
        break;
      }
    }

    for (const candidate of researchCandidates) {
      addEvidence(
        subjectEvidence,
        await fetchWikidataEntity(candidate, language, subjectFrame, subjectRewrite.canonicalSubject)
      );
      if (subjectEvidence.length >= 2) {
        break;
      }
    }

    if (subjectEvidence.length < 2) {
      for (const candidate of researchCandidates) {
        addEvidence(
          subjectEvidence,
          await searchBritannica(candidate, subjectFrame, subjectRewrite.canonicalSubject)
        );
        if (subjectEvidence.length >= 2) {
          break;
        }
      }
    }

    if (subjectEvidence.length < 2) {
      for (const candidate of researchCandidates) {
        for (const item of await searchGenericFactSources(candidate, subjectFrame, subjectRewrite.canonicalSubject)) {
          addEvidence(subjectEvidence, item);
        }
        if (subjectEvidence.length >= 2) {
          break;
        }
      }
    }

    if (subjectEvidence.length === 0) {
      return null;
    }
    if (!hasIntentAdequateEvidence(subjectEvidence, subjectFrame)) {
      return null;
    }
    subjectEvidence
      .sort(
        (left, right) =>
          evidenceIntentScore(right, subjectFrame) - evidenceIntentScore(left, subjectFrame) ||
          evidenceLanguageRank(right, language) - evidenceLanguageRank(left, language) ||
          right.confidence - left.confidence
      )
      .slice(0, comparisonSubjects.length === 2 ? 3 : 5)
      .forEach((item) => addEvidence(evidence, item));
  }

  if (!hasReliableGeneralKnowledgeEvidence(evidence)) {
    return null;
  }

  const confidenceScore = corroborationScore(evidence);
  const topEvidence = evidence.slice(0, 5);
  const sourceLabel =
    language === "fr"
      ? `Recherche factuelle v2: ${topEvidence.length} source(s) pertinente(s) trouvee(s) pour ${resolvedSubjects.join(" / ")}; score de corroboration ${Math.round(
          confidenceScore * 100
        )}%.`
      : `Factual research v2: ${topEvidence.length} relevant source(s) found for ${resolvedSubjects.join(" / ")}; corroboration score ${Math.round(
          confidenceScore * 100
        )}%.`;

  return {
    toolType: "research",
    intent: args.intent,
    summary: [sourceLabel],
    verifiedFacts: topEvidence.map((item) => item.excerpt),
    confidenceScore,
    resultLabel: resolvedSubjects.join(" vs "),
    sources: topEvidence.map(evidenceToSource)
  };
}

function sourceTimestamp() {
  return new Date().toISOString();
}

async function geocodeWeatherLocation(location: string): Promise<WeatherLocation | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "fr");
  url.searchParams.set("format", "json");

  const body = await fetchWeatherJson<WeatherGeocodingResponse>(url);
  const match = body?.results?.[0];
  if (
    !match ||
    typeof match.latitude !== "number" ||
    typeof match.longitude !== "number" ||
    !Number.isFinite(match.latitude) ||
    !Number.isFinite(match.longitude)
  ) {
    return null;
  }

  return match;
}

async function fetchCurrentWeather(location: WeatherLocation): Promise<WeatherForecastResponse | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m"
  );
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  return fetchWeatherJson<WeatherForecastResponse>(url);
}

async function tryFetchWeather(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const location = extractWeatherLocation(args);
  if (!location) {
    return null;
  }

  const language = extractLanguage(args);
  const resolved = await geocodeWeatherLocation(location);
  if (!resolved) {
    return null;
  }

  const forecast = await fetchCurrentWeather(resolved);
  const current = forecast?.current;
  if (!current) {
    return null;
  }

  const locationLabel = formatResolvedLocation(resolved);
  const description = weatherDescription(current.weather_code, language);
  const timeLabel = formatWeatherDateTime(current.time, resolved.timezone);
  const temp = formatWeatherNumber(current.temperature_2m);
  const humidity = formatWeatherNumber(current.relative_humidity_2m);
  const precipitation = formatWeatherNumber(current.precipitation, 1);
  const wind = formatWeatherNumber(current.wind_speed_10m);
  const windDirection = windDirectionLabel(current.wind_direction_10m);
  const maxTemp = formatWeatherNumber(forecast.daily?.temperature_2m_max?.[0]);
  const minTemp = formatWeatherNumber(forecast.daily?.temperature_2m_min?.[0]);
  const dailyDescription = weatherDescription(forecast.daily?.weather_code?.[0], language);

  if (!temp) {
    return null;
  }

  const verifiedFacts =
    language === "fr"
      ? [
          `M\u00e9t\u00e9o actuelle pour ${locationLabel}${timeLabel ? ` \u00e0 ${timeLabel}` : ""}: ${description}, temp\u00e9rature ${temp} \u00b0C${wind ? `, vent ${wind} km/h${windDirection ? ` ${windDirection}` : ""}` : ""}${humidity ? `, humidit\u00e9 ${humidity}%` : ""}${precipitation ? `, pr\u00e9cipitation ${precipitation} mm` : ""}.`,
          maxTemp && minTemp
            ? `Pr\u00e9vision du jour pour ${locationLabel}: ${dailyDescription}, maximum ${maxTemp} \u00b0C, minimum ${minTemp} \u00b0C.`
            : null
        ]
      : [
          `Current weather for ${locationLabel}${timeLabel ? ` at ${timeLabel}` : ""}: ${description}, temperature ${temp} deg C${wind ? `, wind ${wind} km/h${windDirection ? ` ${windDirection}` : ""}` : ""}${humidity ? `, humidity ${humidity}%` : ""}${precipitation ? `, precipitation ${precipitation} mm` : ""}.`,
          maxTemp && minTemp
            ? `Today's forecast for ${locationLabel}: ${dailyDescription}, high ${maxTemp} deg C, low ${minTemp} deg C.`
            : null
        ];

  const summary =
    language === "fr"
      ? [`Outil m\u00e9t\u00e9o: ${locationLabel} -> ${description}, ${temp} \u00b0C.`]
      : [`Weather tool result: ${locationLabel} -> ${description}, ${temp} deg C.`];

  return {
    toolType: "weather",
    intent: args.intent,
    summary,
    verifiedFacts: verifiedFacts.filter((fact): fact is string => Boolean(fact)),
    confidenceScore: 0.96,
    resultLabel: `${locationLabel}: ${description}, ${temp} ${language === "fr" ? "\u00b0C" : "deg C"}`
  };
}

function extractCryptoAsset(args: ToolRoutingDecision) {
  const raw = extractStringArg(args, "asset");
  if (!raw) {
    return null;
  }

  return CRYPTO_ASSETS[raw.toUpperCase()] ?? null;
}

function extractEquityAsset(args: ToolRoutingDecision) {
  const raw = extractStringArg(args, "asset");
  if (!raw) {
    return null;
  }

  return EQUITY_ASSETS[raw.toUpperCase()] ?? null;
}

function extractQuoteCurrency(args: ToolRoutingDecision) {
  const raw = extractStringArg(args, "quoteCurrency") ?? "USD";
  return /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : "USD";
}

function formatMarketPrice(value: number, currency: string, language: WeatherLanguage) {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 100 ? 0 : 4
  }).format(value);
}

async function tryFetchCurrentPrice(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const asset = extractCryptoAsset(args);
  if (asset) {
    const quoteCurrency = extractQuoteCurrency(args);
    const quoteKey = quoteCurrency.toLowerCase();
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", asset.id);
    url.searchParams.set("vs_currencies", quoteKey);
    url.searchParams.set("include_last_updated_at", "true");

    const body = await fetchJson<CoinGeckoSimplePriceResponse>(url);
    const price = body?.[asset.id]?.[quoteKey];
    if (typeof price !== "number" || !Number.isFinite(price)) {
      return null;
    }

    const language = extractLanguage(args);
    const formatted = formatMarketPrice(price, quoteCurrency, language);
    const updatedAt = body?.[asset.id]?.last_updated_at;
    const updatedLabel =
      typeof updatedAt === "number" && Number.isFinite(updatedAt)
        ? new Date(updatedAt * 1000).toISOString()
        : sourceTimestamp();
    const symbol = extractStringArg(args, "asset")?.toUpperCase() ?? asset.id.toUpperCase();
    const fact =
      language === "fr"
        ? `Prix actuel de ${asset.label} (${symbol}): ${formatted} selon CoinGecko, verifie a ${updatedLabel}.`
        : `Current ${asset.label} (${symbol}) price: ${formatted} according to CoinGecko, checked at ${updatedLabel}.`;
    const sourceUrl = url.toString();

    return {
      toolType: "finance",
      intent: args.intent,
      summary: [
        language === "fr"
          ? `Outil finance: ${asset.label} (${symbol}) -> ${formatted}.`
          : `Finance tool result: ${asset.label} (${symbol}) -> ${formatted}.`
      ],
      verifiedFacts: [fact],
      confidenceScore: 0.96,
      resultLabel: `${asset.label} (${symbol}) ${formatted}`,
      sources: [
        {
          title: "CoinGecko Simple Price API",
          url: sourceUrl,
          snippet: "CoinGecko simple price endpoint for current crypto asset prices.",
          excerpt: fact,
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: updatedLabel,
          dateSource: "time",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        }
      ]
    };
  }

  return tryFetchEquityPrice(args);
}

async function tryFetchEquityPrice(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const asset = extractEquityAsset(args);
  if (!asset) {
    return null;
  }

  const url = new URL("https://stooq.com/q/l/");
  url.searchParams.set("s", asset.stooqSymbol);
  url.searchParams.set("f", "sd2t2ohlcv");
  url.searchParams.set("h", "");
  url.searchParams.set("e", "csv");

  const csv = await fetchText(url.toString());
  const [, row] = csv?.trim().split(/\r?\n/) ?? [];
  const fields = row ? parseCsvLine(row) : [];
  const close = Number(fields[6]);
  if (!Number.isFinite(close)) {
    return null;
  }

  const language = extractLanguage(args);
  const formatted = formatMarketPrice(close, "USD", language);
  const date = fields[1] && fields[1] !== "N/D" ? fields[1] : sourceTimestamp().slice(0, 10);
  const time = fields[2] && fields[2] !== "N/D" ? fields[2] : null;
  const updatedLabel = time ? `${date} ${time}` : date;
  const fact =
    language === "fr"
      ? `Dernier cours disponible de ${asset.label} (${asset.symbol}): ${formatted} selon Stooq, verifie a ${updatedLabel}.`
      : `Latest available ${asset.label} (${asset.symbol}) quote: ${formatted} according to Stooq, checked at ${updatedLabel}.`;

  return {
    toolType: "finance",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil finance: ${asset.label} (${asset.symbol}) -> ${formatted}.`
        : `Finance tool result: ${asset.label} (${asset.symbol}) -> ${formatted}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.92,
    resultLabel: `${asset.label} (${asset.symbol}) ${formatted}`,
    sources: [
      {
        title: "Stooq quote CSV",
        url: url.toString(),
        snippet: "Stooq quote endpoint for latest available equity prices.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: updatedLabel,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function normalizeCurrentSubject(value: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildOpenAiCeoMatch(text: string, url: string): CurrentStatusMatch | null {
  const cleaned = stripHtml(text);
  const evidence =
    cleaned.match(/(?:(?:CEO|Chief Executive|director ejecutivo)\s+Sam Altman|Sam Altman[^.]{0,120}(?:CEO|Chief Executive|director ejecutivo|CEO of OpenAI)|I remain the CEO of OpenAI)[^.]*\./i)?.[0] ??
    cleaned.match(/(?:CEO|Chief Executive|director ejecutivo)\s+Sam Altman/i)?.[0] ??
    null;

  if (!evidence || !/Sam Altman/i.test(evidence)) {
    return null;
  }

  const fact = "As of the live OpenAI source check, Sam Altman is the CEO of OpenAI.";
  return {
    label: "Sam Altman",
    fact,
    excerpt: evidence,
    sources: [
      {
        title: "OpenAI official source",
        url,
        snippet: "Official OpenAI page containing current leadership wording.",
        excerpt: evidence,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function buildFrancePresidentMatch(text: string, url: string): CurrentStatusMatch | null {
  const cleaned = stripHtml(text);
  const evidence =
    cleaned.match(/Emmanuel Macron[^.]{0,120}(?:President of the French Republic|President)/i)?.[0] ??
    cleaned.match(/President of the French Republic[^.]{0,120}Emmanuel Macron/i)?.[0] ??
    null;

  if (!evidence || !/Emmanuel Macron/i.test(evidence)) {
    return null;
  }

  const fact = "As of the live Elysee source check, Emmanuel Macron is the president of France.";
  return {
    label: "Emmanuel Macron",
    fact,
    excerpt: evidence,
    sources: [
      {
        title: "Elysee official source",
        url,
        snippet: "Official French presidency page containing current president wording.",
        excerpt: evidence,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function buildMicrosoftCeoMatch(text: string, url: string): CurrentStatusMatch | null {
  const cleaned = stripHtml(text);
  const evidence =
    cleaned.match(/Satya Nadella[^.]{0,120}(?:Chairman and CEO|CEO|Chief Executive Officer)/i)?.[0] ??
    cleaned.match(/(?:Chairman and CEO|CEO|Chief Executive Officer)[^.]{0,120}Satya Nadella/i)?.[0] ??
    null;

  if (!evidence || !/Satya Nadella/i.test(evidence)) {
    return null;
  }

  const fact = "As of the live Microsoft source check, Satya Nadella is the CEO of Microsoft.";
  return {
    label: "Satya Nadella",
    fact,
    excerpt: evidence,
    sources: [
      {
        title: "Microsoft official source",
        url,
        snippet: "Official Microsoft page containing current leadership wording.",
        excerpt: evidence,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchGitHubStatus(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const subject = normalizeCurrentSubject(extractStringArg(args, "subject"));
  if (!subject.includes("github")) {
    return null;
  }

  const url = new URL("https://www.githubstatus.com/api/v2/status.json");
  const body = await fetchJson<GitHubStatusResponse>(url);
  const indicator = body?.status?.indicator;
  const description = body?.status?.description;
  if (!indicator || !description) {
    return null;
  }

  const language = extractLanguage(args);
  const fact =
    language === "fr"
      ? `Statut GitHub actuel: ${description} (indicateur ${indicator}) selon l'API GitHub Status.`
      : `Current GitHub status: ${description} (indicator ${indicator}) according to the GitHub Status API.`;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil statut: GitHub -> ${description}.`
        : `Status tool result: GitHub -> ${description}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.96,
    resultLabel: `GitHub status: ${description}`,
    sources: [
      {
        title: body.page?.name ?? "GitHub Status API",
        url: url.toString(),
        snippet: "GitHub Status API current status endpoint.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchCurrentStatus(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const role = normalizeCurrentSubject(extractStringArg(args, "role"));
  const subject = normalizeCurrentSubject(extractStringArg(args, "subject"));
  const language = extractLanguage(args);

  if (role === "status" || subject.includes("status")) {
    const status = await tryFetchGitHubStatus(args);
    if (status) {
      return status;
    }
  }

  let match: CurrentStatusMatch | null = null;
  if (role === "ceo" && subject === "openai") {
    const fallbackUrl = "https://openai.com/our-structure/";
    for (const url of [
      fallbackUrl,
      "https://openai.com/index/leadership-expansion-with-fidji-simo/"
    ]) {
      const text = await fetchReadableText(url);
      if (!text) {
        continue;
      }
      match = buildOpenAiCeoMatch(text, url);
      if (match) {
        break;
      }
    }
  }

  if (role === "president" && (subject === "france" || subject === "french republic")) {
    const fallbackUrl = "https://www.elysee.fr/en/emmanuel-macron";
    for (const url of [
      fallbackUrl,
      "https://www.elysee.fr/en/french-presidency/emmanuel-macron"
    ]) {
      const text = await fetchText(url);
      if (!text) {
        continue;
      }
      match = buildFrancePresidentMatch(text, url);
      if (match) {
        break;
      }
    }
  }

  if (role === "ceo" && subject === "microsoft") {
    const fallbackUrl = "https://news.microsoft.com/exec/satya-nadella/";
    for (const url of [
      fallbackUrl,
      "https://www.microsoft.com/en-us/about/leadership"
    ]) {
      const text = await fetchText(url);
      if (!text) {
        continue;
      }
      match = buildMicrosoftCeoMatch(text, url);
      if (match) {
        break;
      }
    }
  }

  if (!match) {
    return null;
  }

  const fact =
    language === "fr"
      ? role === "ceo" && subject === "openai"
        ? `Selon une source officielle OpenAI, ${match.label} est le CEO d'OpenAI.`
        : role === "ceo" && subject === "microsoft"
          ? `Selon une source officielle Microsoft, ${match.label} est le CEO de Microsoft.`
        : role === "president" && (subject === "france" || subject === "french republic")
          ? `Selon une source officielle de l'Elysee, ${match.label} est le president de la France.`
          : match.fact
      : match.fact;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil web: ${match.label} confirme par une source officielle.`
        : `Web tool result: ${match.label} confirmed by an official source.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.93,
    resultLabel: match.label,
    sources: match.sources
  };
}

function formatTimeInLocation(intent: string, location: string | null) {
  const key = location?.toLowerCase() ?? "utc";
  const timeZone = CITY_TIMEZONES[key] ?? CITY_TIMEZONES.utc;
  const now = new Date();
  const options =
    intent === "current_date"
      ? ({
          timeZone,
          year: "numeric",
          month: "long",
          day: "numeric"
        } as const)
      : ({
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          year: "numeric",
          month: "long",
          day: "numeric"
        } as const);
  const formatted = new Intl.DateTimeFormat("en-US", options).format(now);
  const label = location ? `${formatted} (${location})` : `${formatted} (UTC)`;

  return {
    label,
    fact:
      intent === "current_date"
        ? `Current date: ${label}.`
        : `Current time: ${label}.`
  };
}

function tryConvertUnits(args: ToolRoutingDecision) {
  const value = typeof args.extractedArgs?.value === "number" ? args.extractedArgs.value : null;
  const fromRaw =
    typeof args.extractedArgs?.fromUnit === "string" ? args.extractedArgs.fromUnit : null;
  const toRaw = typeof args.extractedArgs?.toUnit === "string" ? args.extractedArgs.toUnit : null;
  if (value === null || !fromRaw || !toRaw) {
    return null;
  }

  const from = UNIT_ALIASES[fromRaw.toLowerCase()];
  const to = UNIT_ALIASES[toRaw.toLowerCase()];
  if (!from || !to || from === to) {
    return null;
  }

  const conversions: Array<{ from: string; to: string; factor?: number; transform?: (n: number) => number }> = [
    { from: "km", to: "mi", factor: 0.621371 },
    { from: "mi", to: "km", factor: 1.60934 },
    { from: "m", to: "ft", factor: 3.28084 },
    { from: "ft", to: "m", factor: 0.3048 },
    { from: "kg", to: "lb", factor: 2.20462 },
    { from: "lb", to: "kg", factor: 0.453592 },
    { from: "h", to: "min", factor: 60 },
    { from: "min", to: "h", factor: 1 / 60 },
    { from: "min", to: "s", factor: 60 },
    { from: "s", to: "min", factor: 1 / 60 },
    { from: "c", to: "f", transform: (n) => (n * 9) / 5 + 32 },
    { from: "f", to: "c", transform: (n) => ((n - 32) * 5) / 9 }
  ];

  const conversion = conversions.find((entry) => entry.from === from && entry.to === to);
  if (!conversion) {
    return null;
  }

  const result = conversion.transform
    ? conversion.transform(value)
    : value * (conversion.factor ?? 1);
  return `${normalizeNumber(value)} ${from} = ${normalizeNumber(result)} ${to}`;
}

function tryConvertCurrency(args: ToolRoutingDecision): LocalToolExecutionResult | null {
  const amount = typeof args.extractedArgs?.amount === "number" ? args.extractedArgs.amount : null;
  const rate = typeof args.extractedArgs?.rate === "number" ? args.extractedArgs.rate : null;
  const from = extractStringArg(args, "from")?.toUpperCase() ?? null;
  const to = extractStringArg(args, "to")?.toUpperCase() ?? null;
  const language = extractLanguage(args);

  if (
    amount === null ||
    rate === null ||
    !from ||
    !to ||
    from === to ||
    !Number.isFinite(amount) ||
    !Number.isFinite(rate)
  ) {
    return null;
  }

  const result = amount * rate;
  const label = `${normalizeNumber(amount)} ${from} = ${normalizeNumber(result)} ${to}`;
  const fact =
    language === "fr"
      ? `Conversion calculee: ${normalizeNumber(amount)} ${from} * ${normalizeNumber(rate)} = ${normalizeNumber(result)} ${to}.`
      : `Computed conversion: ${normalizeNumber(amount)} ${from} * ${normalizeNumber(rate)} = ${normalizeNumber(result)} ${to}.`;

  return {
    toolType: "calculator",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil calculatrice: ${label} avec un taux ${from}/${to} de ${normalizeNumber(rate)}.`
        : `Calculator result: ${label} at ${from}/${to} rate ${normalizeNumber(rate)}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 1,
    resultLabel: label
  };
}

async function tryFetchExchangeRate(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const from = extractStringArg(args, "from")?.toUpperCase() ?? null;
  const to = extractStringArg(args, "to")?.toUpperCase() ?? null;
  const amount = typeof args.extractedArgs?.amount === "number" ? args.extractedArgs.amount : null;
  const language = extractLanguage(args);

  if (!from || !to || from === to || !/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return null;
  }

  const url = new URL("https://api.frankfurter.app/latest");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const body = await fetchJson<FrankfurterLatestResponse>(url);
  const rate = body?.rates?.[to];
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    return null;
  }

  const date = body?.date ?? sourceTimestamp().slice(0, 10);
  const rateLabel = `1 ${from} = ${normalizeNumber(rate)} ${to}`;
  const converted = amount !== null && Number.isFinite(amount)
    ? `${normalizeNumber(amount)} ${from} = ${normalizeNumber(amount * rate)} ${to}`
    : null;
  const fact =
    language === "fr"
      ? converted
        ? `Conversion avec le dernier taux Frankfurter disponible (${date}): ${converted}; taux ${rateLabel}.`
        : `Dernier taux Frankfurter disponible (${date}): ${rateLabel}.`
      : converted
        ? `Conversion using the latest available Frankfurter rate (${date}): ${converted}; rate ${rateLabel}.`
        : `Latest available Frankfurter rate (${date}): ${rateLabel}.`;

  return {
    toolType: "calculator",
    intent: args.intent,
    summary: [
      language === "fr"
        ? `Outil taux de change: ${converted ?? rateLabel}.`
        : `Exchange-rate tool result: ${converted ?? rateLabel}.`
    ],
    verifiedFacts: [fact],
    confidenceScore: 0.94,
    resultLabel: converted ?? rateLabel,
    sources: [
      {
        title: "Frankfurter latest exchange rates",
        url: url.toString(),
        snippet: "Frankfurter latest endpoint for European Central Bank exchange rates.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: date,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

function extractGitHubRepo(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, "")
  };
}

async function tryFetchGitHubRepoStructure(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const repoHint =
    extractStringArg(args, "repo") ??
    extractStringArg(args, "url") ??
    extractStringArg(args, "repository");
  const repo = extractGitHubRepo(repoHint);
  if (!repo) {
    return tryInspectLocalRepoStructure(args);
  }

  const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contents`);
  const body = await fetchJson<GitHubContentItem[]>(url);
  if (!Array.isArray(body) || body.length === 0) {
    return null;
  }

  const dirs = body
    .filter((item) => item.type === "dir" && item.name)
    .map((item) => item.name!)
    .slice(0, 12);
  const files = body
    .filter((item) => item.type === "file" && item.name)
    .map((item) => item.name!)
    .slice(0, 12);
  const label = `${repo.owner}/${repo.repo}`;
  const fact = `GitHub repository ${label} root contains directories: ${dirs.join(", ") || "none listed"}; files: ${files.join(", ") || "none listed"}.`;

  return {
    toolType: "repo",
    intent: args.intent,
    summary: [`Repo tool result: ${label} root structure fetched from GitHub API.`],
    verifiedFacts: [fact],
    confidenceScore: 0.9,
    resultLabel: `${label} root: ${dirs.length} dirs, ${files.length} files`,
    sources: [
      {
        title: `GitHub API contents for ${label}`,
        url: url.toString(),
        snippet: "GitHub repository root contents endpoint.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryInspectLocalRepoStructure(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const repoHint = [
    extractStringArg(args, "repo"),
    extractStringArg(args, "repository"),
    extractStringArg(args, "fileHint")
  ].filter(Boolean).join(" ");

  if (
    repoHint &&
    !/\b(?:hydria|mon repo|my repo|this repo|current repo|learning governance|project)\b/i.test(repoHint)
  ) {
    return null;
  }

  const entries = await readdir(projectRoot, { withFileTypes: true });
  const ignored = new Set(["node_modules", ".git", "outputs"]);
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !ignored.has(entry.name))
    .map((entry) => entry.name)
    .sort()
    .slice(0, 16);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .slice(0, 16);
  const relativeRoot = relative(projectRoot, projectRoot) || ".";
  const fact = `Local repository ${relativeRoot} root contains directories: ${dirs.join(", ") || "none listed"}; files: ${files.join(", ") || "none listed"}.`;

  return {
    toolType: "repo",
    intent: args.intent,
    summary: ["Repo tool result: local project root structure inspected."],
    verifiedFacts: [fact],
    confidenceScore: 0.86,
    resultLabel: `local repo root: ${dirs.length} dirs, ${files.length} files`,
    sources: [
      {
        title: "Local project filesystem",
        url: "https://local.hydria.invalid/project-root",
        snippet: "Local repository root directory listing.",
        excerpt: fact,
        publishedAt: null,
        modifiedAt: null,
        effectiveDate: sourceTimestamp(),
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchLatestRelease(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const subject = normalizeCurrentSubject(extractStringArg(args, "subject"));
  if (subject.includes("node")) {
    return tryFetchNodeLatestRelease(args);
  }

  if (subject.includes("react")) {
    return tryFetchReactLatestRelease(args);
  }

  return null;
}

async function tryFetchReactLatestRelease(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const url = new URL("https://api.github.com/repos/facebook/react/releases/latest");
  const body = await fetchJson<GitHubReleaseResponse>(url);
  const tag = body?.tag_name;
  if (!tag) {
    return null;
  }

  const publishedAt = body.published_at ?? sourceTimestamp();
  const releaseUrl = body.html_url ?? "https://github.com/facebook/react/releases";
  const fact = `Latest React GitHub release: ${tag}${body.name ? ` (${body.name})` : ""}, published at ${publishedAt}.`;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [`Release tool result: React -> ${tag}.`],
    verifiedFacts: [fact],
    confidenceScore: 0.94,
    resultLabel: `React ${tag}`,
    sources: [
      {
        title: "React latest GitHub release",
        url: releaseUrl,
        snippet: "GitHub releases/latest endpoint for facebook/react.",
        excerpt: fact,
        publishedAt,
        modifiedAt: null,
        effectiveDate: publishedAt,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

async function tryFetchNodeLatestRelease(args: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
  const url = new URL("https://nodejs.org/dist/index.json");
  const releases = await fetchJson<NodeReleaseEntry[]>(url);
  if (!Array.isArray(releases) || releases.length === 0) {
    return null;
  }

  const latest = releases.find((entry) => typeof entry.version === "string" && entry.version.length > 0);
  const latestLts = releases.find((entry) => entry.lts);
  if (!latest?.version) {
    return null;
  }

  const publishedAt = latest.date ?? sourceTimestamp().slice(0, 10);
  const ltsDetail =
    latestLts?.version && latestLts.version !== latest.version
      ? ` Latest LTS release: ${latestLts.version}${latestLts.lts ? ` (${latestLts.lts})` : ""}${
          latestLts.date ? `, dated ${latestLts.date}` : ""
        }.`
      : "";
  const fact = `Latest Node.js release listed by nodejs.org: ${latest.version}, dated ${publishedAt}.${ltsDetail}`;

  return {
    toolType: "web",
    intent: args.intent,
    summary: [`Release tool result: Node.js -> ${latest.version}.`],
    verifiedFacts: [fact],
    confidenceScore: 0.94,
    resultLabel: `Node.js ${latest.version}`,
    sources: [
      {
        title: "Node.js release index",
        url: url.toString(),
        snippet: "Official Node.js distribution release index.",
        excerpt: fact,
        publishedAt,
        modifiedAt: null,
        effectiveDate: publishedAt,
        dateSource: "time",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  };
}

export class LocalToolExecutionService {
  private readonly executionGovernanceService: Pick<ExecutionGovernanceService, "plan"> | null;

  constructor(options: LocalToolExecutionServiceOptions = {}) {
    this.executionGovernanceService =
      options.executionGovernanceService === undefined
        ? ExecutionGovernanceService.persistent()
        : options.executionGovernanceService;
  }

  async tryExecute(routing: ToolRoutingDecision): Promise<LocalToolExecutionResult | null> {
    if (!routing.toolRequired) {
      return null;
    }

    const executionAuditIds = await this.auditSensitiveRoute(routing);
    const attachAuditIds = (result: LocalToolExecutionResult | null): LocalToolExecutionResult | null =>
      result
        ? {
            ...result,
            executionAuditIds
          }
        : null;

    if (routing.toolType === "weather" && routing.intent === "current_weather") {
      return attachAuditIds(await tryFetchWeather(routing));
    }

    if (routing.toolType === "finance" && routing.intent === "current_price") {
      return attachAuditIds(await tryFetchCurrentPrice(routing));
    }

    if (routing.toolType === "web" && routing.intent === "current_status") {
      return attachAuditIds(await tryFetchCurrentStatus(routing));
    }

    if (routing.toolType === "web" && routing.intent === "latest_release") {
      return attachAuditIds(await tryFetchLatestRelease(routing));
    }

    if (routing.toolType === "research" && routing.intent === "recent_updates") {
      return attachAuditIds(await tryFetchRecentUpdates(routing));
    }

    if (routing.toolType === "research" && routing.intent === "fact_check") {
      return attachAuditIds(await tryFetchGeneralFactResearch(routing));
    }

    if (routing.toolType === "time" && (routing.intent === "current_time" || routing.intent === "current_date")) {
      const location = extractLocation(routing);
      const { label, fact } = formatTimeInLocation(routing.intent, location);
      return attachAuditIds({
        toolType: "time",
        intent: routing.intent,
        summary: [`Time tool result: ${label}`],
        verifiedFacts: [fact],
        confidenceScore: 1,
        resultLabel: label
      });
    }

    if (routing.toolType === "calculator" && routing.intent === "arithmetic") {
      const expression =
        typeof routing.extractedArgs?.expression === "string" ? routing.extractedArgs.expression : "";
      const result = evaluateArithmetic(expression);
      if (result === null) {
        return null;
      }

      const label = `${expression} = ${normalizeNumber(result)}`;
      return attachAuditIds({
        toolType: "calculator",
        intent: routing.intent,
        summary: [`Calculator result: ${label}`],
        verifiedFacts: [`Computed result: ${label}.`],
        confidenceScore: 1,
        resultLabel: label
      });
    }

    if (routing.toolType === "calculator" && routing.intent === "unit_conversion") {
      const label = tryConvertUnits(routing);
      if (!label) {
        return null;
      }

      return attachAuditIds({
        toolType: "calculator",
        intent: routing.intent,
        summary: [`Unit conversion result: ${label}`],
        verifiedFacts: [`Computed conversion: ${label}.`],
        confidenceScore: 1,
        resultLabel: label
      });
    }

    if (routing.toolType === "calculator" && routing.intent === "currency_conversion") {
      return attachAuditIds(tryConvertCurrency(routing) ?? await tryFetchExchangeRate(routing));
    }

    if (routing.toolType === "repo" && routing.intent === "repo_analysis") {
      return attachAuditIds(await tryFetchGitHubRepoStructure(routing));
    }

    return null;
  }

  private async auditSensitiveRoute(routing: ToolRoutingDecision): Promise<string[]> {
    if (!this.executionGovernanceService) {
      return [];
    }
    const request = buildLocalToolGovernanceRequest(routing);
    if (!request) {
      return [];
    }
    try {
      const plan = await this.executionGovernanceService.plan(request);
      return [plan.auditEvent.auditId];
    } catch (error) {
      logger.warn("Local tool execution audit failed", {
        toolType: routing.toolType,
        intent: routing.intent,
        error: String(error)
      });
      return [];
    }
  }
}

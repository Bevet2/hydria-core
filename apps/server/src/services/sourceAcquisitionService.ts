import { load } from "cheerio";
import { WATCHER_SOURCE_PACKS, type WatcherSourcePack } from "../data/watcherSourcePacks.js";
import {
  sourceAcquisitionItemSchema,
  type SourceAcquisitionFile,
  type SourceAcquisitionItem,
  type SourceAcquisitionSourceRun
} from "../types/sourceAcquisition.js";
import { env } from "../utils/env.js";
import { BrowserAutomationPolicyService } from "./browser/browserAutomationPolicyService.js";
import { ExecutionAuditStore } from "./execution/executionAuditStore.js";
import { ScraplingFetcherClient, type ScraplingExtractResult } from "./scraplingFetcherClient.js";
import { SourceAcquisitionStore } from "./sourceAcquisitionStore.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type SourceAcquisitionServiceOptions = {
  sourcePacks?: WatcherSourcePack[];
  store?: Pick<SourceAcquisitionStore, "upsert" | "save" | "load">;
  fetcher?: FetchLike;
  scraplingClient?: Pick<ScraplingFetcherClient, "isConfigured" | "extract"> | null;
  browserAutomationPolicyService?: Pick<BrowserAutomationPolicyService, "plan"> | null;
  now?: () => Date;
};

type RunOptions = {
  networkEnabled?: boolean;
  persistMode?: "replace" | "upsert";
  maxPacks?: number;
  maxSourcesPerPack?: number;
  maxItemsPerSource?: number;
  timeoutMs?: number;
};

type ParsedItem = {
  title: string;
  summary: string;
  content: string;
  publishedAt?: string | null;
  tags?: string[];
};

const SOURCE_PACK_TAG = "source-pack";

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return normalized.slice(0, maxChars);
  }

  return `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decayFor(pack: WatcherSourcePack, retrievedAt: string) {
  const base = new Date(retrievedAt);
  if (pack.freshness === "live") {
    return {
      policy: "fast" as const,
      retrievedAt,
      refreshAfter: addDays(base, 2),
      expiresAt: addDays(base, 7),
      rationale: "Live source-acquired knowledge must be refreshed before runtime promotion."
    };
  }
  if (pack.freshness === "recent") {
    return {
      policy: "standard" as const,
      retrievedAt,
      refreshAfter: addDays(base, 14),
      expiresAt: addDays(base, 45),
      rationale: "Recent release knowledge expires unless refreshed from source."
    };
  }
  if (pack.freshness === "stable") {
    return {
      policy: "slow" as const,
      retrievedAt,
      refreshAfter: addDays(base, 180),
      expiresAt: null,
      rationale: "Stable source-acquired knowledge decays slowly and still needs review."
    };
  }

  return {
    policy: "standard" as const,
    retrievedAt,
    refreshAfter: addDays(base, 30),
    expiresAt: null,
    rationale: "Unknown freshness requires standard review before promotion."
  };
}

function sourceRunId(pack: WatcherSourcePack, sourceUrl: string, retrievedAt: string) {
  return `source-run::${pack.packId}::${stableShortHash(`${sourceUrl}:${retrievedAt}`)}`;
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function headersToRecord(headers: Headers) {
  const entries: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    entries.push([key, value]);
  });
  return Object.fromEntries(entries);
}

function itemId(pack: WatcherSourcePack, sourceUrl: string, title: string) {
  return `source-acquisition::${pack.packId}::${stableShortHash(`${sourceUrl}:${title}`)}`;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArrayField(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stripHtml(value: string) {
  return load(value).text().replace(/\s+/g, " ").trim();
}

function parseDateParts(value: unknown) {
  if (!Array.isArray(value) || !Array.isArray(value[0])) {
    return null;
  }
  const [year, month = 1, day = 1] = value[0] as unknown[];
  if (typeof year !== "number") {
    return null;
  }

  return new Date(Date.UTC(year, typeof month === "number" ? month - 1 : 0, typeof day === "number" ? day : 1))
    .toISOString();
}

function invertedIndexToText(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const wordsByIndex = new Map<number, string>();
  for (const [word, positions] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(positions)) {
      continue;
    }
    for (const position of positions) {
      if (typeof position === "number") {
        wordsByIndex.set(position, word);
      }
    }
  }

  return [...wordsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, word]) => word)
    .join(" ");
}

function parseFeedXml(body: string, sourceLabel: string, maxItems: number): ParsedItem[] {
  const $ = load(body, { xmlMode: true });
  const rssItems = $("item")
    .toArray()
    .slice(0, maxItems)
    .flatMap((entry) => {
      const node = $(entry);
      const title = compact(node.find("title").first().text(), 180);
      const link = compact(node.find("link").first().text(), 240);
      const description = compact(
        stripHtml(
          node.find("description").first().text() ||
            node.find("content\\:encoded").first().text() ||
            `${sourceLabel} published ${title}`
        ),
        720
      );
      if (!title) {
        return [];
      }
      const publishedAt = parseDate(node.find("pubDate").first().text());
      return [
        {
          title,
          summary: description || title,
          content: compact(
            [
              title,
              publishedAt ? `Published at ${publishedAt}.` : null,
              link ? `Source URL: ${link}.` : null,
              description
            ].filter(Boolean).join(" "),
            1200
          ),
          publishedAt,
          tags: ["feed-source", "rss-item"]
        }
      ];
    });

  if (rssItems.length > 0) {
    return rssItems;
  }

  return $("entry")
    .toArray()
    .slice(0, maxItems)
    .flatMap((entry) => {
      const node = $(entry);
      const title = compact(node.find("title").first().text(), 180);
      const link = compact(
        node.find("link[rel='alternate']").attr("href") || node.find("id").first().text(),
        240
      );
      const summary = compact(stripHtml(node.find("summary").first().text() || title), 720);
      if (!title) {
        return [];
      }
      const publishedAt =
        parseDate(node.find("published").first().text()) ??
        parseDate(node.find("updated").first().text());
      return [
        {
          title,
          summary,
          content: compact(
            [
              title,
              publishedAt ? `Published at ${publishedAt}.` : null,
              link ? `Source URL: ${link}.` : null,
              summary
            ].filter(Boolean).join(" "),
            1200
          ),
          publishedAt,
          tags: ["feed-source", "atom-entry"]
        }
      ];
    });
}

function parseCisaKev(json: Record<string, unknown>, maxItems: number): ParsedItem[] {
  const vulnerabilities = Array.isArray(json.vulnerabilities) ? json.vulnerabilities : [];
  return vulnerabilities.slice(0, maxItems).flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const item = entry as Record<string, unknown>;
    const cve = stringField(item.cveID);
    const name = stringField(item.vulnerabilityName);
    const product = [stringField(item.vendorProject), stringField(item.product)].filter(Boolean).join(" ");
    const title = compact([cve, product, name].filter(Boolean).join(" - "), 180);
    if (!title) {
      return [];
    }

    return [
      {
        title,
        summary: compact(stringField(item.shortDescription) || stringField(item.requiredAction) || name),
        content: compact(
          [
            `CVE: ${cve}`,
            `Product: ${product || "unknown"}`,
            `Known ransomware use: ${stringField(item.knownRansomwareCampaignUse) || "unknown"}`,
            `Required action: ${stringField(item.requiredAction) || "not provided"}`
          ].join(" "),
          1200
        ),
        publishedAt: parseDate(item.dateAdded),
        tags: ["cisa-kev", "cve"]
      }
    ];
  });
}

function parseNvd(json: Record<string, unknown>, maxItems: number): ParsedItem[] {
  const vulnerabilities = Array.isArray(json.vulnerabilities) ? json.vulnerabilities : [];
  return vulnerabilities.slice(0, maxItems).flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const cve = (entry as Record<string, unknown>).cve;
    if (!cve || typeof cve !== "object") {
      return [];
    }
    const record = cve as Record<string, unknown>;
    const id = stringField(record.id);
    const descriptions = Array.isArray(record.descriptions) ? record.descriptions : [];
    const description =
      descriptions
        .map((descriptionEntry) =>
          descriptionEntry && typeof descriptionEntry === "object"
            ? stringField((descriptionEntry as Record<string, unknown>).value)
            : ""
        )
        .find(Boolean) ?? "";
    if (!id && !description) {
      return [];
    }

    return [
      {
        title: compact([id, description].filter(Boolean).join(" - "), 180),
        summary: compact(description || id),
        content: compact(description || id, 1200),
        publishedAt: parseDate(record.published),
        tags: ["nvd", "cve"]
      }
    ];
  });
}

function parseCrossrefWork(message: Record<string, unknown>): ParsedItem[] {
  const title = compact(stringArrayField(message.title)[0] || stringField(message.title), 180);
  if (!title) {
    return [];
  }
  const abstract = compact(stripHtml(stringField(message.abstract)), 720);
  const doi = stringField(message.DOI);
  const container = stringArrayField(message["container-title"])[0] ?? "";
  const publisher = stringField(message.publisher);
  const publishedAt =
    parseDateParts((message["published-print"] as Record<string, unknown> | undefined)?.["date-parts"]) ??
    parseDateParts((message.published as Record<string, unknown> | undefined)?.["date-parts"]) ??
    parseDateParts((message.created as Record<string, unknown> | undefined)?.["date-parts"]);

  return [
    {
      title,
      summary: compact(abstract || [container, publisher, doi].filter(Boolean).join(" ")),
      content: compact(
        [
          title,
          doi ? `DOI: ${doi}.` : null,
          container ? `Publication: ${container}.` : null,
          publisher ? `Publisher: ${publisher}.` : null,
          publishedAt ? `Published at ${publishedAt}.` : null,
          abstract
        ].filter(Boolean).join(" "),
        1200
      ),
      publishedAt,
      tags: ["json-source", "crossref", doi ? "doi" : null].filter((tag): tag is string => Boolean(tag))
    }
  ];
}

function parseOpenAlexWork(record: Record<string, unknown>): ParsedItem[] {
  const title = compact(stringField(record.title) || stringField(record.display_name), 180);
  if (!title) {
    return [];
  }
  const abstract = compact(invertedIndexToText(record.abstract_inverted_index), 720);
  const doi = stringField(record.doi).replace(/^https:\/\/doi.org\//, "");
  const publicationDate = parseDate(record.publication_date);
  const year = typeof record.publication_year === "number" ? String(record.publication_year) : "";
  const citedBy = typeof record.cited_by_count === "number" ? String(record.cited_by_count) : "";

  return [
    {
      title,
      summary: compact(abstract || [doi, year ? `publication year ${year}` : null].filter(Boolean).join(" ")),
      content: compact(
        [
          title,
          doi ? `DOI: ${doi}.` : null,
          year ? `Publication year: ${year}.` : null,
          citedBy ? `OpenAlex cited-by count: ${citedBy}.` : null,
          abstract
        ].filter(Boolean).join(" "),
        1200
      ),
      publishedAt: publicationDate,
      tags: ["json-source", "openalex", doi ? "doi" : null].filter((tag): tag is string => Boolean(tag))
    }
  ];
}

function parseWikidataEntity(json: Record<string, unknown>, maxItems: number): ParsedItem[] {
  const entities = json.entities && typeof json.entities === "object"
    ? Object.values(json.entities as Record<string, unknown>)
    : [];
  return entities.slice(0, maxItems).flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const entity = entry as Record<string, unknown>;
    const labels = entity.labels && typeof entity.labels === "object"
      ? entity.labels as Record<string, { value?: unknown }>
      : {};
    const descriptions = entity.descriptions && typeof entity.descriptions === "object"
      ? entity.descriptions as Record<string, { value?: unknown }>
      : {};
    const claims = entity.claims && typeof entity.claims === "object"
      ? entity.claims as Record<string, unknown[]>
      : {};
    const label = stringField(labels.en?.value) || stringField(entity.title) || stringField(entity.id);
    const description = stringField(descriptions.en?.value);
    if (!label) {
      return [];
    }
    const dateClaim = (property: string) => {
      const claim = claims[property]?.[0];
      if (!claim || typeof claim !== "object") {
        return "";
      }
      const mainsnak = (claim as Record<string, unknown>).mainsnak;
      if (!mainsnak || typeof mainsnak !== "object") {
        return "";
      }
      const datavalue = (mainsnak as Record<string, unknown>).datavalue;
      if (!datavalue || typeof datavalue !== "object") {
        return "";
      }
      const value = (datavalue as Record<string, unknown>).value;
      if (!value || typeof value !== "object") {
        return "";
      }
      return stringField((value as Record<string, unknown>).time).replace(/^\+/, "");
    };
    const born = dateClaim("P569");
    const died = dateClaim("P570");
    return [
      {
        title: compact(label, 180),
        summary: compact([description, born ? `born ${born}` : null, died ? `died ${died}` : null].filter(Boolean).join("; ")),
        content: compact(
          [
            `${label} (${stringField(entity.id)})`,
            description,
            born ? `Date of birth: ${born}.` : null,
            died ? `Date of death: ${died}.` : null
          ].filter(Boolean).join(" "),
          1200
        ),
        publishedAt: parseDate(stringField(entity.modified)),
        tags: ["json-source", "wikidata", stringField(entity.id).toLowerCase()].filter(Boolean)
      }
    ];
  });
}

function parseWikipediaSummary(root: Record<string, unknown>): ParsedItem[] {
  const title = compact(stringField(root.title), 180);
  if (!title) {
    return [];
  }
  const description = stringField(root.description);
  const extract = compact(stringField(root.extract), 720);
  const wikibaseItem = stringField(root.wikibase_item);
  return [
    {
      title,
      summary: compact([description, extract].filter(Boolean).join(". ")),
      content: compact(
        [
          title,
          wikibaseItem ? `Wikidata ID: ${wikibaseItem}.` : null,
          description,
          extract
        ].filter(Boolean).join(" "),
        1200
      ),
      publishedAt: parseDate(stringField(root.timestamp)),
      tags: ["json-source", "wikipedia-summary", wikibaseItem.toLowerCase()].filter(Boolean)
    }
  ];
}

function parseHuggingFaceModel(record: Record<string, unknown>): ParsedItem[] {
  const modelId = stringField(record.modelId) || stringField(record.id);
  if (!modelId) {
    return [];
  }
  const tags = stringArrayField(record.tags).slice(0, 8);
  const pipeline = stringField(record.pipeline_tag);
  const library = stringField(record.library_name);
  const lastModified = parseDate(record.lastModified) ?? parseDate(record.createdAt);
  return [
    {
      title: compact(modelId, 180),
      summary: compact(
        [pipeline ? `pipeline ${pipeline}` : null, library ? `library ${library}` : null, ...tags.slice(0, 4)]
          .filter(Boolean).join("; ")
      ),
      content: compact(
        [
          `Hugging Face model: ${modelId}.`,
          pipeline ? `Pipeline: ${pipeline}.` : null,
          library ? `Library: ${library}.` : null,
          tags.length ? `Tags: ${tags.join(", ")}.` : null,
          lastModified ? `Last modified at ${lastModified}.` : null
        ].filter(Boolean).join(" "),
        1200
      ),
      publishedAt: lastModified,
      tags: ["json-source", "huggingface-model", ...tags].slice(0, 12)
    }
  ];
}

function parseGenericJson(json: unknown, maxItems: number): ParsedItem[] {
  if (!json || typeof json !== "object") {
    return [];
  }
  const root = json as Record<string, unknown>;
  if (Array.isArray(root.vulnerabilities)) {
    return [...parseCisaKev(root, maxItems), ...parseNvd(root, maxItems)].slice(0, maxItems);
  }
  if (root.entities) {
    return parseWikidataEntity(root, maxItems);
  }
  if (root.type === "standard" && root.title && root.extract) {
    return parseWikipediaSummary(root);
  }
  if (root.message && typeof root.message === "object") {
    return parseCrossrefWork(root.message as Record<string, unknown>).slice(0, maxItems);
  }
  if (root.id && (root.title || root.display_name) && (root.id as string).includes("openalex.org")) {
    return parseOpenAlexWork(root).slice(0, maxItems);
  }

  const arrays = [
    root.results,
    root.items,
    root.data,
    Array.isArray(json) ? json : null
  ].filter((value): value is unknown[] => Array.isArray(value));
  const entries = arrays[0] ?? [json];

  return entries.slice(0, maxItems).flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (stringField(record.modelId) || stringField(record.id).includes("/")) {
      const model = parseHuggingFaceModel(record);
      if (model.length > 0) {
        return model;
      }
    }
    if (stringField(record.id).includes("openalex.org") && (record.title || record.display_name)) {
      return parseOpenAlexWork(record);
    }
    const title =
      stringField(record.title) ||
      stringField(record.display_name) ||
      stringField(record.modelId) ||
      stringField(record.name) ||
      stringField(record.id);
    const summary =
      stringField(record.summary) ||
      stringField(record.description) ||
      stringField(record.abstract) ||
      stringField(record.snippet) ||
      title;
    if (!title && !summary) {
      return [];
    }

    return [
      {
        title: compact(title || summary, 180),
        summary: compact(summary || title),
        content: compact(summary || title, 1200),
        publishedAt: parseDate(
          record.publishedAt ??
            record.published ??
            record.updated_at ??
            record.created_at ??
            record.createdAt ??
            record.lastModified
        ),
        tags: ["json-source"]
      }
    ];
  });
}

function parseHtml(body: string, sourceLabel: string, maxItems: number): ParsedItem[] {
  const $ = load(body);
  const pageTitle = compact($("title").first().text() || sourceLabel, 180);
  const description = compact(
    $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      $("h1").first().text() ||
      pageTitle
  );
  const structuredItems = $("script[type='application/ld+json']")
    .toArray()
    .flatMap((entry) => {
      const parsed = safeJsonParse($(entry).text());
      const nodes = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
      return nodes.flatMap((node) => {
        const records = node && typeof node === "object" && Array.isArray((node as Record<string, unknown>)["@graph"])
          ? (node as Record<string, unknown>)["@graph"] as unknown[]
          : [node];
        return records.flatMap((record) => {
          if (!record || typeof record !== "object") {
            return [];
          }
          const item = record as Record<string, unknown>;
          const type = Array.isArray(item["@type"]) ? item["@type"].join(" ") : stringField(item["@type"]);
          if (!/Article|BlogPosting|NewsArticle/i.test(type)) {
            return [];
          }
          const title = compact(stringField(item.headline) || stringField(item.name), 180);
          if (!title || normalizeTitle(title) === normalizeTitle(pageTitle)) {
            return [];
          }
          const summary = compact(stringField(item.description) || title, 720);
          const publishedAt = parseDate(item.datePublished) ?? parseDate(item.dateModified);
          return [{
            title,
            summary,
            content: compact([title, publishedAt ? `Published at ${publishedAt}.` : null, summary].filter(Boolean).join(" "), 1200),
            publishedAt,
            tags: ["html-jsonld", "article"]
          }];
        });
      });
    })
    .slice(0, maxItems);

  if (structuredItems.length > 0) {
    return structuredItems;
  }

  const articleItems = $("article,.post,.blog-card,.card")
    .toArray()
    .flatMap((entry) => {
      const node = $(entry);
      const title = compact(node.find("h1,h2,h3,a").first().text(), 180);
      if (!title || normalizeTitle(title) === normalizeTitle(pageTitle)) {
        return [];
      }
      const summary = compact(node.find("p").first().text() || `${sourceLabel}: ${title}`, 720);
      const publishedAt = parseDate(node.find("time").first().attr("datetime") ?? "");
      return [{
        title,
        summary,
        content: compact([title, publishedAt ? `Published at ${publishedAt}.` : null, summary].filter(Boolean).join(" "), 1200),
        publishedAt,
        tags: ["html-article-card"]
      }];
    })
    .slice(0, maxItems);

  if (articleItems.length > 0) {
    return articleItems;
  }

  const headings = $("h1,h2,h3,a")
    .toArray()
    .map((entry) => compact($(entry).text(), 180))
    .filter((text) => text.length >= 12)
    .slice(0, Math.max(1, maxItems - 1));
  const items: ParsedItem[] = [
    {
      title: pageTitle,
      summary: description,
      content: compact(`${pageTitle}. ${description}`, 1200),
      publishedAt: null,
      tags: ["html-source"]
    }
  ];

  for (const heading of headings) {
    items.push({
      title: heading,
      summary: compact(`${sourceLabel}: ${heading}`),
      content: compact(`${sourceLabel}: ${heading}`, 1200),
      publishedAt: null,
      tags: ["html-heading"]
    });
  }

  return items.slice(0, maxItems);
}

function parseSourceBody(args: {
  body: string;
  contentType: string;
  sourceLabel: string;
  maxItems: number;
}) {
  const maybeJson =
    args.contentType.includes("json") || /^[\s\r\n]*[\[{]/.test(args.body)
      ? safeJsonParse(args.body)
      : null;
  if (maybeJson) {
    return parseGenericJson(maybeJson, args.maxItems);
  }
  if (args.contentType.includes("xml") || /^[\s\r\n]*<(rss|feed)\b/i.test(args.body)) {
    return parseFeedXml(args.body, args.sourceLabel, args.maxItems);
  }

  return parseHtml(args.body, args.sourceLabel, args.maxItems);
}

function applyCorroboration(items: SourceAcquisitionItem[], now: Date) {
  const byKey = new Map<string, SourceAcquisitionItem[]>();
  for (const item of items) {
    byKey.set(item.corroborationKey, [...(byKey.get(item.corroborationKey) ?? []), item]);
  }

  return items.map((item) => {
    const peers = byKey.get(item.corroborationKey) ?? [];
    const sourceLabels = [...new Set(peers.map((peer) => peer.sourceLabel))];
    const expired = item.decay.expiresAt ? new Date(item.decay.expiresAt).getTime() <= now.getTime() : false;
    const state =
      expired
        ? "expired"
        : item.riskLevel === "high"
          ? "guarded"
          : sourceLabels.length >= 2
            ? "corroborated"
            : "candidate";
    const confidence = Number(
      Math.min(
        0.92,
        item.confidence + Math.min(sourceLabels.length, 4) * 0.08 - (item.riskLevel === "high" ? 0.08 : 0)
      ).toFixed(3)
    );

    return sourceAcquisitionItemSchema.parse({
      ...item,
      state,
      confidence,
      corroboratedSourceCount: sourceLabels.length,
      corroboratingSources: sourceLabels
    });
  });
}

export class SourceAcquisitionService {
  private readonly sourcePacks: WatcherSourcePack[];
  private readonly store: Pick<SourceAcquisitionStore, "upsert" | "save" | "load">;
  private readonly fetcher: FetchLike;
  private readonly scraplingClient: Pick<ScraplingFetcherClient, "isConfigured" | "extract"> | null;
  private readonly browserAutomationPolicyService: Pick<BrowserAutomationPolicyService, "plan"> | null;
  private readonly now: () => Date;

  constructor(options: SourceAcquisitionServiceOptions = {}) {
    this.sourcePacks = options.sourcePacks ?? WATCHER_SOURCE_PACKS;
    this.store = options.store ?? new SourceAcquisitionStore();
    this.fetcher = options.fetcher ?? fetch;
    this.scraplingClient = options.scraplingClient === undefined ? new ScraplingFetcherClient() : options.scraplingClient;
    this.browserAutomationPolicyService =
      options.browserAutomationPolicyService === undefined
        ? new BrowserAutomationPolicyService({ auditStore: ExecutionAuditStore.persistent() })
        : options.browserAutomationPolicyService;
    this.now = options.now ?? (() => new Date());
  }

  async run(options: RunOptions = {}): Promise<SourceAcquisitionFile> {
    const networkEnabled = options.networkEnabled ?? env.SOURCE_ACQUISITION_NETWORK_ENABLED;
    const maxPacks = options.maxPacks ?? env.SOURCE_ACQUISITION_MAX_PACKS;
    const maxSourcesPerPack =
      options.maxSourcesPerPack ?? env.SOURCE_ACQUISITION_MAX_SOURCES_PER_PACK;
    const maxItemsPerSource =
      options.maxItemsPerSource ?? env.SOURCE_ACQUISITION_MAX_ITEMS_PER_SOURCE;
    const timeoutMs = options.timeoutMs ?? env.SOURCE_ACQUISITION_TIMEOUT_MS;
    const persistMode = options.persistMode ?? "upsert";
    const sourceRuns: SourceAcquisitionSourceRun[] = [];
    const items: SourceAcquisitionItem[] = [];
    const now = this.now();

    for (const pack of this.sourcePacks.slice(0, maxPacks)) {
      for (const source of pack.sources.slice(0, maxSourcesPerPack)) {
        if (!networkEnabled) {
          sourceRuns.push({
            sourceRunId: sourceRunId(pack, source.url, now.toISOString()),
            packId: pack.packId,
            sourceLabel: source.label,
            sourceUrl: source.url,
            fetcher: "node_fetch",
            status: "skipped",
            httpStatus: null,
            itemCount: 0,
            retrievedAt: null,
            error: "network_disabled",
            executionAuditIds: []
          });
          continue;
        }

        const acquired = await this.fetchAndParseSource({
          pack,
          source,
          maxItemsPerSource,
          timeoutMs,
          now
        });
        sourceRuns.push(acquired.sourceRun);
        items.push(...acquired.items);
      }
    }

    const corroborated = applyCorroboration(items, now);
    return persistMode === "replace"
      ? this.store.save({ dryRun: !networkEnabled, sourceRuns, items: corroborated })
      : this.store.upsert({ dryRun: !networkEnabled, sourceRuns, items: corroborated });
  }

  async load() {
    return this.store.load();
  }

  private async fetchAndParseSource(args: {
    pack: WatcherSourcePack;
    source: { label: string; url: string };
    maxItemsPerSource: number;
    timeoutMs: number;
    now: Date;
  }) {
    const retrievedAt = args.now.toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await this.fetcher(args.source.url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "user-agent": "HydriaSourceAcquisition/1.0"
        }
      });
      const body = await response.text();
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const parsed = response.ok
        ? parseSourceBody({
            body,
            contentType,
            sourceLabel: args.source.label,
            maxItems: args.maxItemsPerSource
          })
        : [];
      const httpAuditIds = await this.planAcquisition({
        ...args,
        retrievedAt,
        fetchMethod: "fetcher_http",
        latencyMs: Date.now() - startedAt,
        responseHeaders: headersToRecord(response.headers),
        hints: {
          httpFailed: !response.ok,
          parseEmpty: response.ok && parsed.length === 0,
          failureReason: response.ok ? (parsed.length === 0 ? "empty_parse" : null) : `http_${response.status}`
        }
      });
      if (!response.ok || parsed.length === 0) {
        const scraplingResult = await this.tryScraplingFetch({
          ...args,
          retrievedAt,
          reason: response.ok ? "empty_parse" : `http_${response.status}`,
          previousAuditIds: httpAuditIds
        });
        if (scraplingResult && (scraplingResult.items.length > 0 || !response.ok)) {
          return scraplingResult;
        }
      }
      const sourceRun: SourceAcquisitionSourceRun = {
        sourceRunId: sourceRunId(args.pack, args.source.url, retrievedAt),
        packId: args.pack.packId,
        sourceLabel: args.source.label,
        sourceUrl: args.source.url,
        fetcher: "node_fetch",
        status: response.ok ? "parsed" : "failed",
        httpStatus: response.status,
        itemCount: parsed.length,
        retrievedAt,
        error: response.ok ? null : `http_${response.status}`,
        executionAuditIds: httpAuditIds
      };

      return {
        sourceRun,
        items: parsed.map((item) => this.toAcquisitionItem(args.pack, args.source, item, retrievedAt))
      };
    } catch (error) {
      const httpAuditIds = await this.planAcquisition({
        ...args,
        retrievedAt,
        fetchMethod: "fetcher_http",
        latencyMs: Date.now() - startedAt,
        responseHeaders: {},
        hints: {
          httpFailed: true,
          parseEmpty: false,
          failureReason: compact(String(error))
        }
      });
      const scraplingResult = await this.tryScraplingFetch({
        ...args,
        retrievedAt,
        reason: compact(String(error)),
        previousAuditIds: httpAuditIds
      });
      if (scraplingResult) {
        return scraplingResult;
      }
      return {
        sourceRun: {
          sourceRunId: sourceRunId(args.pack, args.source.url, retrievedAt),
          packId: args.pack.packId,
          sourceLabel: args.source.label,
          sourceUrl: args.source.url,
          fetcher: "node_fetch" as const,
          status: "failed" as const,
          httpStatus: null,
          itemCount: 0,
          retrievedAt,
          error: compact(String(error)),
          executionAuditIds: httpAuditIds
        },
        items: []
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async tryScraplingFetch(args: {
    pack: WatcherSourcePack;
    source: { label: string; url: string };
    maxItemsPerSource: number;
    timeoutMs: number;
    retrievedAt: string;
    reason: string;
    previousAuditIds?: string[];
  }) {
    if (!this.scraplingClient?.isConfigured()) {
      return null;
    }

    try {
      const startedAt = Date.now();
      const result = await this.scraplingClient.extract({
        url: args.source.url,
        timeoutMs: args.timeoutMs,
        maxChars: env.SCRAPLING_FETCHER_MAX_CHARS
      });
      const parsed = this.parseScraplingResult(result, args.source.label, args.maxItemsPerSource);
      const scraplingAuditIds = await this.planAcquisition({
        ...args,
        fetchMethod: "fetcher_scrapling",
        latencyMs: result.elapsedMs ?? Date.now() - startedAt,
        responseHeaders: result.headers,
        hints: {
          httpFailed: true,
          parseEmpty: parsed.length === 0,
          retryCount: 1,
          failureReason: parsed.length > 0 ? args.reason : `scrapling_empty_after_${args.reason}`
        }
      });
      const sourceRun: SourceAcquisitionSourceRun = {
        sourceRunId: sourceRunId(args.pack, args.source.url, args.retrievedAt),
        packId: args.pack.packId,
        sourceLabel: args.source.label,
        sourceUrl: args.source.url,
        fetcher: "scrapling",
        status: parsed.length > 0 ? "parsed" : "failed",
        httpStatus: result.status,
        itemCount: parsed.length,
        retrievedAt: args.retrievedAt,
        error: parsed.length > 0 ? null : `scrapling_empty_after_${args.reason}`,
        executionAuditIds: [...(args.previousAuditIds ?? []), ...scraplingAuditIds]
      };

      return {
        sourceRun,
        items: parsed.map((item) => this.toAcquisitionItem(args.pack, args.source, item, args.retrievedAt))
      };
    } catch (error) {
      const scraplingAuditIds = await this.planAcquisition({
        ...args,
        fetchMethod: "fetcher_scrapling",
        latencyMs: null,
        responseHeaders: {},
        hints: {
          httpFailed: true,
          parseEmpty: true,
          retryCount: 1,
          failureReason: compact(`scrapling_failed:${String(error)}`)
        }
      });
      return {
        sourceRun: {
          sourceRunId: sourceRunId(args.pack, args.source.url, args.retrievedAt),
          packId: args.pack.packId,
          sourceLabel: args.source.label,
          sourceUrl: args.source.url,
          fetcher: "scrapling" as const,
          status: "failed" as const,
          httpStatus: null,
          itemCount: 0,
          retrievedAt: args.retrievedAt,
          error: compact(`primary_failed:${args.reason}; scrapling_failed:${String(error)}`),
          executionAuditIds: [...(args.previousAuditIds ?? []), ...scraplingAuditIds]
        },
        items: []
      };
    }
  }

  private async planAcquisition(args: {
    pack: WatcherSourcePack;
    source: { label: string; url: string };
    retrievedAt: string;
    fetchMethod: "fetcher_http" | "fetcher_scrapling";
    latencyMs: number | null;
    responseHeaders: Record<string, string>;
    hints: {
      httpFailed: boolean;
      parseEmpty: boolean;
      retryCount?: number;
      failureReason?: string | null;
    };
  }) {
    if (!this.browserAutomationPolicyService) {
      return [];
    }
    const requestId = `source-acquisition::${args.fetchMethod}::${sourceRunId(args.pack, args.source.url, args.retrievedAt)}`;
    const hostname = hostnameFromUrl(args.source.url);
    const plan = await this.browserAutomationPolicyService.plan({
      requestId,
      action: "extract_readonly",
      url: args.source.url,
      sessionId: null,
      allowedDomains: hostname ? [hostname] : [],
      blockedDomains: [],
      requestedPermissions: ["network:read", "content:extract"],
      provenance: {
        requestedBy: "scheduler",
        requestId,
        source: "source-acquisition",
        parentTraceId: null,
        reason: `Plan-only source acquisition governance for ${args.pack.packId}/${args.source.label}.`
      },
      hints: {
        httpFailed: args.fetchMethod === "fetcher_scrapling",
        parseEmpty: args.fetchMethod === "fetcher_scrapling" ? args.hints.parseEmpty : false,
        jsHeavy: false,
        antiBot: false,
        readsSecret: false,
        destructive: false,
        requiresAuth: false,
        retryCount: args.hints.retryCount ?? 0,
        latencyMs: args.latencyMs,
        responseHeaders: args.responseHeaders,
        failureReason: args.hints.failureReason ?? null
      }
    });
    return [plan.auditEvent.auditId];
  }

  private parseScraplingResult(
    result: ScraplingExtractResult,
    sourceLabel: string,
    maxItemsPerSource: number
  ): ParsedItem[] {
    return parseSourceBody({
      body: result.body,
      contentType: result.contentType,
      sourceLabel,
      maxItems: maxItemsPerSource
    }).map((item) => ({
      ...item,
      tags: [...(item.tags ?? []), "scrapling-fetcher", `scrapling-${result.mode}`].slice(0, 16)
    }));
  }

  private toAcquisitionItem(
    pack: WatcherSourcePack,
    source: { label: string; url: string },
    parsed: ParsedItem,
    retrievedAt: string
  ): SourceAcquisitionItem {
    const title = compact(parsed.title || pack.title, 180);
    const corroborationKey = `${pack.packId}::${stableShortHash(normalizeTitle(title).slice(0, 120) || pack.packId)}`;

    return sourceAcquisitionItemSchema.parse({
      itemId: itemId(pack, source.url, title),
      packId: pack.packId,
      sourceLabel: source.label,
      sourceUrl: source.url,
      domain: pack.domain,
      category: pack.category,
      title,
      summary: compact(parsed.summary || pack.summary),
      content: compact(parsed.content || parsed.summary || pack.claim, 1200),
      publishedAt: parsed.publishedAt ?? null,
      retrievedAt,
      freshness: pack.freshness,
      confidence: pack.riskLevel === "high" ? 0.5 : 0.54,
      riskLevel: pack.riskLevel,
      state: "raw",
      corroborationKey,
      corroboratedSourceCount: 1,
      corroboratingSources: [source.label],
      decay: decayFor(pack, retrievedAt),
      tags: [SOURCE_PACK_TAG, pack.packId, ...pack.tags, ...(parsed.tags ?? [])].slice(0, 16)
    });
  }
}

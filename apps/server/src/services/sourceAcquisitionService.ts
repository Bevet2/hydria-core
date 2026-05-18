import { load } from "cheerio";
import { WATCHER_SOURCE_PACKS, type WatcherSourcePack } from "../data/watcherSourcePacks.js";
import {
  sourceAcquisitionItemSchema,
  type SourceAcquisitionFile,
  type SourceAcquisitionItem,
  type SourceAcquisitionSourceRun
} from "../types/sourceAcquisition.js";
import { env } from "../utils/env.js";
import { SourceAcquisitionStore } from "./sourceAcquisitionStore.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type SourceAcquisitionServiceOptions = {
  sourcePacks?: WatcherSourcePack[];
  store?: Pick<SourceAcquisitionStore, "upsert" | "save" | "load">;
  fetcher?: FetchLike;
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

function parseGenericJson(json: unknown, maxItems: number): ParsedItem[] {
  if (!json || typeof json !== "object") {
    return [];
  }
  const root = json as Record<string, unknown>;
  if (Array.isArray(root.vulnerabilities)) {
    return [...parseCisaKev(root, maxItems), ...parseNvd(root, maxItems)].slice(0, maxItems);
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
    const title =
      stringField(record.title) ||
      stringField(record.display_name) ||
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
        publishedAt: parseDate(record.publishedAt ?? record.published ?? record.updated_at ?? record.created_at),
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
  private readonly now: () => Date;

  constructor(options: SourceAcquisitionServiceOptions = {}) {
    this.sourcePacks = options.sourcePacks ?? WATCHER_SOURCE_PACKS;
    this.store = options.store ?? new SourceAcquisitionStore();
    this.fetcher = options.fetcher ?? fetch;
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
            status: "skipped",
            httpStatus: null,
            itemCount: 0,
            retrievedAt: null,
            error: "network_disabled"
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
      const sourceRun: SourceAcquisitionSourceRun = {
        sourceRunId: sourceRunId(args.pack, args.source.url, retrievedAt),
        packId: args.pack.packId,
        sourceLabel: args.source.label,
        sourceUrl: args.source.url,
        status: response.ok ? "parsed" : "failed",
        httpStatus: response.status,
        itemCount: parsed.length,
        retrievedAt,
        error: response.ok ? null : `http_${response.status}`
      };

      return {
        sourceRun,
        items: parsed.map((item) => this.toAcquisitionItem(args.pack, args.source, item, retrievedAt))
      };
    } catch (error) {
      return {
        sourceRun: {
          sourceRunId: sourceRunId(args.pack, args.source.url, retrievedAt),
          packId: args.pack.packId,
          sourceLabel: args.source.label,
          sourceUrl: args.source.url,
          status: "failed" as const,
          httpStatus: null,
          itemCount: 0,
          retrievedAt,
          error: compact(String(error))
        },
        items: []
      };
    } finally {
      clearTimeout(timeout);
    }
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

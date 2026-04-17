import { load } from "cheerio";
import type { ResearchSource } from "../../types/arena.js";
import { logger } from "../../utils/logger.js";
import {
  countRegexMatches,
  DOC_HINT_PATTERNS,
  extractDateCandidates,
  getPathname,
  isHighTrustResearchSource,
  matchesAny,
  normalizeSpace,
  splitSentences,
  toIsoDateTime,
  type SearchCandidate,
  type SearchPlan,
  USER_AGENT
} from "./common.js";
import type {
  ResearchAcquisitionMode,
  ResearchFetchKind,
  ResearchReplayStoreService
} from "./replayStore.js";

type ExtractedDateMetadata = Pick<
  ResearchSource,
  "publishedAt" | "modifiedAt" | "effectiveDate" | "dateSource"
>;
type SourceDateKind = NonNullable<ResearchSource["dateSource"]>;
type ExtractedPage = { excerpt: string } & ExtractedDateMetadata;
type ExtractorPageType =
  | "generic"
  | "release"
  | "leadership"
  | "version"
  | "changelog"
  | "status";

type ExtractorProfile = {
  pageType: ExtractorPageType;
  selectors: string;
  maxChunks: number;
  inclusionPatterns: RegExp[];
  contextualizeStructuredRows: boolean;
};

type FetchDocumentResult = {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
};

type ResearchExtractorOptions = {
  acquisitionMode?: ResearchAcquisitionMode;
  replayStore?: ResearchReplayStoreService | null;
};

export class ResearchExtractor {
  private readonly acquisitionMode: ResearchAcquisitionMode;
  private readonly replayStore: ResearchReplayStoreService | null;

  constructor(options: ResearchExtractorOptions = {}) {
    this.acquisitionMode = options.acquisitionMode ?? "live";
    this.replayStore = options.replayStore ?? null;
  }

  async extractSources(results: SearchCandidate[], plan: SearchPlan) {
    const settled = await Promise.allSettled(
      results.map(async (result) => {
        const extracted = await this.extractPage(result, plan);
        if (!extracted) {
          return null;
        }

        return {
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          excerpt: extracted.excerpt,
          publishedAt: extracted.publishedAt,
          modifiedAt: extracted.modifiedAt,
          effectiveDate: extracted.effectiveDate,
          dateSource: extracted.dateSource,
          retrievalChannel: result.retrievalChannel ?? "live",
          retrievalOrigin: result.retrievalOrigin ?? "generic_search",
          retrievalEngine: result.retrievalEngine ?? "bing_html"
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

  private buildRelevantExcerpt(
    rawText: string,
    plan: SearchPlan,
    pageType: ExtractorPageType,
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
          (total, term) =>
            total + (term.length >= 4 && normalized.includes(term.toLowerCase()) ? 5 : 0),
          0
        );
        score += plan.factFocusTerms.reduce(
          (total, term) =>
            total + (term.length >= 4 && normalized.includes(term.toLowerCase()) ? 4 : 0),
          0
        );
        score += plan.entityTerms.reduce(
          (total, term) =>
            total + (term.length >= 3 && normalized.includes(term.toLowerCase()) ? 6 : 0),
          0
        );

        if (countRegexMatches(sentence, /\b\d+(?:\.\d+)?%?\b/g) > 0) {
          score += 2;
        }
        if (
          (plan.intent === "current_status" || plan.intent === "release_freshness") &&
          /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence)
        ) {
          score += 5;
        }
        if (
          (plan.intent === "current_status" || plan.intent === "release_freshness") &&
          /\b(?:lts|current|release|version|major)\b/i.test(sentence)
        ) {
          score += 4;
        }
        if (
          matchesAny(sentence, [/\bceo\b/i, /\bpresident\b/i, /\bchief\b/i, /\bleadership\b/i]) &&
          pageType === "leadership"
        ) {
          score += 10;
        }
        if (
          matchesAny(sentence, [/\boperational\b/i, /\bincident\b/i, /\boutage\b/i, /\bresolved\b/i]) &&
          pageType === "status"
        ) {
          score += 9;
        }
        if (
          matchesAny(sentence, [/\bchangelog\b/i, /\brelease notes\b/i, /\bfixed\b/i, /\badded\b/i]) &&
          (pageType === "release" || pageType === "changelog")
        ) {
          score += 9;
        }
        if (matchesAny(sentence, DOC_HINT_PATTERNS)) {
          score += 3;
        }
        if (sentence.length >= 60 && sentence.length <= 320) {
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

    const selected =
      scored.length > 0 ? scored.map((entry) => entry.sentence) : sentences.slice(0, 4);
    const excerpt = normalizeSpace([title, ...selected].filter(Boolean).join(" ")).slice(0, 1800);
    if (excerpt.length >= 120) {
      return excerpt;
    }

    const fallback = normalizeSpace(`${title}. ${fallbackSnippet}`.replace(/^\.\s*/, ""));
    return fallback.length >= 80 ? fallback.slice(0, 600) : null;
  }

  private async extractPage(
    result: SearchCandidate,
    plan: SearchPlan
  ): Promise<ExtractedPage | null> {
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

  private async tryExtractDirect(
    result: SearchCandidate,
    plan: SearchPlan
  ): Promise<ExtractedPage | null> {
    const fetched = await this.fetchDocument("direct", result.url, result.url);
    if (!fetched || fetched.status < 200 || fetched.status >= 400) {
      return null;
    }

    const contentType = fetched.contentType.toLowerCase();
    if (contentType.includes("application/pdf")) {
      return null;
    }

    const $ = load(fetched.body);
    const metadata = this.extractDateMetadata({
      $,
      title: result.title,
      snippet: result.snippet
    });

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
    const pageType = this.detectPageType(result, plan);
    const chunks = this.collectChunks($, root, result.title, this.buildProfile(pageType));
    const rawText = normalizeSpace([metaDescription, ...chunks].filter(Boolean).join(". "));
    const excerpt = this.buildRelevantExcerpt(rawText, plan, pageType, result.snippet, result.title);
    if (!excerpt) {
      return null;
    }

    return {
      excerpt,
      ...metadata
    };
  }

  private async tryExtractViaReader(
    result: SearchCandidate,
    plan: SearchPlan
  ): Promise<ExtractedPage | null> {
    const readerUrl = `https://r.jina.ai/http://${result.url.replace(/^https?:\/\//i, "")}`;
    const fetched = await this.fetchDocument("reader", result.url, readerUrl);
    if (!fetched || fetched.status < 200 || fetched.status >= 400) {
      return null;
    }

    const text = normalizeSpace(fetched.body);
    const pageType = this.detectPageType(result, plan);
    const excerpt = this.buildRelevantExcerpt(text, plan, pageType, result.snippet, result.title);
    if (!excerpt) {
      return null;
    }

    return {
      excerpt,
      ...this.extractTextDateMetadata(`${result.title}. ${result.snippet}. ${text}`)
    };
  }

  private tryBuildSnippetFallback(
    result: SearchCandidate,
    plan: SearchPlan
  ): ExtractedPage | null {
    if (!isHighTrustResearchSource(result.url, plan.preferredDomains)) {
      return null;
    }

    const fallback = normalizeSpace(`${result.title}. ${result.snippet}`.replace(/^\.\s*/, ""));
    if (fallback.length < 80) {
      return null;
    }

    const effectiveDate = this.extractBestIsoDate(`${result.title}. ${result.snippet}`);

    return {
      excerpt: fallback.slice(0, 600),
      publishedAt: null,
      modifiedAt: null,
      effectiveDate,
      dateSource: effectiveDate ? "search_result" : null
    };
  }

  private detectPageType(result: SearchCandidate, plan: SearchPlan): ExtractorPageType {
    const haystack = `${result.title} ${result.snippet} ${getPathname(result.url)}`.toLowerCase();

    if (matchesAny(haystack, [/\bstatus\b/i, /\bincident\b/i, /\boutage\b/i, /\/status/i])) {
      return "status";
    }
    if (matchesAny(haystack, [/\bleadership\b/i, /\bceo\b/i, /\bpresident\b/i, /\/team/i, /\/about/i])) {
      return "leadership";
    }
    if (matchesAny(haystack, [/\bchangelog\b/i, /\/changelog/i, /\bwhat's new\b/i])) {
      return "changelog";
    }
    if (matchesAny(haystack, [/\brelease\b/i, /\brelease notes\b/i, /\/releases?\//i])) {
      return "release";
    }
    if (
      plan.intent === "current_status" ||
      matchesAny(haystack, [/\bversion\b/i, /\blts\b/i, /\bcurrent\b/i, /\bstable\b/i])
    ) {
      return "version";
    }

    return "generic";
  }

  private buildProfile(pageType: ExtractorPageType): ExtractorProfile {
    switch (pageType) {
      case "release":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,time,tr,td,th,code,pre",
          maxChunks: 28,
          inclusionPatterns: [/\brelease\b/i, /\bchangelog\b/i, /\bversion\b/i, /\bv?\d+(?:\.\d+){0,2}\b/i],
          contextualizeStructuredRows: true
        };
      case "changelog":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,time,tr,td,th,code",
          maxChunks: 28,
          inclusionPatterns: [/\bchangelog\b/i, /\bupdated?\b/i, /\badded\b/i, /\bfixed\b/i, /\bdeprecated\b/i],
          contextualizeStructuredRows: true
        };
      case "leadership":
        return {
          pageType,
          selectors: "h1,h2,h3,h4,p,li,dt,dd,span,a",
          maxChunks: 20,
          inclusionPatterns: [/\bceo\b/i, /\bpresident\b/i, /\bchief\b/i, /\bleadership\b/i, /\bexecutive\b/i, /\bfounder\b/i],
          contextualizeStructuredRows: false
        };
      case "status":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,span,time,div",
          maxChunks: 22,
          inclusionPatterns: [/\boperational\b/i, /\bincident\b/i, /\boutage\b/i, /\bresolved\b/i, /\bmonitoring\b/i],
          contextualizeStructuredRows: false
        };
      case "version":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,time,tr,td,th,code",
          maxChunks: 28,
          inclusionPatterns: [/\bstable\b/i, /\bversion\b/i, /\bcurrent\b/i, /\blts\b/i, /\bv?\d+(?:\.\d+){0,2}\b/i],
          contextualizeStructuredRows: true
        };
      case "generic":
      default:
        return {
          pageType: "generic",
          selectors: "h1,h2,h3,p,li,time",
          maxChunks: 18,
          inclusionPatterns: [],
          contextualizeStructuredRows: false
        };
    }
  }

  private collectChunks(
    $: ReturnType<typeof load>,
    root: any,
    title: string,
    profile: ExtractorProfile
  ): string[] {
    const chunks: string[] = [];
    const pushChunk = (value: string) => {
      const normalized = normalizeSpace(value);
      if (normalized.length < 30 || chunks.includes(normalized)) {
        return;
      }
      chunks.push(normalized);
    };

    root.find(profile.selectors).each((_index: number, element: any) => {
      const tagName = element.tagName?.toLowerCase() ?? "";
      const text = normalizeSpace($(element).text());
      if (!text) {
        return;
      }

      const contextualText =
        profile.contextualizeStructuredRows &&
        (tagName === "tr" || tagName === "td" || tagName === "th")
          ? normalizeSpace(`${title} ${text}`)
          : text;

      if (
        profile.inclusionPatterns.length > 0 &&
        !profile.inclusionPatterns.some((pattern) => pattern.test(contextualText))
      ) {
        return;
      }

      pushChunk(contextualText);
      if (chunks.length >= profile.maxChunks) {
        return false;
      }
    });

    if (chunks.length > 0 || profile.pageType === "generic") {
      return chunks;
    }

    return this.collectChunks($, root, title, this.buildProfile("generic"));
  }

  private async fetchDocument(
    kind: ResearchFetchKind,
    keyUrl: string,
    targetUrl: string
  ): Promise<FetchDocumentResult | null> {
    if (this.acquisitionMode === "replay") {
      const fixture = await this.replayStore?.getFetch(kind, keyUrl);
      if (fixture) {
        return {
          status: fixture.status,
          contentType: fixture.contentType,
          body: fixture.body,
          finalUrl: fixture.finalUrl
        };
      }
      return null;
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.text();
    const fetched = {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body,
      finalUrl: response.url
    };

    if (this.acquisitionMode === "record") {
      await this.replayStore?.rememberFetch({
        kind,
        url: keyUrl,
        status: fetched.status,
        contentType: fetched.contentType,
        body: fetched.body,
        finalUrl: fetched.finalUrl
      });
    }

    return fetched;
  }

  private extractDateMetadata(args: {
    $: ReturnType<typeof load>;
    title: string;
    snippet: string;
  }): ExtractedDateMetadata {
    const publishedMeta = this.collectSelectorDates(args.$, [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="pubdate"]',
      'meta[name="publish-date"]',
      'meta[name="date"]',
      'meta[itemprop="datePublished"]',
      'meta[property="og:published_time"]'
    ]);
    const modifiedMeta = this.collectSelectorDates(args.$, [
      'meta[property="article:modified_time"]',
      'meta[name="article:modified_time"]',
      'meta[name="last-modified"]',
      'meta[name="lastmod"]',
      'meta[name="modified"]',
      'meta[itemprop="dateModified"]',
      'meta[property="og:updated_time"]'
    ]);
    const timeDates = this.collectTimeDates(args.$);
    const jsonLdDates = this.collectJsonLdDates(args.$);
    const textDates = this.collectTextDates(
      normalizeSpace(`${args.title}. ${args.snippet}. ${args.$("body").text()}`)
    );
    const snippetDates = this.collectTextDates(`${args.title}. ${args.snippet}`);

    const publishedAt = this.selectEarliestIso([
      ...publishedMeta,
      ...jsonLdDates.published,
      ...timeDates
    ]);
    const modifiedAt = this.selectLatestIso([
      ...modifiedMeta,
      ...jsonLdDates.modified
    ]);
    const metaEffective = this.selectLatestIso([...publishedMeta, ...modifiedMeta]);
    const timeEffective = this.selectLatestIso(timeDates);
    const jsonldEffective = this.selectLatestIso([
      ...jsonLdDates.published,
      ...jsonLdDates.modified
    ]);
    const textEffective = this.selectLatestIso(textDates);
    const snippetEffective = this.selectLatestIso(snippetDates);

    const effectiveDate =
      metaEffective ?? timeEffective ?? jsonldEffective ?? textEffective ?? snippetEffective;
    const dateSource: SourceDateKind | null = metaEffective
      ? "meta"
      : timeEffective
        ? "time"
        : jsonldEffective
          ? "jsonld"
          : textEffective
            ? "text"
            : snippetEffective
              ? "search_result"
              : null;

    return {
      publishedAt,
      modifiedAt,
      effectiveDate,
      dateSource
    };
  }

  private extractTextDateMetadata(text: string): ExtractedDateMetadata {
    const effectiveDate = this.extractBestIsoDate(text);
    return {
      publishedAt: null,
      modifiedAt: null,
      effectiveDate,
      dateSource: effectiveDate ? "text" : null
    };
  }

  private collectSelectorDates($: ReturnType<typeof load>, selectors: string[]) {
    const values: string[] = [];

    for (const selector of selectors) {
      $(selector).each((_index, element) => {
        const content = normalizeSpace(
          $(element).attr("content") ?? $(element).attr("datetime") ?? $(element).text() ?? ""
        );
        if (content) {
          values.push(content);
        }
      });
    }

    return values
      .map((value) => this.parseDateValue(value))
      .filter((value): value is string => value !== null);
  }

  private collectTimeDates($: ReturnType<typeof load>) {
    const values: string[] = [];

    $("time").each((_index, element) => {
      const content = normalizeSpace(
        $(element).attr("datetime") ?? $(element).attr("content") ?? $(element).text() ?? ""
      );
      if (content) {
        values.push(content);
      }
    });

    return values
      .map((value) => this.parseDateValue(value))
      .filter((value): value is string => value !== null);
  }

  private collectJsonLdDates($: ReturnType<typeof load>) {
    const published: string[] = [];
    const modified: string[] = [];

    $('script[type="application/ld+json"]').each((_index, element) => {
      const raw = $(element).text();
      if (!raw) {
        return;
      }

      for (const payload of this.parseJsonLd(raw)) {
        this.walkJsonLd(payload, (key, value) => {
          if (typeof value !== "string") {
            return;
          }

          const iso = this.parseDateValue(value);
          if (!iso) {
            return;
          }

          if (/datePublished|dateCreated|uploadDate/i.test(key)) {
            published.push(iso);
          }
          if (/dateModified/i.test(key)) {
            modified.push(iso);
          }
        });
      }
    });

    return { published, modified };
  }

  private collectTextDates(text: string) {
    return extractDateCandidates(text)
      .map((value) => toIsoDateTime(value))
      .filter((value, index, values) => values.indexOf(value) === index);
  }

  private extractBestIsoDate(text: string) {
    return this.selectLatestIso(this.collectTextDates(text));
  }

  private parseJsonLd(raw: string): unknown[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      const normalized = raw
        .replace(/^\uFEFF/, "")
        .replace(/[\u0000-\u001F]+/g, " ")
        .trim();

      try {
        const parsed = JSON.parse(normalized);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
  }

  private walkJsonLd(value: unknown, visit: (key: string, value: unknown) => void) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        this.walkJsonLd(entry, visit);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      visit(key, entry);
      this.walkJsonLd(entry, visit);
    }
  }

  private parseDateValue(value: string) {
    const normalized = normalizeSpace(value);
    if (!normalized || normalized.length < 6) {
      return null;
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return this.isReasonableDate(parsed) ? toIsoDateTime(parsed) : null;
    }

    const fallback = extractDateCandidates(normalized)
      .map((candidate) => toIsoDateTime(candidate))
      .filter((candidate) => {
        const parsedCandidate = new Date(candidate);
        return this.isReasonableDate(parsedCandidate);
      });

    return this.selectLatestIso(fallback);
  }

  private isReasonableDate(value: Date) {
    const year = value.getUTCFullYear();
    return year >= 2000 && year <= 2100;
  }

  private selectLatestIso(values: string[]) {
    const parsed = values
      .map((value) => ({ value, time: new Date(value).getTime() }))
      .filter((entry) => Number.isFinite(entry.time));

    if (parsed.length === 0) {
      return null;
    }

    return parsed.sort((left, right) => right.time - left.time)[0]?.value ?? null;
  }

  private selectEarliestIso(values: string[]) {
    const parsed = values
      .map((value) => ({ value, time: new Date(value).getTime() }))
      .filter((entry) => Number.isFinite(entry.time));

    if (parsed.length === 0) {
      return null;
    }

    return parsed.sort((left, right) => left.time - right.time)[0]?.value ?? null;
  }
}

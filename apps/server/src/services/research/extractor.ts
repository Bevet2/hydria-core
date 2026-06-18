import { load } from "cheerio";
import type { ResearchSource } from "../../types/arena.js";
import { logger } from "../../utils/logger.js";
import {
  normalizeSpace,
  type SearchCandidate,
  type SearchPlan,
  USER_AGENT
} from "./common.js";
import { isHighTrustResearchSource } from "./trust.js";
import type {
  ResearchAcquisitionMode,
  ResearchFetchKind,
  ResearchReplayStoreService
} from "./replayStore.js";
import { ResearchExtractorDateService } from "./extractorDateService.js";
import { ResearchExtractorPageService } from "./extractorPageService.js";
import type { ExtractedPage } from "./extractorShared.js";

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
  private readonly pageService = new ResearchExtractorPageService();
  private readonly dateService = new ResearchExtractorDateService();

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

    return sources.slice(0, 5);
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

    if (contentType.includes("application/json")) {
      const jsonExtract = this.tryExtractJsonDocument(fetched.body);
      if (jsonExtract) {
        return jsonExtract;
      }
    }

    if (this.isFeedLikeDocument(fetched.contentType, fetched.body)) {
      return this.tryExtractFeedDocument(result, fetched.body, plan);
    }

    const $ = load(fetched.body);
    const metadata = this.dateService.extractDateMetadata({
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
    const pageType = this.pageService.detectPageType(result, plan);
    const chunks = this.pageService.collectChunks(
      $,
      root,
      result.title,
      this.pageService.buildProfile(pageType)
    );
    const rawText = normalizeSpace([metaDescription, ...chunks].filter(Boolean).join(". "));
    const excerpt = this.pageService.buildRelevantExcerpt(
      rawText,
      plan,
      pageType,
      result.snippet,
      result.title
    );
    if (!excerpt || this.isRejectedExtraction(excerpt)) {
      return null;
    }

    return {
      excerpt,
      ...metadata
    };
  }

  private tryExtractJsonDocument(body: string): ExtractedPage | null {
    try {
      const payload = JSON.parse(body) as {
        extract?: unknown;
        description?: unknown;
        title?: unknown;
        timestamp?: unknown;
      };
      const excerpt = normalizeSpace(
        [payload.title, payload.description, payload.extract]
          .filter((value) => typeof value === "string" && value.trim().length > 0)
          .join(". ")
      );
      if (!excerpt || this.isRejectedExtraction(excerpt)) {
        return null;
      }
      const timestamp = typeof payload.timestamp === "string" ? payload.timestamp : null;
      return {
        excerpt,
        publishedAt: null,
        modifiedAt: timestamp,
        effectiveDate: timestamp,
        dateSource: timestamp ? "jsonld" : "unknown"
      };
    } catch {
      return null;
    }
  }

  private tryExtractFeedDocument(
    result: SearchCandidate,
    body: string,
    plan: SearchPlan
  ): ExtractedPage | null {
    const feedEntries = this.extractFeedEntries(body);
    if (feedEntries.length === 0) {
      return null;
    }

    const feedTextChunks = feedEntries
      .map((entry) =>
        normalizeSpace(
          [
            entry.title ? `Release ${entry.title}` : "",
            entry.dateText ? `updated ${entry.dateText}` : "",
            entry.summary
          ]
            .filter(Boolean)
            .join(". ")
        )
      )
      .filter(Boolean);
    const firstDate = feedEntries[0]?.dateText ?? null;
    const primaryEntrySummary = feedTextChunks[0] ?? "";

    const rawText = normalizeSpace(feedTextChunks.join(". "));
    if (!rawText) {
      return null;
    }

    const pageType = this.pageService.detectPageType(result, plan);
    const excerpt = this.pageService.buildRelevantExcerpt(
      rawText,
      plan,
      pageType,
      result.snippet,
      result.title
    );
    const releaseFocusedExcerpt =
      plan.intent === "release_freshness" && primaryEntrySummary
        ? normalizeSpace([result.title, primaryEntrySummary].filter(Boolean).join(" ")).slice(0, 1800)
        : "";
    const fallbackExcerpt = normalizeSpace(
      [result.title, primaryEntrySummary, ...feedTextChunks.slice(1, 2)].filter(Boolean).join(" ")
    ).slice(0, 1800);
    const finalExcerpt =
      (releaseFocusedExcerpt.length >= 80 ? releaseFocusedExcerpt : null) ??
      excerpt ??
      (fallbackExcerpt.length >= 80 ? fallbackExcerpt : null);
    if (!finalExcerpt || this.isRejectedExtraction(finalExcerpt)) {
      return null;
    }

    const parsedDate =
      firstDate && !Number.isNaN(new Date(firstDate).getTime())
        ? new Date(firstDate).toISOString()
        : null;

    return {
      excerpt: finalExcerpt,
      publishedAt: parsedDate,
      modifiedAt: parsedDate,
      effectiveDate: parsedDate,
      dateSource: parsedDate ? "text" : null
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
    const pageType = this.pageService.detectPageType(result, plan);
    const excerpt = this.pageService.buildRelevantExcerpt(
      text,
      plan,
      pageType,
      result.snippet,
      result.title
    );
    if (!excerpt || this.isRejectedExtraction(excerpt)) {
      return null;
    }

    return {
      excerpt,
      ...this.dateService.extractTextDateMetadata(`${result.title}. ${result.snippet}. ${text}`)
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
    if (fallback.length < 80 || this.isRejectedExtraction(fallback)) {
      return null;
    }

    const dateMetadata = this.dateService.extractTextDateMetadata(
      `${result.title}. ${result.snippet}`
    );

    return {
      excerpt: fallback.slice(0, 600),
      publishedAt: null,
      modifiedAt: null,
      effectiveDate: dateMetadata.effectiveDate,
      dateSource: dateMetadata.effectiveDate ? "search_result" : null
    };
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

  private isFeedLikeDocument(contentType: string, body: string) {
    const normalizedType = contentType.toLowerCase();
    if (
      normalizedType.includes("application/atom+xml") ||
      normalizedType.includes("application/rss+xml") ||
      normalizedType.includes("application/xml") ||
      normalizedType.includes("text/xml")
    ) {
      return true;
    }

    return /^\s*<(?:\?xml|feed\b|rss\b)/i.test(body);
  }

  private extractFeedEntries(body: string) {
    const $ = load(body, { xml: true });
    const entries = $("entry, item").slice(0, 3);
    if (entries.length > 0) {
      const parsed: Array<{ title: string; summary: string; dateText: string }> = [];
      entries.each((_index, element) => {
        const node = $(element);
        parsed.push({
          title: normalizeSpace(node.find("title").first().text()),
          summary: this.normalizeFeedSummary(
            node.find("summary").first().text() ||
              node.find("description").first().text() ||
              node.find("content").first().text() ||
              node.text()
          ),
          dateText: normalizeSpace(
            node.find("updated").first().text() ||
              node.find("published").first().text() ||
              node.find("pubDate").first().text()
          )
        });
      });
      return parsed.filter((entry) => entry.title || entry.summary);
    }

    const blocks = [...body.matchAll(/<(entry|item)\b[\s\S]*?>([\s\S]*?)<\/\1>/gi)]
      .map((match) => match[2] ?? "")
      .slice(0, 3);

    return blocks
      .map((block) => ({
        title: this.matchFeedTag(block, ["title"]),
        summary: this.normalizeFeedSummary(
          this.matchFeedTag(block, ["summary", "description", "content"])
        ),
        dateText: this.matchFeedTag(block, ["updated", "published", "pubDate"])
      }))
      .filter((entry) => entry.title || entry.summary);
  }

  private matchFeedTag(block: string, tagNames: string[]) {
    for (const tagName of tagNames) {
      const match = block.match(
        new RegExp(`<(?:[a-z0-9_-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tagName}>`, "i")
      );
      if (match?.[1]) {
        return normalizeSpace(match[1].replace(/<[^>]+>/g, " "));
      }
    }

    return "";
  }

  private isRejectedExtraction(text: string) {
    return (
      /target url returned error 404/i.test(text) ||
      /\b404\b.*could not be found/i.test(text) ||
      /just a moment/i.test(text) ||
      /enable javascript and cookies to continue/i.test(text)
    );
  }

  private normalizeFeedSummary(value: string) {
    const normalized = normalizeSpace(value);
    if (!/[<&]/.test(normalized)) {
      return normalized;
    }

    const $ = load(`<div>${normalized}</div>`);
    return normalizeSpace($("div").text());
  }
}

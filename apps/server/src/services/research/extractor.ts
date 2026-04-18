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

    return sources.slice(0, 4);
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
    const pageType = this.pageService.detectPageType(result, plan);
    const excerpt = this.pageService.buildRelevantExcerpt(
      text,
      plan,
      pageType,
      result.snippet,
      result.title
    );
    if (!excerpt) {
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
    if (fallback.length < 80) {
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
}

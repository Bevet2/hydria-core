import { load } from "cheerio";
import type { ResearchSource } from "../../types/arena.js";
import { logger } from "../../utils/logger.js";
import {
  countRegexMatches,
  DOC_HINT_PATTERNS,
  extractDateCandidates,
  isHighTrustResearchSource,
  matchesAny,
  normalizeSpace,
  splitSentences,
  toIsoDateTime,
  type SearchCandidate,
  type SearchPlan,
  USER_AGENT
} from "./common.js";

type ExtractedDateMetadata = Pick<
  ResearchSource,
  "publishedAt" | "modifiedAt" | "effectiveDate" | "dateSource"
>;
type SourceDateKind = NonNullable<ResearchSource["dateSource"]>;
type ExtractedPage = { excerpt: string } & ExtractedDateMetadata;

export class ResearchExtractor {
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

  private buildRelevantExcerpt(rawText: string, plan: SearchPlan, fallbackSnippet = "", title = "") {
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
          plan.intent === "current_status" &&
          /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence)
        ) {
          score += 4;
        }
        if (
          (plan.intent === "current_status" || plan.intent === "release_freshness") &&
          /\b(?:lts|current|release|version)\b/i.test(sentence)
        ) {
          score += 3;
        }
        if (
          (plan.intent === "current_status" || plan.intent === "release_freshness") &&
          /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence) &&
          /\b(?:current|lts|maintenance|eol|release)\b/i.test(sentence)
        ) {
          score += 10;
        }
        if (
          (plan.intent === "current_status" || plan.intent === "release_freshness") &&
          /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence) &&
          /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(sentence)
        ) {
          score += 6;
        }
        if (matchesAny(sentence, DOC_HINT_PATTERNS)) {
          score += 3;
        }
        if (sentence.length >= 80 && sentence.length <= 320) {
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
    const excerpt = normalizeSpace([title, ...selected].filter(Boolean).join(" ")).slice(0, 1600);
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
    const response = await fetch(result.url, {
      headers: {
        "User-Agent": USER_AGENT
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Direct extract returned ${response.status}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/pdf")) {
      return null;
    }

    const html = await response.text();
    const $ = load(html);
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

    const chunks: string[] = [];
    const structureSelector =
      plan.intent === "current_status" || plan.intent === "release_freshness"
        ? "h1,h2,h3,p,li,time,tr,td,th,code"
        : "h1,h2,h3,p,li,time";

    root.find(structureSelector).each((_index, element) => {
      const tagName = element.tagName?.toLowerCase() ?? "";
      const text = normalizeSpace($(element).text());
      const contextualText =
        (tagName === "tr" || tagName === "td" || tagName === "th") && result.title
          ? normalizeSpace(`${result.title} ${text}`)
          : text;
      if (contextualText.length >= 30) {
        chunks.push(contextualText);
      }
      if (chunks.length >= 24) {
        return false;
      }
    });

    const rawText = normalizeSpace([metaDescription, ...chunks].filter(Boolean).join(". "));
    const excerpt = this.buildRelevantExcerpt(rawText, plan, result.snippet, result.title);
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
    const response = await fetch(readerUrl, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Reader extract returned ${response.status}`);
    }

    const text = normalizeSpace(await response.text());
    const excerpt = this.buildRelevantExcerpt(text, plan, result.snippet, result.title);
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

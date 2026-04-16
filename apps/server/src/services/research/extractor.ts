import { load } from "cheerio";
import type { ResearchSource } from "../../types/arena.js";
import { logger } from "../../utils/logger.js";
import {
  COMMUNITY_PATH_PATTERNS,
  countRegexMatches,
  DOC_HINT_PATTERNS,
  getHostname,
  matchesAny,
  normalizeSpace,
  OFFICIAL_DOMAIN_PATTERNS,
  splitSentences,
  type SearchCandidate,
  type SearchPlan,
  USER_AGENT
} from "./common.js";

export class ResearchExtractor {
  async extractSources(results: SearchCandidate[], plan: SearchPlan) {
    const settled = await Promise.allSettled(
      results.map(async (result) => {
        const excerpt = await this.extractPage(result, plan);
        if (!excerpt) {
          return null;
        }

        return {
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          excerpt
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

        if (countRegexMatches(sentence, /\b\d+(?:\.\d+)?%?\b/g) > 0) {
          score += 2;
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

  private async extractPage(result: SearchCandidate, plan: SearchPlan) {
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

  private async tryExtractDirect(result: SearchCandidate, plan: SearchPlan) {
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
    root.find("h1,h2,h3,p,li").each((_index, element) => {
      const text = normalizeSpace($(element).text());
      if (text.length >= 40) {
        chunks.push(text);
      }
      if (chunks.length >= 14) {
        return false;
      }
    });

    const rawText = normalizeSpace([metaDescription, ...chunks].filter(Boolean).join(" "));
    return this.buildRelevantExcerpt(rawText, plan, result.snippet, result.title);
  }

  private async tryExtractViaReader(result: SearchCandidate, plan: SearchPlan) {
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
    return this.buildRelevantExcerpt(text, plan, result.snippet, result.title);
  }

  private tryBuildSnippetFallback(result: SearchCandidate, plan: SearchPlan) {
    const domain = getHostname(result.url);
    if (!this.isHighTrustDomain(domain, plan)) {
      return null;
    }

    const fallback = normalizeSpace(`${result.title}. ${result.snippet}`.replace(/^\.\s*/, ""));
    return fallback.length >= 80 ? fallback.slice(0, 600) : null;
  }

  private isHighTrustDomain(domain: string, plan: SearchPlan) {
    if (!domain) {
      return false;
    }

    return this.getDomainTrustScore(domain, "", plan) >= 26;
  }

  private getDomainTrustScore(domain: string, path: string, plan: SearchPlan) {
    if (!domain) {
      return -20;
    }

    if (plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
      return 55;
    }

    if (OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
      return COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? 20 : 38;
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
}

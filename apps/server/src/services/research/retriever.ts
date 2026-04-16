import { load } from "cheerio";
import { logger } from "../../utils/logger.js";
import {
  COMMUNITY_PATH_PATTERNS,
  DOC_HINT_PATTERNS,
  getHostname,
  getPathname,
  LOW_TRUST_DOMAIN_PATTERNS,
  matchesAny,
  OFFICIAL_DOMAIN_PATTERNS,
  type ScoredCandidate,
  SEARCH_ENGINE_HOST_PATTERNS,
  stripSiteOperators,
  type SearchCandidate,
  type SearchPlan,
  USER_AGENT
} from "./common.js";

export class ResearchRetriever {
  async searchAll(plan: SearchPlan) {
    const resultSets = await Promise.all(
      plan.queries.slice(0, 3).map(async (query) => {
        try {
          return await this.search(query);
        } catch (error) {
          logger.warn("Research search query failed", {
            query,
            intent: plan.intent,
            error: String(error)
          });
          return [];
        }
      })
    );

    const bestByUrl = new Map<string, ScoredCandidate>();
    for (const candidate of resultSets.flat()) {
      const score = this.scoreCandidate(candidate, plan);
      const trustScore = this.getDomainTrustScore(
        getHostname(candidate.url),
        getPathname(candidate.url),
        plan
      );
      const existing = bestByUrl.get(candidate.url);
      if (!existing || score > existing.score) {
        bestByUrl.set(candidate.url, { candidate, score, trustScore });
      }
    }

    const ranked = [...bestByUrl.values()]
      .sort(
        (left, right) =>
          right.trustScore - left.trustScore ||
          right.score - left.score ||
          left.candidate.url.localeCompare(right.candidate.url)
      )
      .filter((entry) => entry.score >= this.minimumCandidateScore(plan))
      .slice(0, 8)
      .map((entry) => entry.candidate);

    if (ranked.length > 0) {
      const trustedRanked = ranked.filter((candidate) =>
        this.isHighTrustDomain(getHostname(candidate.url), plan)
      );
      if (trustedRanked.length > 0) {
        return trustedRanked.slice(0, 5);
      }
    }

    const relaxed = [...bestByUrl.values()]
      .sort(
        (left, right) =>
          right.trustScore - left.trustScore ||
          right.score - left.score ||
          left.candidate.url.localeCompare(right.candidate.url)
      )
      .filter(
        (entry) =>
          !LOW_TRUST_DOMAIN_PATTERNS.some((pattern) =>
            pattern.test(getHostname(entry.candidate.url))
          )
      )
      .filter((entry) => entry.score >= Math.max(6, this.minimumCandidateScore(plan) - 4))
      .filter((entry) => entry.trustScore >= 0)
      .slice(0, 5)
      .map((entry) => entry.candidate);

    if (relaxed.length > 0) {
      return relaxed;
    }

    return [...bestByUrl.values()]
      .sort((left, right) => right.score - left.score)
      .filter((entry) => entry.score >= Math.max(4, this.minimumCandidateScore(plan) - 6))
      .slice(0, 3)
      .map((entry) => entry.candidate);
  }

  isHighTrustDomain(domain: string, plan: SearchPlan) {
    if (!domain) {
      return false;
    }

    return this.getDomainTrustScore(domain, "", plan) >= 26;
  }

  private minimumCandidateScore(plan: SearchPlan) {
    switch (plan.intent) {
      case "definition":
      case "product_docs":
      case "diagnostic_docs":
      case "constraint_check":
        return 14;
      case "incident_guidance":
      case "metric_verification":
        return 12;
      case "fact_check":
      default:
        return 10;
    }
  }

  private scoreCandidate(candidate: SearchCandidate, plan: SearchPlan) {
    const domain = getHostname(candidate.url);
    const path = getPathname(candidate.url);
    const haystack = `${candidate.title} ${candidate.snippet}`.toLowerCase();
    let score = this.getDomainTrustScore(domain, path, plan);

    if (plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
      score += 20;
    }

    score += Math.min(
      24,
      plan.requiredTerms.reduce(
        (total, term) =>
          total + (term.length >= 4 && haystack.includes(term.toLowerCase()) ? 6 : 0),
        0
      )
    );

    if (DOC_HINT_PATTERNS.some((pattern) => pattern.test(candidate.title))) {
      score += 12;
    }

    if (DOC_HINT_PATTERNS.some((pattern) => pattern.test(candidate.snippet))) {
      score += 6;
    }

    if (
      matchesAny(path, [
        /\/docs?\//i,
        /\/documentation/i,
        /\/reference/i,
        /\/guide/i,
        /\/manual/i,
        /\/troubleshoot/i,
        /\/learn\//i
      ])
    ) {
      score += 10;
    }

    if (matchesAny(path, [/\/blog\//i, /\/news\//i, /\/release/i, /\/releases\//i])) {
      score -= plan.intent === "metric_verification" ? 3 : 8;
    }

    score += Math.min(
      12,
      plan.factFocusTerms.reduce(
        (total, term) =>
          total + (term.length >= 4 && haystack.includes(term.toLowerCase()) ? 4 : 0),
        0
      )
    );

    switch (plan.intent) {
      case "definition":
        if (matchesAny(haystack, [/\bwhat is\b/i, /\bexplained\b/i, /\bguide\b/i])) {
          score += 8;
        }
        break;
      case "diagnostic_docs":
        if (matchesAny(haystack, [/\btroubleshoot\b/i, /\berror\b/i, /\bdebug\b/i])) {
          score += 10;
        }
        break;
      case "constraint_check":
        if (
          matchesAny(haystack, [/\bscalab/i, /\blatency\b/i, /\bthroughput\b/i, /\bfailover\b/i])
        ) {
          score += 8;
        }
        break;
      case "incident_guidance":
        if (
          matchesAny(haystack, [/\bincident\b/i, /\bresponse\b/i, /\bbreach\b/i, /\bcredential\b/i])
        ) {
          score += 8;
        }
        break;
      case "metric_verification":
        if (matchesAny(haystack, [/\bmetric\b/i, /\badoption\b/i, /\bbenchmark\b/i, /\broi\b/i])) {
          score += 8;
        }
        break;
      default:
        break;
    }

    return score;
  }

  private getDomainTrustScore(domain: string, path: string, plan: SearchPlan) {
    if (!domain) {
      return -20;
    }

    if (LOW_TRUST_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
      return -35;
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

  private async search(query: string, allowBroaden = true): Promise<SearchCandidate[]> {
    const sanitize = (results: SearchCandidate[]) =>
      results.filter((candidate) => {
        const host = getHostname(candidate.url);
        return (
          candidate.title.length >= 3 &&
          candidate.snippet.length >= 20 &&
          !SEARCH_ENGINE_HOST_PATTERNS.some((pattern) => pattern.test(host))
        );
      });

    const enforceQueryRelevance = (results: SearchCandidate[]) => {
      const quotedPhrases = [...query.matchAll(/"([^"]+)"/g)]
        .map((match) => match[1]?.toLowerCase() ?? "")
        .filter(Boolean);
      const siteHosts = [...query.matchAll(/\bsite:([^\s]+)/gi)]
        .map((match) => match[1]?.toLowerCase() ?? "")
        .filter(Boolean);

      return results.filter((candidate) => {
        const host = getHostname(candidate.url);
        const haystack = `${candidate.title} ${candidate.snippet} ${candidate.url}`.toLowerCase();

        if (siteHosts.length > 0 && !siteHosts.some((siteHost) => host.endsWith(siteHost))) {
          return false;
        }

        if (
          quotedPhrases.length > 0 &&
          !quotedPhrases.some((phrase) => haystack.includes(phrase))
        ) {
          return false;
        }

        return true;
      });
    };

    try {
      const results = enforceQueryRelevance(sanitize(await this.searchDuckDuckGo(query)));
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logger.warn("DuckDuckGo search failed; trying Bing fallback", {
        query,
        error: String(error)
      });
    }

    try {
      const results = enforceQueryRelevance(sanitize(await this.searchDuckDuckGoLite(query)));
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logger.warn("DuckDuckGo Lite search failed; trying Bing fallback", {
        query,
        error: String(error)
      });
    }

    try {
      const results = enforceQueryRelevance(sanitize(await this.searchBing(query)));
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      logger.warn("Bing search failed", {
        query,
        error: String(error)
      });
    }

    if (allowBroaden && /\bsite:/i.test(query)) {
      const broadened = stripSiteOperators(query);
      if (broadened && broadened !== query) {
        return this.search(broadened, false);
      }
    }

    return [];
  }

  private async searchDuckDuckGo(query: string) {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $(".result").each((_index, element) => {
      const anchor = $(element).find(".result__a").first();
      const title = anchor.text().replace(/\s+/g, " ").trim();
      const href = anchor.attr("href") ?? "";
      const snippet = $(element).find(".result__snippet").first().text().replace(/\s+/g, " ").trim();
      const url = this.unwrapDuckDuckGoUrl(href);

      if (!title || !url || !/^https?:\/\//i.test(url) || results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title
      });
    });

    if (results.length === 0) {
      throw new Error("DuckDuckGo search returned no usable results.");
    }

    return results;
  }

  private async searchDuckDuckGoLite(query: string) {
    const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo Lite search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $("a").each((_index, element) => {
      const anchor = $(element);
      const title = anchor.text().replace(/\s+/g, " ").trim();
      const href = anchor.attr("href") ?? "";
      const url = this.unwrapDuckDuckGoUrl(href);

      if (!title || !url || !/^https?:\/\//i.test(url)) {
        return;
      }

      const rowText = anchor.parent().text().replace(/\s+/g, " ").trim();
      const snippet = rowText.length > title.length ? rowText : title;

      if (results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet
      });
    });

    if (results.length === 0) {
      throw new Error("DuckDuckGo Lite search returned no usable results.");
    }

    return results.slice(0, 10);
  }

  private async searchBing(query: string) {
    try {
      const rssResults = await this.searchBingRss(query);
      if (rssResults.length > 0) {
        return rssResults;
      }
    } catch (error) {
      logger.warn("Bing RSS search failed; trying HTML fallback", {
        query,
        error: String(error)
      });
    }

    return this.searchBingHtml(query);
  }

  private async searchBingRss(query: string) {
    const response = await fetch(
      `https://www.bing.com/search?cc=us&setlang=en-US&format=rss&q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      throw new Error(`Bing RSS search returned ${response.status}`);
    }

    const xml = await response.text();
    const $ = load(xml, { xml: true });
    const results: SearchCandidate[] = [];

    $("item").each((_index, element) => {
      const title = $(element).find("title").first().text().replace(/\s+/g, " ").trim();
      const url = $(element).find("link").first().text().replace(/\s+/g, " ").trim();
      const snippet = $(element).find("description").first().text().replace(/\s+/g, " ").trim();

      if (!title || !url || !/^https?:\/\//i.test(url) || results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title
      });
    });

    if (results.length === 0) {
      throw new Error("Bing RSS search returned no usable results.");
    }

    return results.slice(0, 10);
  }

  private async searchBingHtml(query: string) {
    const response = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`Bing search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $(".b_algo").each((_index, element) => {
      const anchor = $(element).find("h2 a").first();
      const title = anchor.text().replace(/\s+/g, " ").trim();
      const url = this.unwrapBingUrl(anchor.attr("href") ?? "");
      const snippet = (
        $(element).find(".b_caption p").first().text() || $(element).find("p").first().text()
      )
        .replace(/\s+/g, " ")
        .trim();

      if (!title || !url || !/^https?:\/\//i.test(url) || results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title
      });
    });

    if (results.length === 0) {
      throw new Error("Bing search returned no usable results.");
    }

    return results;
  }

  private unwrapDuckDuckGoUrl(url: string) {
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      const redirected = parsed.searchParams.get("uddg");
      return redirected ? decodeURIComponent(redirected) : parsed.toString();
    } catch {
      return url;
    }
  }

  private unwrapBingUrl(url: string) {
    try {
      const parsed = new URL(url, "https://www.bing.com");
      const encoded = parsed.searchParams.get("u");
      if (!encoded) {
        return parsed.toString();
      }

      const payload = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded =
        normalized.length % 4 === 2
          ? `${normalized}==`
          : normalized.length % 4 === 3
            ? `${normalized}=`
            : normalized;
      const decoded = Buffer.from(padded, "base64").toString("utf8");

      return /^https?:\/\//i.test(decoded) ? decoded : parsed.toString();
    } catch {
      return url;
    }
  }
}

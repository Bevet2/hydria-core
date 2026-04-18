import { load } from "cheerio";
import { logger } from "../../utils/logger.js";
import {
  getHostname,
  normalizeSpace,
  stripSiteOperators,
  type SearchCandidate,
  type SearchPlan,
  USER_AGENT
} from "./common.js";
import { SEARCH_ENGINE_HOST_PATTERNS } from "./trust.js";
import type {
  ResearchAcquisitionMode,
  ResearchReplayStoreService
} from "./replayStore.js";

type SearchEngineRunner = {
  warning: string;
  run: (query: string) => Promise<SearchCandidate[]>;
};

type ResearchRetrieverSearchServiceOptions = {
  acquisitionMode?: ResearchAcquisitionMode;
  replayStore?: ResearchReplayStoreService | null;
  isHighTrustDomain: (domain: string, plan: SearchPlan) => boolean;
};

export class ResearchRetrieverSearchService {
  private readonly acquisitionMode: ResearchAcquisitionMode;
  private readonly replayStore: ResearchReplayStoreService | null;
  private readonly isHighTrustDomain: (domain: string, plan: SearchPlan) => boolean;

  constructor(options: ResearchRetrieverSearchServiceOptions) {
    this.acquisitionMode = options.acquisitionMode ?? "live";
    this.replayStore = options.replayStore ?? null;
    this.isHighTrustDomain = options.isHighTrustDomain;
  }

  async search(query: string, plan: SearchPlan, allowBroaden = true): Promise<SearchCandidate[]> {
    const sanitize = (results: SearchCandidate[]) =>
      results
        .map((candidate) => this.normalizeCandidate(candidate))
        .filter((candidate) => {
          const host = getHostname(candidate.url);
          return (
            candidate.title.length >= 3 &&
            (candidate.snippet.length >= 8 ||
              this.isHighTrustDomain(host, plan) ||
              candidate.retrievalOrigin === "known_endpoint") &&
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

    if (this.acquisitionMode === "replay") {
      const replayResults = await this.replayStore?.getSearch(query);
      if (replayResults && replayResults.length > 0) {
        return replayResults.map((result) => this.normalizeCandidate(result));
      }
      return [];
    }

    const aggregated: SearchCandidate[] = [];
    for (const variant of this.buildSearchVariants(query, plan, allowBroaden)) {
      const variantResults = enforceQueryRelevance(
        sanitize(await this.searchVariant(variant, plan))
      );
      for (const candidate of variantResults) {
        if (!aggregated.some((entry) => entry.url === candidate.url)) {
          aggregated.push(candidate);
        }
      }

      if (aggregated.length >= 10) {
        break;
      }
    }

    if (aggregated.length > 0) {
      if (this.acquisitionMode === "record") {
        await this.replayStore?.rememberSearch(query, aggregated);
      }
      return aggregated.slice(0, 10);
    }

    return [];
  }

  private async searchVariant(query: string, plan: SearchPlan) {
    const aggregated: SearchCandidate[] = [];

    for (const engine of this.buildSearchEngines(plan)) {
      try {
        const results = await engine.run(query);
        for (const candidate of results) {
          if (!aggregated.some((entry) => entry.url === candidate.url)) {
            aggregated.push(candidate);
          }
        }

        if (aggregated.length >= 10) {
          break;
        }
      } catch (error) {
        logger.warn(engine.warning, {
          query,
          error: String(error)
        });
      }
    }

    return aggregated.slice(0, 10);
  }

  private buildSearchVariants(query: string, plan: SearchPlan, allowBroaden: boolean) {
    const variants = [normalizeSpace(query)];
    const stripped = normalizeSpace(stripSiteOperators(query));
    const primaryDomain = plan.preferredDomains[0]?.toLowerCase() ?? "";

    if (primaryDomain && !/\bsite:/i.test(query)) {
      variants.push(normalizeSpace(`${stripped} site:${primaryDomain}`));
    }

    if (allowBroaden) {
      const broadened = this.broadenQuery(query);
      if (broadened && broadened !== query) {
        variants.push(broadened);
        if (primaryDomain && !/\bsite:/i.test(broadened)) {
          variants.push(normalizeSpace(`${stripSiteOperators(broadened)} site:${primaryDomain}`));
        }
      }
    }

    return [...new Set(variants.filter(Boolean))].slice(0, 4);
  }

  private buildSearchEngines(plan: SearchPlan): SearchEngineRunner[] {
    const temporalFirst =
      plan.intent === "current_status" ||
      plan.intent === "recent_updates" ||
      plan.intent === "release_freshness";

    return temporalFirst
      ? [
          {
            warning: "Bing HTML search failed",
            run: (query: string) => this.searchBingHtml(query)
          },
          {
            warning: "Bing RSS search failed",
            run: (query: string) => this.searchBingRss(query)
          },
          {
            warning: "DuckDuckGo search failed; trying alternative fallback",
            run: (query: string) => this.searchDuckDuckGo(query)
          },
          {
            warning: "DuckDuckGo Lite search failed; trying alternative fallback",
            run: (query: string) => this.searchDuckDuckGoLite(query)
          }
        ]
      : [
          {
            warning: "DuckDuckGo search failed; trying Bing fallback",
            run: (query: string) => this.searchDuckDuckGo(query)
          },
          {
            warning: "DuckDuckGo Lite search failed; trying Bing fallback",
            run: (query: string) => this.searchDuckDuckGoLite(query)
          },
          {
            warning: "Bing HTML search failed",
            run: (query: string) => this.searchBingHtml(query)
          },
          {
            warning: "Bing RSS search failed",
            run: (query: string) => this.searchBingRss(query)
          }
        ];
  }

  private async searchDuckDuckGo(query: string) {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $(".result").each((_index, element) => {
      const anchor = $(element).find(".result__a").first();
      const title = normalizeSpace(anchor.text());
      const href = anchor.attr("href") ?? "";
      const snippet = normalizeSpace($(element).find(".result__snippet").first().text());
      const url = this.unwrapDuckDuckGoUrl(href);

      if (!title || !url || !/^https?:\/\//i.test(url) || results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title,
        retrievalChannel: "live",
        retrievalOrigin: "generic_search",
        retrievalEngine: "duckduckgo"
      });
    });

    if (results.length === 0) {
      throw new Error("DuckDuckGo search returned no usable results.");
    }

    return results.slice(0, 12);
  }

  private async searchDuckDuckGoLite(query: string) {
    const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo Lite search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $("a").each((_index, element) => {
      const anchor = $(element);
      const title = normalizeSpace(anchor.text());
      const href = anchor.attr("href") ?? "";
      const url = this.unwrapDuckDuckGoUrl(href);

      if (!title || !url || !/^https?:\/\//i.test(url)) {
        return;
      }

      const rowText = normalizeSpace(anchor.parent().text());
      const snippet = rowText.length > title.length ? rowText : title;

      if (results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet,
        retrievalChannel: "live",
        retrievalOrigin: "generic_search",
        retrievalEngine: "duckduckgo_lite"
      });
    });

    if (results.length === 0) {
      throw new Error("DuckDuckGo Lite search returned no usable results.");
    }

    return results.slice(0, 12);
  }

  private async searchBingRss(query: string) {
    const response = await fetch(
      `https://www.bing.com/search?cc=us&setlang=en-US&format=rss&q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(12000)
      }
    );

    if (!response.ok) {
      throw new Error(`Bing RSS search returned ${response.status}`);
    }

    const xml = await response.text();
    const $ = load(xml, { xml: true });
    const results: SearchCandidate[] = [];

    $("item").each((_index, element) => {
      const title = normalizeSpace($(element).find("title").first().text());
      const url = this.decodeUrlCandidate(
        normalizeSpace($(element).find("link").first().text())
      );
      const snippet = normalizeSpace($(element).find("description").first().text());

      if (!title || !url || !/^https?:\/\//i.test(url) || results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title,
        retrievalChannel: "live",
        retrievalOrigin: "generic_search",
        retrievalEngine: "bing_rss"
      });
    });

    if (results.length === 0) {
      throw new Error("Bing RSS search returned no usable results.");
    }

    return results.slice(0, 12);
  }

  private async searchBingHtml(query: string) {
    const response = await fetch(
      `https://www.bing.com/search?cc=us&setlang=en-US&count=12&q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(12000)
      }
    );

    if (!response.ok) {
      throw new Error(`Bing search returned ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    const results: SearchCandidate[] = [];

    $("li.b_algo, .b_algo, .b_ans, .b_nwsAns").each((_index, element) => {
      const anchor =
        $(element).find("h2 a").first().length > 0
          ? $(element).find("h2 a").first()
          : $(element).find("a").first();
      const title = normalizeSpace(
        anchor.text() ||
          $(element).find("h2").first().text() ||
          $(element).find(".b_title").first().text()
      );
      const rawHref =
        anchor.attr("href") ??
        $(element).find("cite").first().text() ??
        $(element).find(".b_attribution").first().text() ??
        "";
      const url = this.unwrapBingUrl(rawHref);
      const snippet = normalizeSpace(
        $(element).find(".b_caption p").first().text() ||
          $(element).find(".b_snippet").first().text() ||
          $(element).find(".b_lineclamp2").first().text() ||
          $(element).find(".news_dt").first().text() ||
          $(element).find("p").first().text() ||
          $(element).text()
      );

      if (!title || !url || !/^https?:\/\//i.test(url) || results.some((entry) => entry.url === url)) {
        return;
      }

      results.push({
        title,
        url,
        snippet: snippet || title,
        retrievalChannel: "live",
        retrievalOrigin: "generic_search",
        retrievalEngine: "bing_html"
      });
    });

    if (results.length === 0) {
      throw new Error("Bing search returned no usable results.");
    }

    return results.slice(0, 12);
  }

  private unwrapDuckDuckGoUrl(url: string) {
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      const redirected = parsed.searchParams.get("uddg");
      if (redirected) {
        return this.decodeUrlCandidate(redirected);
      }
      return this.decodeUrlCandidate(parsed.toString());
    } catch {
      return this.decodeUrlCandidate(url);
    }
  }

  private unwrapBingUrl(url: string) {
    const direct = this.extractFirstHttpUrl(url);
    if (direct) {
      return direct;
    }

    try {
      const parsed = new URL(url, "https://www.bing.com");
      if (!/(^|\.)bing\.com$/i.test(parsed.hostname)) {
        return this.decodeUrlCandidate(parsed.toString());
      }

      const directParam =
        this.extractFirstHttpUrl(parsed.searchParams.get("url") ?? "") ??
        this.extractFirstHttpUrl(parsed.searchParams.get("target") ?? "") ??
        this.extractFirstHttpUrl(parsed.searchParams.get("r") ?? "");
      if (directParam) {
        return directParam;
      }

      const encoded = parsed.searchParams.get("u");
      if (encoded) {
        const decoded = this.decodeBingPayload(encoded);
        const extracted = this.extractFirstHttpUrl(decoded);
        if (extracted) {
          return extracted;
        }
      }

      return this.decodeUrlCandidate(parsed.toString());
    } catch {
      return this.decodeUrlCandidate(url);
    }
  }

  private decodeBingPayload(value: string) {
    const normalized = value.startsWith("a1") ? value.slice(2) : value;
    const base64ish = normalized.replace(/-/g, "+").replace(/_/g, "/");
    const padded =
      base64ish.length % 4 === 2
        ? `${base64ish}==`
        : base64ish.length % 4 === 3
          ? `${base64ish}=`
          : base64ish;

    try {
      return Buffer.from(padded, "base64").toString("utf8");
    } catch {
      return value;
    }
  }

  private decodeUrlCandidate(value: string) {
    let decoded = value.trim();

    for (let index = 0; index < 3; index += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) {
          break;
        }
        decoded = next;
      } catch {
        break;
      }
    }

    return decoded;
  }

  private normalizeCandidate(candidate: SearchCandidate): SearchCandidate {
    const normalizedUrl = this.decodeUrlCandidate(candidate.url);
    const fallbackSnippet = normalizeSpace(`${candidate.title} ${getHostname(normalizedUrl)}`);
    return {
      title: normalizeSpace(candidate.title),
      url: normalizedUrl,
      snippet: normalizeSpace(candidate.snippet || fallbackSnippet || candidate.title),
      retrievalChannel: candidate.retrievalChannel,
      retrievalOrigin: candidate.retrievalOrigin,
      retrievalEngine: candidate.retrievalEngine
    };
  }

  private broadenQuery(query: string) {
    const broadened = normalizeSpace(
      stripSiteOperators(query)
        .replace(/"([^"]+)"/g, "$1")
        .replace(
          /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/gi,
          " "
        )
        .replace(/\b20\d{2}\b/g, " ")
    );

    return broadened.length >= 8 ? broadened : query;
  }

  private extractFirstHttpUrl(value: string) {
    let decoded = value;
    for (let index = 0; index < 4; index += 1) {
      const match = decoded.match(/https?:\/\/[^\s"'&<>]+/i);
      if (match?.[0]) {
        return this.decodeUrlCandidate(match[0]);
      }

      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
    }

    return null;
  }
}

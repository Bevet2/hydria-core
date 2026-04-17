import { load } from "cheerio";
import { logger } from "../../utils/logger.js";
import {
  countEntityTermHits,
  COMMUNITY_PATH_PATTERNS,
  DOC_HINT_PATTERNS,
  getHostname,
  getPathname,
  hasExplicitDateSignal,
  LOW_TRUST_DOMAIN_PATTERNS,
  matchesAny,
  normalizeSpace,
  OFFICIAL_DOMAIN_PATTERNS,
  scoreTemporalFreshness,
  SEARCH_ENGINE_HOST_PATTERNS,
  stripSiteOperators,
  type ScoredCandidate,
  type SearchCandidate,
  type SearchPlan,
  USER_AGENT
} from "./common.js";
import type {
  ResearchAcquisitionMode,
  ResearchReplayStoreService
} from "./replayStore.js";

type ResearchRetrieverOptions = {
  acquisitionMode?: ResearchAcquisitionMode;
  replayStore?: ResearchReplayStoreService | null;
};

type SearchEngineRunner = {
  warning: string;
  run: (query: string) => Promise<SearchCandidate[]>;
};

export class ResearchRetriever {
  private readonly acquisitionMode: ResearchAcquisitionMode;
  private readonly replayStore: ResearchReplayStoreService | null;

  constructor(options: ResearchRetrieverOptions = {}) {
    this.acquisitionMode = options.acquisitionMode ?? "live";
    this.replayStore = options.replayStore ?? null;
  }

  async searchAll(plan: SearchPlan, seedCandidates: SearchCandidate[] = []) {
    const resultSets = await Promise.all(
      plan.queries.slice(0, 3).map(async (query) => {
        try {
          return await this.search(query, plan);
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
    for (const candidate of [...seedCandidates, ...resultSets.flat()]) {
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
    if (
      plan.intent === "current_status" ||
      plan.intent === "recent_updates" ||
      plan.intent === "release_freshness"
    ) {
      return plan.temporalProfile.focus === "recent" ||
        plan.temporalProfile.focus === "this_week" ||
        plan.temporalProfile.focus === "this_month" ||
        plan.temporalProfile.focus === "today"
        ? 16
        : 14;
    }

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
    const temporalHaystack = `${candidate.title} ${candidate.snippet} ${candidate.url}`;
    const entityHitStats = countEntityTermHits(
      temporalHaystack,
      plan.entityTerms,
      plan.preferredDomains
    );
    const isDocPath = matchesAny(path, [
      /\/docs?\//i,
      /\/documentation/i,
      /\/reference/i,
      /\/guide/i,
      /\/manual/i,
      /\/troubleshoot/i,
      /\/learn\//i
    ]);
    const isNewsPath = matchesAny(path, [/\/blog\//i, /\/news\//i, /\/press\//i, /\/announcements?\//i]);
    const isReleasePath = matchesAny(path, [/\/release/i, /\/releases\//i, /\/changelog/i, /\/version/i]);
    const isCurrentStatusPath = matchesAny(path, [
      /\/status/i,
      /\/team/i,
      /\/leadership/i,
      /\/executive/i,
      /\/pricing/i,
      /\/availability/i
    ]);
    let score = this.getDomainTrustScore(domain, path, plan);

    if (plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
      score += 20;
    }

    score += Math.min(18, entityHitStats.totalHits * 9);
    score += Math.min(14, entityHitStats.specificHits * 10);

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

    if (isDocPath) {
      if (plan.intent === "release_freshness") {
        score += 4;
      } else if (plan.intent === "current_status") {
        score += 6;
      } else {
        score += 10;
      }
    }

    if (isNewsPath || isReleasePath) {
      if (plan.intent === "recent_updates") {
        score += this.isHighTrustDomain(domain, plan) ? 12 : 5;
      } else if (plan.intent === "release_freshness") {
        score += isReleasePath ? (this.isHighTrustDomain(domain, plan) ? 14 : 6) : 4;
      } else if (plan.intent === "current_status") {
        score += isCurrentStatusPath ? 8 : -2;
      } else {
        score -= plan.intent === "metric_verification" ? 3 : 8;
      }
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
      case "current_status":
        if (matchesAny(haystack, [/\bcurrent\b/i, /\bleadership\b/i, /\bstatus\b/i, /\bversion\b/i])) {
          score += 10;
        }
        break;
      case "recent_updates":
        if (matchesAny(haystack, [/\bupdate\b/i, /\bnews\b/i, /\bannouncement\b/i, /\bthis week\b/i])) {
          score += 10;
        }
        break;
      case "release_freshness":
        if (matchesAny(haystack, [/\brelease\b/i, /\bversion\b/i, /\bchangelog\b/i, /\brelease notes\b/i])) {
          score += 10;
        }
        break;
      default:
        break;
    }

    if (plan.temporalProfile.isTemporal) {
      if (
        (plan.intent === "current_status" || plan.intent === "release_freshness") &&
        plan.entityTerms.length > 0 &&
        entityHitStats.totalHits === 0
      ) {
        return -20;
      }

      if (plan.preferredDomains.length > 0 && entityHitStats.identityHits === 0) {
        return -18;
      }

      if (
        (plan.intent === "current_status" || plan.intent === "release_freshness") &&
        entityHitStats.totalHits > 0 &&
        entityHitStats.specificHits === 0
      ) {
        if (candidate.retrievalOrigin === "known_endpoint") {
          score -= 8;
        } else {
          return -14;
        }
      }

      score += scoreTemporalFreshness(temporalHaystack, plan.temporalProfile);

      if (
        matchesAny(haystack, [
          /\brelease notes?\b/i,
          /\bchangelog\b/i,
          /\bannounc(?:ed|ement)\b/i,
          /\bupdated?\b/i,
          /\bstatus\b/i
        ])
      ) {
        score += 8;
      }

      if (
        (plan.temporalProfile.focus === "recent" ||
          plan.temporalProfile.focus === "this_week" ||
          plan.temporalProfile.focus === "today") &&
        !hasExplicitDateSignal(temporalHaystack)
      ) {
        score -= 6;
      }
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

    if (
      domain === "github.com" &&
      (/\/releases?(?:\/|$)/i.test(path) || /\/tags(?:\/|$)/i.test(path))
    ) {
      return plan.intent === "release_freshness" || plan.intent === "recent_updates" ? 34 : 24;
    }

    if (OFFICIAL_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain))) {
      if (COMMUNITY_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
        return plan.intent === "recent_updates" || plan.intent === "release_freshness" ? 34 : 20;
      }
      return 38;
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

  private async search(
    query: string,
    plan: SearchPlan,
    allowBroaden = true
  ): Promise<SearchCandidate[]> {
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

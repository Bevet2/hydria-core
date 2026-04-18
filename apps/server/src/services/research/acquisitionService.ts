import type { ResearchSource } from "../../types/arena.js";
import { env } from "../../utils/env.js";
import { ResearchKnownEndpointService } from "./knownEndpoints.js";
import {
  ResearchReplayStoreService,
  type ResearchAcquisitionMode
} from "./replayStore.js";
import { ResearchRetriever } from "./retriever.js";
import { ResearchSourceCacheService } from "./sourceCache.js";
import type { SearchCandidate, SearchPlan } from "./common.js";
import { ResearchExtractor } from "./extractor.js";

type KnownEndpointLike = Pick<ResearchKnownEndpointService, "getCandidates">;
type SourceCacheLike = Pick<ResearchSourceCacheService, "getFreshSources" | "rememberSources">;
type RetrieverLike = Pick<ResearchRetriever, "searchAll">;
type ExtractorLike = Pick<ResearchExtractor, "extractSources">;

export type ResearchAcquisitionServiceOptions = {
  acquisitionMode?: ResearchAcquisitionMode;
  fixtureFile?: string | null;
  sourceCacheEnabled?: boolean;
  knownEndpointService?: KnownEndpointLike;
  sourceCacheService?: SourceCacheLike;
  retriever?: RetrieverLike;
  extractor?: ExtractorLike;
};

export type ResearchAcquisitionResult = {
  cachedSources: ResearchSource[];
  seedCandidates: SearchCandidate[];
  searchResults: SearchCandidate[];
  extractedSources: ResearchSource[];
  sources: ResearchSource[];
};

export class ResearchAcquisitionService {
  private readonly sourceCacheEnabled: boolean;
  private readonly knownEndpointService: KnownEndpointLike;
  private readonly sourceCacheService: SourceCacheLike;
  private readonly retriever: RetrieverLike;
  private readonly extractor: ExtractorLike;

  constructor(options: ResearchAcquisitionServiceOptions = {}) {
    const acquisitionMode = options.acquisitionMode ?? "live";
    const fixtureFile = options.fixtureFile ?? env.RESEARCH_EVAL_FIXTURE_FILE;
    this.sourceCacheEnabled = options.sourceCacheEnabled ?? acquisitionMode === "live";

    const replayStore =
      acquisitionMode === "live" && !options.fixtureFile
        ? null
        : new ResearchReplayStoreService(fixtureFile);

    this.knownEndpointService =
      options.knownEndpointService ?? new ResearchKnownEndpointService();
    this.sourceCacheService =
      options.sourceCacheService ?? new ResearchSourceCacheService();
    this.retriever =
      options.retriever ??
      new ResearchRetriever({
        acquisitionMode,
        replayStore
      });
    this.extractor =
      options.extractor ??
      new ResearchExtractor({
        acquisitionMode,
        replayStore
      });
  }

  async collect(plan: SearchPlan): Promise<ResearchAcquisitionResult> {
    const cachedSources = this.sourceCacheEnabled
      ? await this.sourceCacheService.getFreshSources(plan, 3)
      : [];
    const cachedUrls = new Set(cachedSources.map((source) => source.url));
    const seedCandidates = this.knownEndpointService.getCandidates(plan, [...cachedUrls]);
    const searchResults = await this.retriever.searchAll(plan, seedCandidates);
    const extractionCandidates = this.prioritizeExtractionCandidates(
      searchResults,
      cachedUrls,
      plan
    );
    const extractedSources = await this.extractor.extractSources(
      extractionCandidates.slice(0, Math.max(3, 5 - cachedSources.length)),
      plan
    );
    const sources = this.mergeSources([...cachedSources, ...extractedSources]);

    if (this.sourceCacheEnabled) {
      await this.sourceCacheService.rememberSources(plan, extractedSources);
    }

    return {
      cachedSources,
      seedCandidates,
      searchResults,
      extractedSources,
      sources
    };
  }

  private prioritizeExtractionCandidates(
    searchResults: SearchCandidate[],
    cachedUrls: Set<string>,
    plan: SearchPlan
  ) {
    const prioritized = searchResults
      .filter((candidate) => !cachedUrls.has(candidate.url))
      .sort((left, right) => {
        const leftKnown = left.retrievalOrigin === "known_endpoint" ? 1 : 0;
        const rightKnown = right.retrievalOrigin === "known_endpoint" ? 1 : 0;
        if (leftKnown !== rightKnown) {
          return rightKnown - leftKnown;
        }

        const leftPathPriority = this.getPathPriority(left.url, plan);
        const rightPathPriority = this.getPathPriority(right.url, plan);
        if (leftPathPriority !== rightPathPriority) {
          return rightPathPriority - leftPathPriority;
        }

        const leftPreferred = plan.preferredDomains.some((domain) =>
          left.url.toLowerCase().includes(domain.toLowerCase())
        )
          ? 1
          : 0;
        const rightPreferred = plan.preferredDomains.some((domain) =>
          right.url.toLowerCase().includes(domain.toLowerCase())
        )
          ? 1
          : 0;
        if (leftPreferred !== rightPreferred) {
          return rightPreferred - leftPreferred;
        }

        return left.url.localeCompare(right.url);
      });

    const uniqueByCanonicalUrl = new Map<string, SearchCandidate>();
    for (const candidate of prioritized) {
      const key = this.normalizeCandidateUrl(candidate.url);
      if (!uniqueByCanonicalUrl.has(key)) {
        uniqueByCanonicalUrl.set(key, candidate);
      }
    }

    return [...uniqueByCanonicalUrl.values()];
  }

  private mergeSources(sources: ResearchSource[]) {
    const bestByUrl = new Map<string, ResearchSource>();

    for (const source of sources) {
      const existing = bestByUrl.get(source.url);
      if (
        !existing ||
        (source.effectiveDate && !existing.effectiveDate) ||
        source.excerpt.length > existing.excerpt.length
      ) {
        bestByUrl.set(source.url, source);
      }
    }

    return [...bestByUrl.values()].slice(0, 5);
  }

  private getPathPriority(url: string, plan: SearchPlan) {
    const path = safePathname(url);

    if (plan.intent === "current_status") {
      if (/\/our-structure/i.test(path)) return 6;
      if (/\/leadership/i.test(path)) return 5;
      if (/\/team/i.test(path)) return 4;
      if (/\/about/i.test(path)) return 3;
      if (/\/status/i.test(path)) return 2;
      if (/\/pricing/i.test(path)) return 1;
    }

    if (plan.intent === "release_freshness") {
      if (/\/releases?(\.|\/|$)/i.test(path)) return 5;
      if (/\/changelog/i.test(path)) return 4;
      if (/\/release/i.test(path)) return 3;
      if (/\/blog/i.test(path)) return 1;
    }

    return 0;
  }

  private normalizeCandidateUrl(url: string) {
    try {
      const parsed = new URL(url);
      const normalizedPath =
        parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
      return `${parsed.protocol}//${parsed.host}${normalizedPath}${parsed.search}`;
    } catch {
      return url.replace(/\/+$/, "");
    }
  }
}

function safePathname(url: string) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

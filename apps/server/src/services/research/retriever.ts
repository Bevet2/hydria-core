import { logger } from "../../utils/logger.js";
import {
  type SearchCandidate,
  type SearchPlan
} from "./common.js";
import type {
  ResearchAcquisitionMode,
  ResearchReplayStoreService
} from "./replayStore.js";
import { ResearchRetrieverRankingService } from "./retrieverRankingService.js";
import { ResearchRetrieverSearchService } from "./retrieverSearchService.js";

type RankingLike = Pick<ResearchRetrieverRankingService, "rankCandidates" | "isHighTrustDomain">;
type SearchLike = Pick<ResearchRetrieverSearchService, "search">;

type ResearchRetrieverOptions = {
  acquisitionMode?: ResearchAcquisitionMode;
  replayStore?: ResearchReplayStoreService | null;
  rankingService?: RankingLike;
  searchService?: SearchLike;
};

export class ResearchRetriever {
  private readonly rankingService: RankingLike;
  private readonly searchService: SearchLike;

  constructor(options: ResearchRetrieverOptions = {}) {
    const rankingService = options.rankingService ?? new ResearchRetrieverRankingService();
    this.rankingService = rankingService;
    this.searchService =
      options.searchService ??
      new ResearchRetrieverSearchService({
        acquisitionMode: options.acquisitionMode,
        replayStore: options.replayStore,
        isHighTrustDomain: (domain, plan) => rankingService.isHighTrustDomain(domain, plan)
      });
  }

  async searchAll(plan: SearchPlan, seedCandidates: SearchCandidate[] = []) {
    const resultSets = await Promise.all(
      plan.queries.slice(0, 3).map(async (query) => {
        try {
          return await this.searchService.search(query, plan);
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

    return this.rankingService.rankCandidates([...seedCandidates, ...resultSets.flat()], plan);
  }

  isHighTrustDomain(domain: string, plan: SearchPlan) {
    return this.rankingService.isHighTrustDomain(domain, plan);
  }
}

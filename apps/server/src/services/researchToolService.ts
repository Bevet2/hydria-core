import type {
  ResearchToolLog,
  RespondentOutput
} from "../types/arena.js";
import { logger } from "../utils/logger.js";
import {
  type ResearchDecision,
  type ResearchDecisionArgs,
} from "./research/common.js";
import {
  ResearchAcquisitionService,
  type ResearchAcquisitionServiceOptions
} from "./research/acquisitionService.js";
import { ResearchDecisionPolicyService } from "./research/decisionPolicy.js";
import { type ResearchAcquisitionMode } from "./research/replayStore.js";
import { buildDefaultTemporalProfile } from "./research/temporal.js";
import { ResearchVerifier } from "./research/verifier.js";

type ResearchToolServiceOptions = {
  acquisitionMode?: ResearchAcquisitionMode;
  fixtureFile?: string | null;
  sourceCacheEnabled?: boolean;
};

type ResearchImpactArgs = {
  log: ResearchToolLog;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  refineA: { improved_answer: string; fixes_applied: string[] };
  refineB: { improved_answer: string; fixes_applied: string[] };
};

function buildEmptyResearchLog(decision: ResearchDecision): ResearchToolLog {
  return {
    considered: false,
    used: false,
    route: "not_needed",
    decision: {
      shouldUse: false,
      mode: "off",
      expectedValue: decision.expectedValue,
      expectedCostMs: 0,
      triggerSignals: decision.triggerSignals,
      targetClaims: decision.targetClaims,
      reasoning: decision.reasons[0] ?? "Research not needed for this round."
    },
    queryPlan: {
      intent: "fact_check",
      queries: [],
      selectedQuery: null,
      requiredTerms: [],
      preferredDomains: [],
      factFocusTerms: [],
      entityTerms: [],
      temporalProfile: buildDefaultTemporalProfile()
    },
    query: null,
    reasons: decision.reasons,
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: [],
      freshnessSatisfied: true,
      freshnessWindow: "none",
      mostRecentSourceDate: null,
      oldestAcceptedSourceDate: null,
      staleSourcesRejectedCount: 0
    },
    truth: {
      verified_facts: [],
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: 0,
      no_reliable_source: false
    },
    appliedTo: {
      A: false,
      B: false
    },
    impact: {
      refineChangedBecauseOfTool: false,
      addedFactsCount: 0,
      correctedClaimsCount: 0,
      sourceBackedClaimsCount: 0,
      costSharePct: 0,
      netImpact: "unknown"
    },
    impactNotes: [],
    durationMs: 0
  };
}

export class ResearchToolService {
  private readonly decisionPolicyService = new ResearchDecisionPolicyService();
  private readonly acquisitionService: ResearchAcquisitionService;
  private readonly verifier = new ResearchVerifier();

  constructor(options: ResearchToolServiceOptions = {}) {
    const acquisitionOptions: ResearchAcquisitionServiceOptions = {
      acquisitionMode: options.acquisitionMode,
      fixtureFile: options.fixtureFile,
      sourceCacheEnabled: options.sourceCacheEnabled
    };

    this.acquisitionService = new ResearchAcquisitionService(acquisitionOptions);
  }

  async maybeCollect(args: ResearchDecisionArgs): Promise<ResearchToolLog> {
    const decision = await this.decisionPolicyService.decide(args);
    if (!decision.shouldUse || !decision.plan || decision.plan.queries.length === 0) {
      return buildEmptyResearchLog(decision);
    }

    const startedAt = Date.now();
    const plan = decision.plan;

    try {
      const acquisition = await this.acquisitionService.collect(plan);

      return this.verifier.buildLog({
        decision,
        args,
        searchResults: acquisition.searchResults,
        sources: acquisition.sources,
        startedAt
      });
    } catch (error) {
      logger.warn("Research tool failed", {
        question: args.question,
        category: args.category,
        error: String(error)
      });

      return this.verifier.buildFailureLog({
        decision,
        startedAt,
        error
      });
    }
  }

  finalizeImpact(args: ResearchImpactArgs): ResearchToolLog {
    return this.verifier.finalizeImpact(args);
  }

  finalizeRoundAccounting(log: ResearchToolLog, totalRoundMs: number): ResearchToolLog {
    return this.verifier.finalizeRoundAccounting(log, totalRoundMs);
  }
}

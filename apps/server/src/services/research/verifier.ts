import type {
  ResearchSource,
  ResearchToolLog
} from "../../types/arena.js";
import {
  extractTerms,
  normalizeSpace,
  sanitizeResearchDecisionReasoning,
  splitSentences,
  type ResearchDecision,
  type ResearchDecisionArgs,
  type SearchCandidate
} from "./common.js";
import {
  buildDefaultTemporalProfile,
  resolveFreshnessWindow
} from "./temporal.js";
import {
  ResearchVerifierFreshnessService
} from "./verifierFreshnessService.js";
import {
  ResearchVerifierImpactService,
  type ResearchVerifierFinalizeImpactArgs
} from "./verifierImpactService.js";
import { ResearchVerifierTruthService } from "./verifierTruthService.js";

type BuildLogArgs = {
  decision: ResearchDecision;
  args: ResearchDecisionArgs;
  searchResults: SearchCandidate[];
  sources: ResearchSource[];
  startedAt: number;
};

type BuildFailureArgs = {
  decision: ResearchDecision;
  startedAt: number;
  error: unknown;
};

export class ResearchVerifier {
  private readonly freshnessService = new ResearchVerifierFreshnessService();
  private readonly truthService = new ResearchVerifierTruthService();
  private readonly impactService = new ResearchVerifierImpactService();

  buildLog({ decision, args, searchResults, sources, startedAt }: BuildLogArgs): ResearchToolLog {
    const acceptedSources = this.freshnessService.buildAcceptedEntries(decision, sources);
    const freshnessAudit = this.freshnessService.auditFreshness(decision, acceptedSources);
    const acceptedOnly = freshnessAudit.acceptedEntries.map((entry) => entry.source);
    const sourceTexts = acceptedOnly.map((source) => `${source.snippet} ${source.excerpt}`).join(" ");
    const corroboratedSignals = extractTerms(sourceTexts)
      .filter(
        (term) =>
          acceptedOnly.filter((source) => source.excerpt.toLowerCase().includes(term)).length >= 2
      )
      .slice(0, 6);
    const summary = acceptedOnly
      .map((source) => {
        const firstSentence = splitSentences(source.excerpt)[0] ?? source.snippet;
        const datePrefix = source.effectiveDate
          ? `${source.effectiveDate.slice(0, 10)}: `
          : "";
        return `${source.title}: ${datePrefix}${firstSentence}`;
      })
      .map((entry) => normalizeSpace(entry))
      .slice(0, 4);
    const truth = this.truthService.buildTruth({
      decision,
      args,
      entries: freshnessAudit.acceptedEntries,
      corroboratedSignals
    });
    const isTemporal = decision.plan?.temporalProfile.isTemporal ?? false;
    const used =
      acceptedOnly.length > 0 &&
      (!isTemporal || freshnessAudit.freshnessSatisfied) &&
      !truth.no_reliable_source &&
      (truth.verified_facts.length > 0 ||
        truth.uncertain_claims.length > 0 ||
        truth.conflicting_info.length > 0);

    return {
      considered: true,
      used,
      route: used ? "used" : "failed",
      decision: {
        shouldUse: true,
        mode: decision.plan?.mode ?? "off",
        expectedValue: decision.expectedValue,
        expectedCostMs: decision.expectedCostMs,
        triggerSignals: decision.triggerSignals,
        targetClaims: decision.targetClaims,
        reasoning: sanitizeResearchDecisionReasoning(
          decision.plan?.reasoning ?? decision.reasons[0] ?? "Research triggered."
        )
      },
      queryPlan: {
        intent: decision.plan?.intent ?? "fact_check",
        queries: decision.plan?.queries ?? [],
        selectedQuery: decision.plan?.queries[0] ?? null,
        requiredTerms: decision.plan?.requiredTerms ?? [],
        preferredDomains: decision.plan?.preferredDomains ?? [],
        factFocusTerms: decision.plan?.factFocusTerms ?? [],
        entityTerms: decision.plan?.entityTerms ?? [],
        temporalProfile: decision.plan?.temporalProfile ?? buildDefaultTemporalProfile()
      },
      query: decision.plan?.queries[0] ?? decision.plan?.queries.join(" || ") ?? null,
      reasons: decision.reasons,
      summary,
      sources: acceptedOnly,
      verification: {
        sourceCount: searchResults.length,
        extractedSourceCount: sources.length,
        corroboratedSignals,
        freshnessSatisfied: freshnessAudit.freshnessSatisfied,
        freshnessWindow: freshnessAudit.freshnessWindow,
        mostRecentSourceDate: freshnessAudit.mostRecentSourceDate,
        oldestAcceptedSourceDate: freshnessAudit.oldestAcceptedSourceDate,
        staleSourcesRejectedCount: freshnessAudit.staleSourcesRejectedCount
      },
      truth,
      appliedTo: {
        A: args.shouldRefineA && used,
        B: args.shouldRefineB && used
      },
      impact: {
        refineChangedBecauseOfTool: false,
        addedFactsCount: 0,
        correctedClaimsCount: 0,
        sourceBackedClaimsCount: this.impactService.countBackedClaims(
          decision.targetClaims,
          sourceTexts,
          sourceTexts
        ),
        costSharePct: 0,
        netImpact: used ? "neutral" : "negative"
      },
      impactNotes: this.impactService.buildImpactNotes({
        decision,
        used,
        truth,
        freshnessAudit
      }),
      durationMs: Date.now() - startedAt
    };
  }

  buildFailureLog({ decision, startedAt, error }: BuildFailureArgs): ResearchToolLog {
    const temporalProfile = decision.plan?.temporalProfile ?? buildDefaultTemporalProfile();

    return {
      considered: true,
      used: false,
      route: "failed",
      decision: {
        shouldUse: true,
        mode: decision.plan?.mode ?? "off",
        expectedValue: decision.expectedValue,
        expectedCostMs: decision.expectedCostMs,
        triggerSignals: decision.triggerSignals,
        targetClaims: decision.targetClaims,
        reasoning: sanitizeResearchDecisionReasoning(
          decision.plan?.reasoning ?? decision.reasons[0] ?? "Research failed."
        )
      },
      queryPlan: {
        intent: decision.plan?.intent ?? "fact_check",
        queries: decision.plan?.queries ?? [],
        selectedQuery: decision.plan?.queries[0] ?? null,
        requiredTerms: decision.plan?.requiredTerms ?? [],
        preferredDomains: decision.plan?.preferredDomains ?? [],
        factFocusTerms: decision.plan?.factFocusTerms ?? [],
        entityTerms: decision.plan?.entityTerms ?? [],
        temporalProfile
      },
      query: decision.plan?.queries[0] ?? decision.plan?.queries.join(" || ") ?? null,
      reasons: decision.reasons,
      summary: [],
      sources: [],
      verification: {
        sourceCount: 0,
        extractedSourceCount: 0,
        corroboratedSignals: [],
        freshnessSatisfied: !temporalProfile.isTemporal,
        freshnessWindow: resolveFreshnessWindow(temporalProfile),
        mostRecentSourceDate: null,
        oldestAcceptedSourceDate: null,
        staleSourcesRejectedCount: 0
      },
      truth: {
        verified_facts: [],
        uncertain_claims: decision.targetClaims.slice(0, 4),
        conflicting_info: [],
        confidence_score: 0,
        no_reliable_source: true
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
        netImpact: "negative"
      },
      impactNotes: [
        `Research failed before refinement: ${String(error)}`,
        ...this.impactService.buildTemporalImpactNotes(decision)
      ],
      durationMs: Date.now() - startedAt
    };
  }

  finalizeImpact(args: ResearchVerifierFinalizeImpactArgs): ResearchToolLog {
    return this.impactService.finalizeImpact(args);
  }

  finalizeRoundAccounting(log: ResearchToolLog, totalRoundMs: number): ResearchToolLog {
    return this.impactService.finalizeRoundAccounting(log, totalRoundMs);
  }
}

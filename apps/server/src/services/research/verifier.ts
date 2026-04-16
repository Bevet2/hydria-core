import type {
  ResearchNetImpact,
  ResearchSource,
  ResearchToolLog,
  RespondentOutput
} from "../../types/arena.js";
import {
  extractTerms,
  normalizeSpace,
  splitSentences,
  type ResearchDecision,
  type ResearchDecisionArgs,
  type SearchCandidate
} from "./common.js";

type BuildLogArgs = {
  decision: ResearchDecision;
  args: ResearchDecisionArgs;
  searchResults: SearchCandidate[];
  sources: ResearchSource[];
  startedAt: number;
};

type BuildFailureArgs = {
  decision: ResearchDecision;
  args: ResearchDecisionArgs;
  startedAt: number;
  error: unknown;
};

type FinalizeImpactArgs = {
  log: ResearchToolLog;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  refineA: { improved_answer: string; fixes_applied: string[] };
  refineB: { improved_answer: string; fixes_applied: string[] };
};

export class ResearchVerifier {
  buildLog({ decision, args, searchResults, sources, startedAt }: BuildLogArgs): ResearchToolLog {
    const sourceTexts = sources.map((source) => `${source.snippet} ${source.excerpt}`).join(" ");
    const corroboratedSignals = extractTerms(sourceTexts)
      .filter(
        (term) =>
          sources.filter((source) => source.excerpt.toLowerCase().includes(term)).length >= 2
      )
      .slice(0, 6);

    const summary = sources
      .map((source) => `${source.title}: ${splitSentences(source.excerpt)[0] ?? source.snippet}`)
      .map((entry) => normalizeSpace(entry))
      .slice(0, 4);

    return {
      considered: true,
      used: sources.length > 0,
      route: sources.length > 0 ? "used" : "failed",
      decision: {
        shouldUse: true,
        mode: decision.plan?.mode ?? "off",
        expectedValue: decision.expectedValue,
        expectedCostMs: decision.expectedCostMs,
        triggerSignals: decision.triggerSignals,
        targetClaims: decision.targetClaims,
        reasoning: decision.plan?.reasoning ?? decision.reasons[0] ?? "Research triggered."
      },
      queryPlan: {
        intent: decision.plan?.intent ?? "fact_check",
        queries: decision.plan?.queries ?? [],
        selectedQuery: decision.plan?.queries[0] ?? null,
        requiredTerms: decision.plan?.requiredTerms ?? [],
        preferredDomains: decision.plan?.preferredDomains ?? [],
        factFocusTerms: decision.plan?.factFocusTerms ?? []
      },
      query: decision.plan?.queries[0] ?? decision.plan?.queries.join(" || ") ?? null,
      reasons: decision.reasons,
      summary,
      sources,
      verification: {
        sourceCount: searchResults.length,
        extractedSourceCount: sources.length,
        corroboratedSignals
      },
      appliedTo: {
        A: args.shouldRefineA && sources.length > 0,
        B: args.shouldRefineB && sources.length > 0
      },
      impact: {
        refineChangedBecauseOfTool: false,
        addedFactsCount: 0,
        correctedClaimsCount: 0,
        sourceBackedClaimsCount: this.countBackedClaims(
          decision.targetClaims,
          sourceTexts,
          sourceTexts
        ),
        costSharePct: 0,
        netImpact: sources.length > 0 ? "neutral" : "negative"
      },
      impactNotes:
        sources.length > 0
          ? [`Research injected ${sources.length} extracted sources into the refine step.`]
          : ["Research was triggered, but no extractable sources were recovered."],
      durationMs: Date.now() - startedAt
    };
  }

  buildFailureLog({ decision, startedAt, error }: BuildFailureArgs): ResearchToolLog {
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
        reasoning: decision.plan?.reasoning ?? decision.reasons[0] ?? "Research failed."
      },
      queryPlan: {
        intent: decision.plan?.intent ?? "fact_check",
        queries: decision.plan?.queries ?? [],
        selectedQuery: decision.plan?.queries[0] ?? null,
        requiredTerms: decision.plan?.requiredTerms ?? [],
        preferredDomains: decision.plan?.preferredDomains ?? [],
        factFocusTerms: decision.plan?.factFocusTerms ?? []
      },
      query: decision.plan?.queries[0] ?? decision.plan?.queries.join(" || ") ?? null,
      reasons: decision.reasons,
      summary: [],
      sources: [],
      verification: {
        sourceCount: 0,
        extractedSourceCount: 0,
        corroboratedSignals: []
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
      impactNotes: [`Research failed before refinement: ${String(error)}`],
      durationMs: Date.now() - startedAt
    };
  }

  finalizeImpact(args: FinalizeImpactArgs): ResearchToolLog {
    if (!args.log.used) {
      return args.log;
    }

    const sourceText = [...args.log.summary, ...args.log.sources.map((source) => source.excerpt)].join(
      " "
    );
    const sourceTerms = extractTerms(sourceText).slice(0, 20);
    const beforeText = `${args.respondentA.answer} ${args.respondentB.answer}`;
    const afterText = `${args.refineA.improved_answer} ${args.refineB.improved_answer}`;
    const addedFactsCount = sourceTerms.filter(
      (term) => afterText.toLowerCase().includes(term) && !beforeText.toLowerCase().includes(term)
    ).length;
    const correctedClaimsCount = this.countBackedClaims(
      args.log.decision.targetClaims,
      sourceText,
      afterText,
      beforeText
    );
    const sourceBackedClaimsCount = this.countBackedClaims(
      args.log.decision.targetClaims,
      sourceText,
      afterText
    );
    const refineChangedBecauseOfTool =
      addedFactsCount > 0 ||
      correctedClaimsCount > 0 ||
      (sourceBackedClaimsCount > 0 &&
        args.refineA.fixes_applied.length + args.refineB.fixes_applied.length > 0);
    const netImpact: ResearchNetImpact = refineChangedBecauseOfTool ? "positive" : "neutral";

    const impactNotes = [...args.log.impactNotes];
    impactNotes.push(
      ...this.buildSlotImpactNotes(
        "A",
        sourceTerms,
        args.respondentA.answer,
        args.refineA.improved_answer,
        args.refineA.fixes_applied
      )
    );
    impactNotes.push(
      ...this.buildSlotImpactNotes(
        "B",
        sourceTerms,
        args.respondentB.answer,
        args.refineB.improved_answer,
        args.refineB.fixes_applied
      )
    );

    return {
      ...args.log,
      impact: {
        ...args.log.impact,
        refineChangedBecauseOfTool,
        addedFactsCount: Math.min(20, addedFactsCount),
        correctedClaimsCount: Math.min(12, correctedClaimsCount),
        sourceBackedClaimsCount: Math.min(12, sourceBackedClaimsCount),
        netImpact
      },
      impactNotes: impactNotes.slice(0, 12)
    };
  }

  finalizeRoundAccounting(log: ResearchToolLog, totalRoundMs: number): ResearchToolLog {
    const costSharePct =
      totalRoundMs > 0 ? Math.round((log.durationMs / totalRoundMs) * 100) : 0;

    return {
      ...log,
      impact: {
        ...log.impact,
        costSharePct: Math.max(0, Math.min(100, costSharePct))
      }
    };
  }

  private buildSlotImpactNotes(
    slot: "A" | "B",
    sourceTerms: string[],
    before: string,
    after: string,
    fixesApplied: string[]
  ) {
    const beforeText = before.toLowerCase();
    const afterText = after.toLowerCase();
    const newTerms = sourceTerms
      .filter((term) => afterText.includes(term) && !beforeText.includes(term))
      .slice(0, 4);

    if (newTerms.length > 0) {
      return [`Refine ${slot} incorporated externally sourced signals: ${newTerms.join(", ")}.`];
    }

    if (fixesApplied.length > 0) {
      return [
        `Refine ${slot} had research context available and produced ${fixesApplied.length} concrete fixes.`
      ];
    }

    return [`Refine ${slot} had research context available but showed limited visible source uptake.`];
  }

  private countBackedClaims(
    targetClaims: string[],
    sourceText: string,
    afterText: string,
    beforeText = ""
  ) {
    const normalizedSource = sourceText.toLowerCase();
    const normalizedAfter = afterText.toLowerCase();
    const normalizedBefore = beforeText.toLowerCase();

    return targetClaims.filter((claim) => {
      const claimTerms = extractTerms(claim).slice(0, 4);
      if (claimTerms.length === 0) {
        return false;
      }

      const sourceBacked = claimTerms.some((term) => normalizedSource.includes(term));
      if (!sourceBacked) {
        return false;
      }

      const presentAfter = claimTerms.some((term) => normalizedAfter.includes(term));
      const absentBefore =
        beforeText.length === 0 || claimTerms.some((term) => !normalizedBefore.includes(term));

      return presentAfter && absentBefore;
    }).length;
  }
}

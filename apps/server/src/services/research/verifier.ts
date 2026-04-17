import type {
  ResearchNetImpact,
  ResearchSource,
  ResearchTruth,
  ResearchToolLog,
  RespondentOutput
} from "../../types/arena.js";
import {
  extractTerms,
  getSourceTrustScore,
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
    const truth = this.buildTruth({ decision, args, sources, corroboratedSignals });
    const used =
      sources.length > 0 &&
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
      truth,
      appliedTo: {
        A: args.shouldRefineA && used,
        B: args.shouldRefineB && used
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
        netImpact: used ? "neutral" : "negative"
      },
      impactNotes: used
        ? [
            `Truth engine produced ${truth.verified_facts.length} verified fact(s), ${truth.uncertain_claims.length} uncertain claim(s), and ${truth.conflicting_info.length} conflict marker(s).`
          ]
        : truth.no_reliable_source
          ? ["Research ran, but no reliable source could verify the target claim set."]
          : ["Research was triggered, but no usable truth payload was recovered."],
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
      impactNotes: [`Research failed before refinement: ${String(error)}`],
      durationMs: Date.now() - startedAt
    };
  }

  finalizeImpact(args: FinalizeImpactArgs): ResearchToolLog {
    if (!args.log.decision.shouldUse) {
      return args.log;
    }

    const sourceText = [
      ...args.log.truth.verified_facts,
      ...args.log.truth.uncertain_claims,
      ...args.log.summary,
      ...args.log.sources.map((source) => source.excerpt)
    ].join(" ");
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
      netImpact: args.log.truth.no_reliable_source && !refineChangedBecauseOfTool ? "neutral" : netImpact
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

  private buildTruth(args: {
    decision: ResearchDecision;
    args: ResearchDecisionArgs;
    sources: ResearchSource[];
    corroboratedSignals: string[];
  }): ResearchTruth {
    const preferredDomains = args.decision.plan?.preferredDomains ?? [];
    const genericTerms = new Set([
      "official",
      "documentation",
      "reference",
      "company",
      "general-purpose",
      "artificial",
      "intelligence",
      "released",
      "announced",
      "general",
      "purpose",
      "update",
      "updates",
      "latest",
      "major",
      "model",
      "models",
      "guidance",
      "policy",
      "weeks",
      "week"
    ]);
    const requiredTerms = [
      ...(args.decision.plan?.requiredTerms ?? []),
      ...(args.decision.plan?.factFocusTerms ?? []),
      ...extractTerms(args.decision.targetClaims.join(" ")).slice(0, 6)
    ];
    const claimAnchorTerms = this.uniqueNormalized(
      extractTerms(args.decision.targetClaims.join(" ")).filter(
        (term) => !genericTerms.has(term.toLowerCase())
      )
    ).slice(0, 8);
    const fallbackFocusTerms = this.uniqueNormalized(
      extractTerms(
        `${args.args.question} ${args.args.respondentA.answer} ${args.args.respondentB.answer}`
      ).filter((term) => !genericTerms.has(term.toLowerCase()))
    ).slice(0, 8);
    const focusTerms = claimAnchorTerms.length > 0 ? claimAnchorTerms : fallbackFocusTerms;
    const reliableSources = args.sources
      .map((source) => ({
        source,
        trustScore: getSourceTrustScore(source.url, preferredDomains)
      }))
      .filter((entry) => entry.trustScore >= 26);

    const candidateFacts = reliableSources
      .flatMap((entry) =>
        splitSentences(entry.source.excerpt).map((sentence, index) => ({
          sentence: normalizeSpace(sentence),
          score: this.scoreFactSentence(
            sentence,
            requiredTerms,
            focusTerms,
            entry.trustScore,
            index
          ),
          trustScore: entry.trustScore
        }))
      )
      .filter((entry) => entry.score >= 6)
      .sort((left, right) => right.score - left.score || right.trustScore - left.trustScore)
      .map((entry) => entry.sentence);

    const verifiedFacts = this.uniqueNormalized(candidateFacts).slice(0, 6);
    const sourceText = reliableSources
      .map((entry) => `${entry.source.title} ${entry.source.snippet} ${entry.source.excerpt}`)
      .join(" ")
      .toLowerCase();
    const uncertainClaims = this.uniqueNormalized(
      args.decision.targetClaims
        .filter((claim) => !this.claimSupported(claim, sourceText, verifiedFacts))
        .slice(0, 5)
    );
    const conflictingInfo = this.detectConflicts(args.decision.targetClaims, verifiedFacts);
    const noReliableSource = reliableSources.length === 0 || verifiedFacts.length === 0;
    const confidenceScore = noReliableSource
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            0.3 +
              Math.min(reliableSources.length, 3) * 0.15 +
              Math.min(args.corroboratedSignals.length, 3) * 0.08 +
              Math.min(verifiedFacts.length, 3) * 0.08 -
              Math.min(uncertainClaims.length, 3) * 0.08 -
              Math.min(conflictingInfo.length, 2) * 0.12
          )
        );

    return {
      verified_facts: verifiedFacts,
      uncertain_claims: noReliableSource
        ? uncertainClaims.length > 0
          ? uncertainClaims
          : ["The requested claim could not be verified from reliable sources."]
        : uncertainClaims,
      conflicting_info: conflictingInfo,
      confidence_score: Math.round(confidenceScore * 100) / 100,
      no_reliable_source: noReliableSource
    };
  }

  private scoreFactSentence(
    sentence: string,
    requiredTerms: string[],
    focusTerms: string[],
    trustScore: number,
    index: number
  ) {
    const normalized = sentence.toLowerCase();
    let score = Math.min(5, Math.round(trustScore / 10));

    score += requiredTerms.reduce(
      (total, term) => total + (term.length >= 4 && normalized.includes(term.toLowerCase()) ? 3 : 0),
      0
    );
    const focusHits = focusTerms.filter(
      (term) => term.length >= 4 && normalized.includes(term.toLowerCase())
    ).length;
    if (focusTerms.length > 0 && focusHits === 0) {
      return -10;
    }
    score += focusHits * 4;
    score += /\b\d{4}\b/.test(sentence) ? 2 : 0;
    score += /\b\d+(?:\.\d+)?%?\b/.test(sentence) ? 1 : 0;
    score += /\b(is|are|means|refers to|announced|released|updated|requires?)\b/i.test(sentence)
      ? 2
      : 0;
    score -= /\b(may|might|could|appears|seems)\b/i.test(sentence) ? 2 : 0;
    score -= index > 3 ? 1 : 0;

    return score;
  }

  private claimSupported(claim: string, sourceText: string, verifiedFacts: string[]) {
    const terms = extractTerms(claim).slice(0, 4);
    if (terms.length === 0) {
      return false;
    }

    const factText = verifiedFacts.join(" ").toLowerCase();
    return terms.some(
      (term) => sourceText.includes(term.toLowerCase()) || factText.includes(term.toLowerCase())
    );
  }

  private detectConflicts(targetClaims: string[], verifiedFacts: string[]) {
    const yearMatches = [...new Set(verifiedFacts.flatMap((fact) => fact.match(/\b20\d{2}\b/g) ?? []))];
    if (yearMatches.length >= 2 && targetClaims.length > 0) {
      return [`Reliable sources expose conflicting timing/details for: ${targetClaims[0]}`];
    }

    return [];
  }

  private uniqueNormalized(values: string[]) {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const value of values.map((entry) => normalizeSpace(entry)).filter(Boolean)) {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(value);
    }

    return deduped;
  }
}

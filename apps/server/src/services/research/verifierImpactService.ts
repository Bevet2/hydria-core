import type {
  ResearchNetImpact,
  ResearchToolLog,
  ResearchTruth,
  RespondentOutput
} from "../../types/arena.js";
import { extractTerms, type ResearchDecision } from "./common.js";
import { buildDefaultTemporalProfile, describeTemporalWindow } from "./temporal.js";
import type { FreshnessAudit } from "./verifierShared.js";

export type ResearchVerifierFinalizeImpactArgs = {
  log: ResearchToolLog;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  refineA: { improved_answer: string; fixes_applied: string[] };
  refineB: { improved_answer: string; fixes_applied: string[] };
};

type BuildImpactNotesArgs = {
  decision: ResearchDecision;
  used: boolean;
  truth: ResearchTruth;
  freshnessAudit: FreshnessAudit;
};

export class ResearchVerifierImpactService {
  buildImpactNotes(args: BuildImpactNotesArgs) {
    if (args.used) {
      return [
        `Truth engine produced ${args.truth.verified_facts.length} verified fact(s), ${args.truth.uncertain_claims.length} uncertain claim(s), and ${args.truth.conflicting_info.length} conflict marker(s).`,
        ...this.buildFreshnessImpactNotes(args.freshnessAudit),
        ...this.buildTemporalImpactNotes(args.decision)
      ].slice(0, 8);
    }

    if (args.freshnessAudit.failureNote) {
      return [
        args.freshnessAudit.failureNote,
        ...this.buildFreshnessImpactNotes(args.freshnessAudit),
        ...this.buildTemporalImpactNotes(args.decision)
      ].slice(0, 8);
    }

    if (args.truth.no_reliable_source) {
      return [
        "Research ran, but no reliable source could verify the target claim set.",
        ...this.buildTemporalImpactNotes(args.decision)
      ];
    }

    return ["Research was triggered, but no usable truth payload was recovered."];
  }

  buildTemporalImpactNotes(decision: ResearchDecision) {
    const profile = decision.plan?.temporalProfile ?? buildDefaultTemporalProfile();
    if (!profile.isTemporal) {
      return [];
    }

    return [
      `Temporal verification mode: ${profile.queryType.replaceAll("_", " ")} anchored to ${describeTemporalWindow(profile) ?? profile.absoluteDateHint ?? "the requested date"}.`
    ];
  }

  countBackedClaims(
    targetClaims: string[],
    sourceText: string,
    afterText: string,
    beforeText = ""
  ) {
    return this.computeBackedClaims(targetClaims, sourceText, afterText, beforeText);
  }

  finalizeImpact(args: ResearchVerifierFinalizeImpactArgs): ResearchToolLog {
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
    const correctedClaimsCount = this.computeBackedClaims(
      args.log.decision.targetClaims,
      sourceText,
      afterText,
      beforeText
    );
    const sourceBackedClaimsCount = this.computeBackedClaims(
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
      toolRouting: {
        ...args.log.toolRouting,
        toolResultUsed:
          args.log.used &&
          (refineChangedBecauseOfTool ||
            args.log.toolRouting.toolType === "calculator" ||
            args.log.toolRouting.toolType === "time")
      },
      skillUsed: args.log.skillRouting.skillFound,
      skillConfidence: args.log.skillRouting.skillFound ? args.log.skillRouting.confidence : null,
      skillOutcome: args.log.skillRouting.skillFound
        ? refineChangedBecauseOfTool
          ? "recommended"
          : "fallback"
        : "not_found",
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

  private buildFreshnessImpactNotes(freshnessAudit: FreshnessAudit) {
    if (freshnessAudit.freshnessWindow === "none") {
      return [];
    }

    const notes = [
      `Freshness audit: ${freshnessAudit.freshnessWindow}, accepted ${freshnessAudit.acceptedEntries.length} source(s), rejected ${freshnessAudit.staleSourcesRejectedCount} as stale or undated.`
    ];

    if (freshnessAudit.mostRecentSourceDate) {
      notes.push(`Most recent accepted source date: ${freshnessAudit.mostRecentSourceDate.slice(0, 10)}.`);
    }

    return notes;
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

  private computeBackedClaims(
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

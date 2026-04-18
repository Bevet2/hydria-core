import type {
  ResearchTemporalProfile,
  ResearchTruth
} from "../../types/arena.js";
import {
  extractFocusTerms,
  extractTerms,
  normalizeSpace,
  splitSentences,
  type ResearchDecision,
  type ResearchDecisionArgs
} from "./common.js";
import {
  buildDefaultTemporalProfile,
  describeTemporalWindow,
  hasExplicitDateSignal,
  scoreTemporalFreshness
} from "./temporal.js";
import {
  claimSupported,
  textIncludesTerm,
  textSupportsClaim,
  uniqueNormalized,
  normalizeMatchingText,
  type SourceEntry
} from "./verifierShared.js";

type BuildTruthArgs = {
  decision: ResearchDecision;
  args: ResearchDecisionArgs;
  entries: SourceEntry[];
  corroboratedSignals: string[];
};

export class ResearchVerifierTruthService {
  buildTruth(args: BuildTruthArgs): ResearchTruth {
    const temporalProfile = args.decision.plan?.temporalProfile ?? buildDefaultTemporalProfile();
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
      "week",
      "recent",
      "current",
      "today"
    ]);
    const requiredTerms = [
      ...(args.decision.plan?.requiredTerms ?? []),
      ...(args.decision.plan?.factFocusTerms ?? []),
      ...(args.decision.plan?.entityTerms ?? []),
      ...extractTerms(args.decision.targetClaims.join(" ")).slice(0, 6)
    ];
    const claimAnchorTerms = uniqueNormalized(
      [
        ...extractTerms(args.decision.targetClaims.join(" ")),
        ...extractFocusTerms(args.decision.targetClaims.join(" "))
      ].filter((term) => !genericTerms.has(term.toLowerCase()))
    ).slice(0, 8);
    const fallbackFocusTerms = uniqueNormalized(
      [
        ...extractTerms(
          `${args.args.question} ${args.args.respondentA.answer} ${args.args.respondentB.answer}`
        ),
        ...extractFocusTerms(args.args.question)
      ].filter((term) => !genericTerms.has(term.toLowerCase()))
    ).slice(0, 8);
    const focusTerms = claimAnchorTerms.length > 0 ? claimAnchorTerms : fallbackFocusTerms;

    let candidateFacts = args.entries
      .flatMap((entry) =>
        splitSentences(entry.source.excerpt).map((sentence, index) => ({
          sentence: normalizeSpace(sentence),
          score: this.scoreFactSentence(
            sentence,
            requiredTerms,
            focusTerms,
            entry.trustScore,
            index,
            temporalProfile,
            entry.source.effectiveDate
          ),
          trustScore: entry.trustScore,
          effectiveDate: entry.source.effectiveDate
        }))
      )
      .filter((entry) => entry.score >= 6)
      .sort((left, right) => right.score - left.score || right.trustScore - left.trustScore);

    if (temporalProfile.isTemporal) {
      candidateFacts = candidateFacts.filter(
        (entry) =>
          entry.effectiveDate !== null ||
          hasExplicitDateSignal(entry.sentence) ||
          scoreTemporalFreshness(entry.sentence, temporalProfile) >= 4
      );
    }

    const verifiedFacts = uniqueNormalized(candidateFacts.map((entry) => entry.sentence))
      .filter(
        (fact) =>
          args.decision.targetClaims.length === 0 ||
          args.decision.targetClaims.some((claim) =>
            textSupportsClaim(claim, fact, temporalProfile)
          )
      )
      .slice(0, 6);
    const sourceText = args.entries
      .map((entry) => `${entry.source.title} ${entry.source.snippet} ${entry.source.excerpt}`)
      .join(" ")
      .toLowerCase();
    const supportedClaimCount = args.decision.targetClaims.filter((claim) =>
      claimSupported(claim, sourceText, verifiedFacts, temporalProfile)
    ).length;
    const uncertainClaims = uniqueNormalized(
      args.decision.targetClaims
        .filter((claim) => !claimSupported(claim, sourceText, verifiedFacts, temporalProfile))
        .slice(0, 5)
    );
    const conflictingInfo = this.detectConflicts(
      args.decision.targetClaims,
      verifiedFacts,
      temporalProfile
    );
    const noReliableSource =
      args.entries.length === 0 ||
      verifiedFacts.length === 0 ||
      (args.decision.targetClaims.length > 0 && supportedClaimCount === 0) ||
      (temporalProfile.isTemporal && args.entries.every((entry) => entry.source.effectiveDate === null));
    const confidenceScore = noReliableSource
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            0.3 +
              Math.min(args.entries.length, 3) * 0.15 +
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
          : [this.buildNoReliableSourceNote(temporalProfile)]
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
    index: number,
    temporalProfile: ResearchTemporalProfile,
    sourceEffectiveDate: string | null = null
  ) {
    const normalized = normalizeMatchingText(sentence);
    const hasStructuredVersionRow =
      /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence) &&
      /\b(?:current|lts|maintenance|release)\b/i.test(sentence);
    let score = Math.min(5, Math.round(trustScore / 10));

    score += requiredTerms.reduce(
      (total, term) => total + (term.length >= 4 && textIncludesTerm(normalized, term) ? 3 : 0),
      0
    );
    const focusHits = focusTerms.filter(
      (term) => term.length >= 4 && textIncludesTerm(normalized, term)
    ).length;
    if (focusTerms.length > 0 && focusHits === 0) {
      return -10;
    }
    if (
      (temporalProfile.queryType === "current_status" ||
        temporalProfile.queryType === "release_freshness") &&
      focusTerms.length >= 2 &&
      focusHits < 2 &&
      !hasStructuredVersionRow
    ) {
      return -10;
    }
    score += focusHits * 4;
    score += /\b\d{4}\b/.test(sentence) ? 2 : 0;
    score += /\b\d+(?:\.\d+)?%?\b/.test(sentence) ? 1 : 0;
    if (
      (temporalProfile.queryType === "current_status" ||
        temporalProfile.queryType === "release_freshness") &&
      /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence) &&
      /\b(?:current|lts|maintenance|release)\b/i.test(sentence)
    ) {
      score += 12;
    }
    if (
      (temporalProfile.queryType === "current_status" ||
        temporalProfile.queryType === "release_freshness") &&
      /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence) &&
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(sentence)
    ) {
      score += 6;
    }
    score += /\b(is|are|means|refers to|announced|released|updated|requires?)\b/i.test(sentence)
      ? 2
      : 0;
    score -= /\b(may|might|could|appears|seems)\b/i.test(sentence) ? 2 : 0;
    score -= index > 3 ? 1 : 0;
    score += scoreTemporalFreshness(
      sourceEffectiveDate ? `${sentence} ${sourceEffectiveDate}` : sentence,
      temporalProfile
    );

    if (temporalProfile.isTemporal && !hasExplicitDateSignal(sentence) && sourceEffectiveDate === null) {
      score -= 4;
    }

    return score;
  }

  private detectConflicts(
    targetClaims: string[],
    verifiedFacts: string[],
    temporalProfile: ResearchTemporalProfile
  ) {
    const yearMatches = [...new Set(verifiedFacts.flatMap((fact) => fact.match(/\b20\d{2}\b/g) ?? []))];
    if (yearMatches.length >= 2 && targetClaims.length > 0) {
      return [
        temporalProfile.isTemporal
          ? `Reliable sources disagree on the timing or freshness for: ${targetClaims[0]}`
          : `Reliable sources expose conflicting timing/details for: ${targetClaims[0]}`
      ];
    }

    return [];
  }

  private buildNoReliableSourceNote(temporalProfile: ResearchTemporalProfile) {
    if (temporalProfile.isTemporal) {
      return `Research attempted, but no sufficiently recent source was found for ${describeTemporalWindow(temporalProfile) ?? temporalProfile.absoluteDateHint ?? "the requested timeframe"}.`;
    }

    return "The requested claim could not be verified from reliable sources.";
  }
}

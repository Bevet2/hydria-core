import type {
  ResearchFreshnessWindow,
  ResearchNetImpact,
  ResearchSource,
  ResearchTruth,
  ResearchToolLog,
  RespondentOutput
} from "../../types/arena.js";
import {
  buildDefaultTemporalProfile,
  describeTemporalWindow,
  extractTerms,
  getPathname,
  getSourceTrustScore,
  hasExplicitDateSignal,
  normalizeSpace,
  resolveFreshnessWindow,
  scoreTemporalFreshness,
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

type SourceEntry = {
  source: ResearchSource;
  trustScore: number;
  effectiveDate: Date | null;
};

type FreshnessAudit = {
  acceptedEntries: SourceEntry[];
  freshnessSatisfied: boolean;
  freshnessWindow: ResearchFreshnessWindow;
  mostRecentSourceDate: string | null;
  oldestAcceptedSourceDate: string | null;
  staleSourcesRejectedCount: number;
  failureNote: string | null;
};

export class ResearchVerifier {
  buildLog({ decision, args, searchResults, sources, startedAt }: BuildLogArgs): ResearchToolLog {
    const acceptedSources = this.buildAcceptedEntries(decision, sources);
    const freshnessAudit = this.auditFreshness(decision, acceptedSources);
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
    const truth = this.buildTruth({
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
        reasoning: decision.plan?.reasoning ?? decision.reasons[0] ?? "Research triggered."
      },
      queryPlan: {
        intent: decision.plan?.intent ?? "fact_check",
        queries: decision.plan?.queries ?? [],
        selectedQuery: decision.plan?.queries[0] ?? null,
        requiredTerms: decision.plan?.requiredTerms ?? [],
        preferredDomains: decision.plan?.preferredDomains ?? [],
        factFocusTerms: decision.plan?.factFocusTerms ?? [],
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
        sourceBackedClaimsCount: this.countBackedClaims(
          decision.targetClaims,
          sourceTexts,
          sourceTexts
        ),
        costSharePct: 0,
        netImpact: used ? "neutral" : "negative"
      },
      impactNotes: this.buildImpactNotes({
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
        reasoning: decision.plan?.reasoning ?? decision.reasons[0] ?? "Research failed."
      },
      queryPlan: {
        intent: decision.plan?.intent ?? "fact_check",
        queries: decision.plan?.queries ?? [],
        selectedQuery: decision.plan?.queries[0] ?? null,
        requiredTerms: decision.plan?.requiredTerms ?? [],
        preferredDomains: decision.plan?.preferredDomains ?? [],
        factFocusTerms: decision.plan?.factFocusTerms ?? [],
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
        ...this.buildTemporalImpactNotes(decision)
      ],
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

  private buildAcceptedEntries(decision: ResearchDecision, sources: ResearchSource[]) {
    const preferredDomains = decision.plan?.preferredDomains ?? [];

    return sources
      .map((source) => ({
        source,
        trustScore: getSourceTrustScore(source.url, preferredDomains),
        effectiveDate: this.parseDate(source.effectiveDate ?? source.modifiedAt ?? source.publishedAt)
      }))
      .filter((entry) => entry.trustScore >= 26);
  }

  private auditFreshness(decision: ResearchDecision, entries: SourceEntry[]): FreshnessAudit {
    const temporalProfile = decision.plan?.temporalProfile ?? buildDefaultTemporalProfile();
    const freshnessWindow = resolveFreshnessWindow(temporalProfile);

    if (!temporalProfile.isTemporal) {
      const acceptedDates = entries
        .map((entry) => entry.effectiveDate?.toISOString() ?? null)
        .filter((value): value is string => value !== null)
        .sort();

      return {
        acceptedEntries: entries,
        freshnessSatisfied: true,
        freshnessWindow,
        mostRecentSourceDate: acceptedDates.at(-1) ?? null,
        oldestAcceptedSourceDate: acceptedDates[0] ?? null,
        staleSourcesRejectedCount: 0,
        failureNote: null
      };
    }

    const acceptedEntries = entries.filter((entry) =>
      this.isEntryFresh(entry, temporalProfile, decision.plan?.intent ?? "fact_check")
    );
    const acceptedDates = acceptedEntries
      .map((entry) => entry.effectiveDate?.toISOString() ?? null)
      .filter((value): value is string => value !== null)
      .sort();
    const freshnessSatisfied = acceptedEntries.length > 0;

    return {
      acceptedEntries,
      freshnessSatisfied,
      freshnessWindow,
      mostRecentSourceDate: acceptedDates.at(-1) ?? null,
      oldestAcceptedSourceDate: acceptedDates[0] ?? null,
      staleSourcesRejectedCount: Math.max(0, entries.length - acceptedEntries.length),
      failureNote: freshnessSatisfied
        ? null
        : this.buildFreshnessFailureNote(temporalProfile, entries)
    };
  }

  private isEntryFresh(
    entry: SourceEntry,
    temporalProfile: ReturnType<typeof buildDefaultTemporalProfile>,
    intent: ResearchDecision["plan"] extends infer _ ? NonNullable<ResearchDecision["plan"]>["intent"] : never
  ) {
    const date = entry.effectiveDate;
    if (!date) {
      return false;
    }

    const sourceText = `${entry.source.title} ${entry.source.snippet} ${entry.source.excerpt} ${entry.source.url}`;
    const path = getPathname(entry.source.url);

    if (intent === "release_freshness") {
      const releaseLike =
        /\brelease\b|\bversion\b|\bchangelog\b|\brelease notes?\b|\bgeneral availability\b|\bga\b/i.test(
          sourceText
        ) || /\/releases?\//i.test(path) || /\/changelog/i.test(path);
      if (!releaseLike) {
        return false;
      }
    }

    if (intent === "current_status") {
      const currentLike =
        /\bcurrent\b|\bas of\b|\bstatus\b|\bleadership\b|\bteam\b|\bpricing\b|\bavailability\b|\bversion\b/i.test(
          sourceText
        ) ||
        /\/status/i.test(path) ||
        /\/team/i.test(path) ||
        /\/leadership/i.test(path) ||
        /\/pricing/i.test(path) ||
        /\/availability/i.test(path);
      if (!currentLike) {
        return false;
      }
    }

    return this.dateWithinWindow(date, temporalProfile);
  }

  private dateWithinWindow(
    date: Date,
    temporalProfile: ReturnType<typeof buildDefaultTemporalProfile>
  ) {
    if (temporalProfile.dateRangeStart && temporalProfile.dateRangeEnd) {
      const start = new Date(`${temporalProfile.dateRangeStart}T00:00:00.000Z`);
      const end = new Date(`${temporalProfile.dateRangeEnd}T23:59:59.999Z`);
      return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
    }

    if (temporalProfile.recencyDays === null) {
      return true;
    }

    const ageMs = Date.now() - date.getTime();
    const ageDays = ageMs / 86_400_000;
    return ageDays >= 0 && ageDays <= temporalProfile.recencyDays;
  }

  private buildFreshnessFailureNote(
    temporalProfile: ReturnType<typeof buildDefaultTemporalProfile>,
    entries: SourceEntry[]
  ) {
    const window = describeTemporalWindow(temporalProfile) ?? temporalProfile.absoluteDateHint ?? "the requested timeframe";
    const datedEntries = entries.filter((entry) => entry.effectiveDate !== null);

    if (datedEntries.length === 0) {
      return `Research attempted, but no sufficiently recent source with an explicit date was found for ${window}.`;
    }

    return `Research attempted, but no sufficiently recent source was found inside ${window}.`;
  }

  private buildImpactNotes(args: {
    decision: ResearchDecision;
    used: boolean;
    truth: ResearchTruth;
    freshnessAudit: FreshnessAudit;
  }) {
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
    entries: SourceEntry[];
    corroboratedSignals: string[];
  }): ResearchTruth {
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

    const verifiedFacts = this.uniqueNormalized(candidateFacts.map((entry) => entry.sentence)).slice(0, 6);
    const sourceText = args.entries
      .map((entry) => `${entry.source.title} ${entry.source.snippet} ${entry.source.excerpt}`)
      .join(" ")
      .toLowerCase();
    const uncertainClaims = this.uniqueNormalized(
      args.decision.targetClaims
        .filter((claim) => !this.claimSupported(claim, sourceText, verifiedFacts))
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
    temporalProfile = buildDefaultTemporalProfile(),
    sourceEffectiveDate: string | null = null
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
    score += scoreTemporalFreshness(
      sourceEffectiveDate ? `${sentence} ${sourceEffectiveDate}` : sentence,
      temporalProfile
    );

    if (
      temporalProfile.isTemporal &&
      !hasExplicitDateSignal(sentence) &&
      sourceEffectiveDate === null
    ) {
      score -= 4;
    }

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

  private detectConflicts(
    targetClaims: string[],
    verifiedFacts: string[],
    temporalProfile = buildDefaultTemporalProfile()
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

  private buildNoReliableSourceNote(
    temporalProfile: ReturnType<typeof buildDefaultTemporalProfile>
  ) {
    if (temporalProfile.isTemporal) {
      return `Research attempted, but no sufficiently recent source was found for ${describeTemporalWindow(temporalProfile) ?? temporalProfile.absoluteDateHint ?? "the requested timeframe"}.`;
    }

    return "The requested claim could not be verified from reliable sources.";
  }

  private buildTemporalImpactNotes(decision: ResearchDecision) {
    const profile = decision.plan?.temporalProfile ?? buildDefaultTemporalProfile();
    if (!profile.isTemporal) {
      return [];
    }

    return [
      `Temporal verification mode: ${profile.queryType.replaceAll("_", " ")} anchored to ${describeTemporalWindow(profile) ?? profile.absoluteDateHint ?? "the requested date"}.`
    ];
  }

  private parseDate(value: string | null) {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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

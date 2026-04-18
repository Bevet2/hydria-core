import type {
  ResearchIntent,
  ResearchSource,
  ResearchTemporalProfile
} from "../../types/arena.js";
import {
  countEntityTermHits,
  getPathname,
  type ResearchDecision
} from "./common.js";
import {
  buildDefaultTemporalProfile,
  describeTemporalWindow,
  resolveFreshnessWindow
} from "./temporal.js";
import { getSourceTrustScore } from "./trust.js";
import {
  type FreshnessAudit,
  parseSourceDate,
  type SourceEntry
} from "./verifierShared.js";

export class ResearchVerifierFreshnessService {
  buildAcceptedEntries(decision: ResearchDecision, sources: ResearchSource[]): SourceEntry[] {
    const preferredDomains = decision.plan?.preferredDomains ?? [];
    const entityTerms = decision.plan?.entityTerms ?? [];
    const intent = decision.plan?.intent ?? "fact_check";

    return sources
      .map((source) => ({
        source,
        trustScore: getSourceTrustScore(source.url, preferredDomains),
        effectiveDate: parseSourceDate(source.effectiveDate ?? source.modifiedAt ?? source.publishedAt)
      }))
      .filter((entry) => entry.trustScore >= 26)
      .filter((entry) =>
        this.sourceMatchesEntityTerms(entry.source, entityTerms, intent, preferredDomains)
      );
  }

  auditFreshness(decision: ResearchDecision, entries: SourceEntry[]): FreshnessAudit {
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
    temporalProfile: ResearchTemporalProfile,
    intent: ResearchIntent
  ) {
    const date = entry.effectiveDate;
    const sourceText = `${entry.source.title} ${entry.source.snippet} ${entry.source.excerpt} ${entry.source.url}`;
    const path = getPathname(entry.source.url);
    const canonicalCurrentStatusPath = matchesCurrentStatusPath(path);
    const persistentCurrentStatusPath = matchesPersistentCurrentStatusPath(path);

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
        canonicalCurrentStatusPath;
      const undatedCanonicalCurrentStatusSource =
        entry.trustScore >= 55 &&
        (canonicalCurrentStatusPath || entry.source.retrievalOrigin === "known_endpoint");
      const persistentCurrentStatusSource =
        entry.trustScore >= 55 && persistentCurrentStatusPath;
      if (!currentLike) {
        return false;
      }

      if (!date) {
        return undatedCanonicalCurrentStatusSource;
      }

      if (persistentCurrentStatusSource) {
        return true;
      }
    }

    if (!date) {
      return false;
    }

    return this.dateWithinWindow(date, temporalProfile);
  }

  private dateWithinWindow(date: Date, temporalProfile: ResearchTemporalProfile) {
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
    temporalProfile: ResearchTemporalProfile,
    entries: SourceEntry[]
  ) {
    const window =
      describeTemporalWindow(temporalProfile) ??
      temporalProfile.absoluteDateHint ??
      "the requested timeframe";
    const datedEntries = entries.filter((entry) => entry.effectiveDate !== null);

    if (datedEntries.length === 0) {
      return `Research attempted, but no sufficiently recent source with an explicit date was found for ${window}.`;
    }

    return `Research attempted, but no sufficiently recent source was found inside ${window}.`;
  }

  private sourceMatchesEntityTerms(
    source: ResearchSource,
    entityTerms: string[],
    intent: ResearchIntent,
    preferredDomains: string[]
  ) {
    if (entityTerms.length === 0) {
      return true;
    }

    if (intent !== "current_status" && intent !== "release_freshness") {
      return true;
    }

    const text = `${source.title} ${source.snippet} ${source.excerpt} ${source.url}`.toLowerCase();
    const hitStats = countEntityTermHits(text, entityTerms, preferredDomains);
    const allowKnownEndpointIdentityOnly =
      source.retrievalOrigin === "known_endpoint" &&
      (intent === "current_status" || intent === "release_freshness") &&
      hitStats.identityHits > 0;
    if (hitStats.totalHits === 0) {
      return false;
    }

    const allowKnownEndpointCrossDomain =
      source.retrievalOrigin === "known_endpoint" &&
      (intent === "current_status" || intent === "release_freshness") &&
      /github\.com/i.test(source.url) &&
      hitStats.specificHits > 0;

    if (preferredDomains.length > 0 && hitStats.identityHits === 0 && !allowKnownEndpointCrossDomain) {
      return false;
    }

    return hitStats.specificHits > 0 || hitStats.totalHits >= 2 || allowKnownEndpointIdentityOnly;
  }
}

function matchesCurrentStatusPath(path: string) {
  return (
    /\/status/i.test(path) ||
    /\/team/i.test(path) ||
    /\/leadership/i.test(path) ||
    /\/pricing/i.test(path) ||
    /\/availability/i.test(path) ||
    /\/about/i.test(path) ||
    /\/our-structure/i.test(path)
  );
}

function matchesPersistentCurrentStatusPath(path: string) {
  return /\/about/i.test(path) || /\/our-structure/i.test(path);
}

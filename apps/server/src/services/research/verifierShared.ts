import type {
  ResearchFreshnessWindow,
  ResearchSource,
  ResearchTemporalProfile
} from "../../types/arena.js";
import {
  extractFocusTerms,
  extractTerms,
  normalizeFocusToken,
  normalizeSpace
} from "./common.js";

export type SourceEntry = {
  source: ResearchSource;
  trustScore: number;
  effectiveDate: Date | null;
};

export type FreshnessAudit = {
  acceptedEntries: SourceEntry[];
  freshnessSatisfied: boolean;
  freshnessWindow: ResearchFreshnessWindow;
  mostRecentSourceDate: string | null;
  oldestAcceptedSourceDate: string | null;
  staleSourcesRejectedCount: number;
  failureNote: string | null;
};

export function parseSourceDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function uniqueNormalized(values: string[]) {
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

export function normalizeMatchingText(value: string) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/node\.js/g, "nodejs")
    .replace(/next\.js/g, "nextjs")
    .replace(/type\s*script/g, "typescript");
}

export function textIncludesTerm(text: string, term: string) {
  const normalizedTerm = normalizeFocusToken(term);
  return text.includes(term.toLowerCase()) || (normalizedTerm !== "" && text.includes(normalizedTerm));
}

export function minimumSupportHits(termCount: number, temporalProfile: ResearchTemporalProfile) {
  if (
    (temporalProfile.queryType === "current_status" ||
      temporalProfile.queryType === "release_freshness") &&
    termCount >= 2
  ) {
    return 2;
  }

  return 1;
}

export function textSupportsClaim(
  claim: string,
  text: string,
  temporalProfile: ResearchTemporalProfile
) {
  const terms = uniqueNormalized([
    ...extractTerms(claim),
    ...extractFocusTerms(claim)
  ]).slice(0, 5);
  if (terms.length === 0) {
    return false;
  }

  const normalizedText = normalizeMatchingText(text);
  const hits = terms.filter((term) => textIncludesTerm(normalizedText, term)).length;

  return hits >= Math.min(terms.length, minimumSupportHits(terms.length, temporalProfile));
}

export function claimSupported(
  claim: string,
  sourceText: string,
  verifiedFacts: string[],
  temporalProfile: ResearchTemporalProfile
) {
  const factText = verifiedFacts.join(" ");
  return textSupportsClaim(claim, `${sourceText} ${factText}`, temporalProfile);
}

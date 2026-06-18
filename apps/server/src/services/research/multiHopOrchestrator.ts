import type { QuestionCategory, ResearchSource, ResearchToolLog } from "../../types/arena.js";
import { extractTerms, uniqueStrings, type SearchPlan } from "./common.js";

export type HopDecision = {
  shouldHop: boolean;
  reason: string;
};

/**
 * Decides whether a second research hop is warranted after the first.
 *
 * Hops are cheap (same acquisition service) but add latency, so we only do one
 * follow-up and only when the first round left clear gaps:
 *  - Research was used but produced uncertain claims with few verified facts
 *  - Research attempted but nothing survived freshness/source filtering
 */
export function shouldDoSecondHop(
  firstLog: ResearchToolLog,
  category: QuestionCategory
): HopDecision {
  // Temporal queries already use date-aware retrieval — a generic follow-up won't help
  if (firstLog.queryPlan.temporalProfile.isTemporal) {
    return { shouldHop: false, reason: "temporal query — first hop is authoritative" };
  }

  // Writing categories: one pass of facts is enough
  if (category === "operational_writing" || category === "product_strategy") {
    return { shouldHop: false, reason: "writing/strategy category — multi-hop adds noise" };
  }

  // Already strong: 3+ verified facts and corroborated signals → no need
  if (
    firstLog.used &&
    firstLog.truth.verified_facts.length >= 3 &&
    firstLog.verification.corroboratedSignals.length >= 2
  ) {
    return { shouldHop: false, reason: "first hop produced sufficient corroborated facts" };
  }

  // Good case for second hop: research fired, found uncertain claims but few verified facts
  if (
    firstLog.used &&
    firstLog.truth.uncertain_claims.length >= 1 &&
    firstLog.truth.verified_facts.length < 3
  ) {
    return {
      shouldHop: true,
      reason: `First hop: ${firstLog.truth.verified_facts.length} verified fact(s), ${firstLog.truth.uncertain_claims.length} uncertain claim(s) — refining with targeted follow-up`
    };
  }

  // Sources were fetched but none passed the verifier (no reliable source but not a tool gap)
  if (
    !firstLog.used &&
    firstLog.verification.sourceCount > 0 &&
    firstLog.verification.extractedSourceCount === 0 &&
    !firstLog.truth.no_reliable_source
  ) {
    return {
      shouldHop: true,
      reason: `First hop fetched ${firstLog.verification.sourceCount} candidates but none were accepted — trying alternative query`
    };
  }

  return { shouldHop: false, reason: "first hop produced sufficient results" };
}

/**
 * Builds a follow-up SearchPlan focused on the uncertain claims from the first hop.
 * Uses domains that produced sources in the first hop, then falls back to the original
 * preferred domains.
 */
export function buildFollowUpPlan(
  firstLog: ResearchToolLog,
  originalPlan: SearchPlan
): SearchPlan | null {
  const uncertain = firstLog.truth.uncertain_claims.slice(0, 2);
  const verified = firstLog.truth.verified_facts.slice(0, 2);

  // Extract key terms from uncertain claims to narrow the follow-up
  const uncertainTerms = extractTerms(uncertain.join(" ")).slice(0, 5);
  // Keep a few original terms as anchors
  const anchorTerms = originalPlan.requiredTerms.slice(0, 3);
  const combinedTerms = uniqueStrings([...uncertainTerms, ...anchorTerms]);

  if (combinedTerms.length === 0) {
    return null;
  }

  // Prefer domains that actually returned sources in the first hop
  const firstHopDomains = uniqueStrings(
    firstLog.sources
      .map((s) => {
        try { return new URL(s.url).hostname.toLowerCase(); } catch { return ""; }
      })
      .filter(Boolean)
  ).slice(0, 2);

  const preferredDomains = uniqueStrings([
    ...firstHopDomains,
    ...originalPlan.preferredDomains
  ]).slice(0, 3);

  const focusQuery = combinedTerms.slice(0, 6).join(" ");
  const domainQuery =
    preferredDomains.length > 0
      ? `${focusQuery} site:${preferredDomains[0]}`
      : focusQuery;

  // If we already have some verified facts, exclude them from the query focus to avoid
  // re-fetching the same information
  const firstVerified = verified[0] ?? "";
  const terms = extractTerms(firstVerified).slice(0, 2);
  const verifiedExclusion = terms.length > 0 ? ` -"${terms.join('" -"')}"` : "";
  const refinedQuery = verifiedExclusion ? `${domainQuery}${verifiedExclusion}` : domainQuery;

  return {
    ...originalPlan,
    queries: uniqueStrings([refinedQuery, focusQuery, domainQuery]).slice(0, 2),
    requiredTerms: combinedTerms.slice(0, 8),
    preferredDomains,
    reasoning: `Multi-hop follow-up: targeting [${uncertainTerms.slice(0, 3).join(", ")}] to resolve uncertain claims from first search round.`
  };
}

/**
 * Merges source lists from two hops, deduplicating by URL.
 * First hop sources are kept first (already-verified sources take priority).
 */
export function mergeHopSources(first: ResearchSource[], second: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  const merged: ResearchSource[] = [];

  for (const source of [...first, ...second]) {
    if (!seen.has(source.url)) {
      seen.add(source.url);
      merged.push(source);
    }
  }

  return merged;
}

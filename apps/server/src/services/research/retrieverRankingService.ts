import {
  countEntityTermHits,
  getHostname,
  getPathname,
  matchesAny,
  type ScoredCandidate,
  type SearchCandidate,
  type SearchPlan
} from "./common.js";
import {
  hasExplicitDateSignal,
  scoreTemporalFreshness
} from "./temporal.js";
import {
  DOC_HINT_PATTERNS,
  getSearchDomainTrustScore,
  LOW_TRUST_DOMAIN_PATTERNS
} from "./trust.js";

export class ResearchRetrieverRankingService {
  rankCandidates(candidates: SearchCandidate[], plan: SearchPlan) {
    const bestByUrl = new Map<string, ScoredCandidate>();
    for (const candidate of candidates) {
      const score = this.scoreCandidate(candidate, plan);
      const trustScore = getSearchDomainTrustScore({
        domain: getHostname(candidate.url),
        path: getPathname(candidate.url),
        preferredDomains: plan.preferredDomains,
        intent: plan.intent
      });
      const existing = bestByUrl.get(candidate.url);
      if (!existing || score > existing.score) {
        bestByUrl.set(candidate.url, { candidate, score, trustScore });
      }
    }

    const qualifiedEntries = [...bestByUrl.values()]
      .sort(
        (left, right) =>
          right.trustScore - left.trustScore ||
          right.score - left.score ||
          left.candidate.url.localeCompare(right.candidate.url)
      )
      .filter((entry) => entry.score >= this.minimumCandidateScore(plan));

    // Apply trusted-domain filter before slicing — trusted candidates beyond rank 8
    // would otherwise be excluded before the high-trust path can consider them.
    const trustedRanked = qualifiedEntries
      .filter((entry) => this.isHighTrustDomain(getHostname(entry.candidate.url), plan))
      .slice(0, 5)
      .map((entry) => entry.candidate);
    if (trustedRanked.length > 0) {
      return trustedRanked;
    }

    const relaxed = [...bestByUrl.values()]
      .sort(
        (left, right) =>
          right.trustScore - left.trustScore ||
          right.score - left.score ||
          left.candidate.url.localeCompare(right.candidate.url)
      )
      .filter(
        (entry) =>
          !LOW_TRUST_DOMAIN_PATTERNS.some((pattern) =>
            pattern.test(getHostname(entry.candidate.url))
          )
      )
      .filter((entry) => entry.score >= Math.max(6, this.minimumCandidateScore(plan) - 4))
      .filter((entry) => entry.trustScore >= 0)
      .slice(0, 5)
      .map((entry) => entry.candidate);

    if (relaxed.length > 0) {
      return relaxed;
    }

    return [...bestByUrl.values()]
      .sort((left, right) => right.score - left.score)
      .filter((entry) => entry.score >= Math.max(4, this.minimumCandidateScore(plan) - 6))
      .slice(0, 3)
      .map((entry) => entry.candidate);
  }

  isHighTrustDomain(domain: string, plan: SearchPlan) {
    if (!domain) {
      return false;
    }

    return (
      getSearchDomainTrustScore({
        domain,
        path: "",
        preferredDomains: plan.preferredDomains,
        intent: plan.intent
      }) >= 26
    );
  }

  private minimumCandidateScore(plan: SearchPlan) {
    if (
      plan.intent === "current_status" ||
      plan.intent === "recent_updates" ||
      plan.intent === "release_freshness"
    ) {
      return plan.temporalProfile.focus === "recent" ||
        plan.temporalProfile.focus === "this_week" ||
        plan.temporalProfile.focus === "this_month" ||
        plan.temporalProfile.focus === "today"
        ? 16
        : 14;
    }

    switch (plan.intent) {
      case "definition":
      case "product_docs":
      case "diagnostic_docs":
      case "constraint_check":
        return 14;
      case "incident_guidance":
      case "metric_verification":
        return 12;
      case "fact_check":
      default:
        return 10;
    }
  }

  private scoreCandidate(candidate: SearchCandidate, plan: SearchPlan) {
    const domain = getHostname(candidate.url);
    const path = getPathname(candidate.url);
    const haystack = `${candidate.title} ${candidate.snippet}`.toLowerCase();
    const temporalHaystack = `${candidate.title} ${candidate.snippet} ${candidate.url}`;
    const entityHitStats = countEntityTermHits(
      temporalHaystack,
      plan.entityTerms,
      plan.preferredDomains
    );
    const isDocPath = matchesAny(path, [
      /\/docs?\//i,
      /\/documentation/i,
      /\/reference/i,
      /\/guide/i,
      /\/manual/i,
      /\/troubleshoot/i,
      /\/learn\//i
    ]);
    const isNewsPath = matchesAny(path, [/\/blog\//i, /\/news\//i, /\/press\//i, /\/announcements?\//i]);
    const isReleasePath = matchesAny(path, [/\/release/i, /\/releases\//i, /\/changelog/i, /\/version/i]);
    const isCurrentStatusPath = matchesAny(path, [
      /\/status/i,
      /\/team/i,
      /\/leadership/i,
      /\/about/i,
      /\/our-structure/i,
      /\/executive/i,
      /\/pricing/i,
      /\/availability/i
    ]);
    const allowKnownEndpointCrossDomain =
      candidate.retrievalOrigin === "known_endpoint" &&
      plan.temporalProfile.isTemporal &&
      (plan.intent === "current_status" || plan.intent === "release_freshness") &&
      /github\.com$/i.test(domain) &&
      entityHitStats.specificHits > 0;
    let score = getSearchDomainTrustScore({
      domain,
      path,
      preferredDomains: plan.preferredDomains,
      intent: plan.intent
    });

    if (plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))) {
      score += 20;
    }

    if (plan.intent === "current_status" && /\/our-structure/i.test(path)) {
      score += 8;
    }

    score += Math.min(18, entityHitStats.totalHits * 9);
    score += Math.min(14, entityHitStats.specificHits * 10);

    score += Math.min(
      24,
      plan.requiredTerms.reduce(
        (total, term) =>
          total + (term.length >= 4 && haystack.includes(term.toLowerCase()) ? 6 : 0),
        0
      )
    );

    if (DOC_HINT_PATTERNS.some((pattern) => pattern.test(candidate.title))) {
      score += 12;
    }

    if (DOC_HINT_PATTERNS.some((pattern) => pattern.test(candidate.snippet))) {
      score += 6;
    }

    if (isDocPath) {
      if (plan.intent === "release_freshness") {
        score += 4;
      } else if (plan.intent === "current_status") {
        score += 6;
      } else {
        score += 10;
      }
    }

    if (/\/docs\/current\//i.test(path) && !plan.temporalProfile.isTemporal) {
      score += 8;
    }

    if (isNewsPath || isReleasePath) {
      if (plan.intent === "recent_updates") {
        score += this.isHighTrustDomain(domain, plan) ? 12 : 5;
      } else if (plan.intent === "release_freshness") {
        score += isReleasePath ? (this.isHighTrustDomain(domain, plan) ? 14 : 6) : 4;
      } else if (plan.intent === "current_status") {
        score += isCurrentStatusPath ? 10 : -2;
      } else {
        score -= plan.intent === "metric_verification" ? 3 : 8;
      }
    }

    score += Math.min(
      12,
      plan.factFocusTerms.reduce(
        (total, term) =>
          total + (term.length >= 4 && haystack.includes(term.toLowerCase()) ? 4 : 0),
        0
      )
    );

    switch (plan.intent) {
      case "definition":
        if (matchesAny(haystack, [/\bwhat is\b/i, /\bexplained\b/i, /\bguide\b/i])) {
          score += 8;
        }
        break;
      case "diagnostic_docs":
        if (matchesAny(haystack, [/\btroubleshoot\b/i, /\berror\b/i, /\bdebug\b/i])) {
          score += 10;
        }
        break;
      case "constraint_check":
        if (
          matchesAny(haystack, [/\bscalab/i, /\blatency\b/i, /\bthroughput\b/i, /\bfailover\b/i])
        ) {
          score += 8;
        }
        break;
      case "incident_guidance":
        if (
          matchesAny(haystack, [/\bincident\b/i, /\bresponse\b/i, /\bbreach\b/i, /\bcredential\b/i])
        ) {
          score += 8;
        }
        break;
      case "metric_verification":
        if (matchesAny(haystack, [/\bmetric\b/i, /\badoption\b/i, /\bbenchmark\b/i, /\broi\b/i])) {
          score += 8;
        }
        break;
      case "current_status":
        if (
          matchesAny(haystack, [
            /\bcurrent\b/i,
            /\bleadership\b/i,
            /\bstatus\b/i,
            /\bversion\b/i,
            /\bboard\b/i,
            /\bgovernance\b/i,
            /\bstructure\b/i,
            /\bceo\b/i
          ])
        ) {
          score += 10;
        }
        break;
      case "recent_updates":
        if (matchesAny(haystack, [/\bupdate\b/i, /\bnews\b/i, /\bannouncement\b/i, /\bthis week\b/i])) {
          score += 10;
        }
        break;
      case "release_freshness":
        if (matchesAny(haystack, [/\brelease\b/i, /\bversion\b/i, /\bchangelog\b/i, /\brelease notes\b/i])) {
          score += 10;
        }
        break;
      default:
        break;
    }

    if (plan.temporalProfile.isTemporal) {
      if (
        (plan.intent === "current_status" || plan.intent === "release_freshness") &&
        plan.entityTerms.length > 0 &&
        entityHitStats.totalHits === 0
      ) {
        return -20;
      }

      if (
        plan.preferredDomains.length > 0 &&
        entityHitStats.identityHits === 0 &&
        !allowKnownEndpointCrossDomain
      ) {
        return -18;
      }

      if (
        (plan.intent === "current_status" || plan.intent === "release_freshness") &&
        entityHitStats.totalHits > 0 &&
        entityHitStats.specificHits === 0
      ) {
        if (candidate.retrievalOrigin === "known_endpoint") {
          score += isCurrentStatusPath ? 2 : -8;
        } else {
          return -14;
        }
      }

      score += scoreTemporalFreshness(temporalHaystack, plan.temporalProfile);

      if (
        matchesAny(haystack, [
          /\brelease notes?\b/i,
          /\bchangelog\b/i,
          /\bannounc(?:ed|ement)\b/i,
          /\bupdated?\b/i,
          /\bstatus\b/i
        ])
      ) {
        score += 8;
      }

      if (
        (plan.temporalProfile.focus === "recent" ||
          plan.temporalProfile.focus === "this_week" ||
          plan.temporalProfile.focus === "today") &&
        !hasExplicitDateSignal(temporalHaystack)
      ) {
        score -= 6;
      }
    }

    return score;
  }
}

import { KNOWN_FRESH_ENDPOINTS } from "../../data/researchKnownEndpoints.js";
import {
  countEntityTermHits,
  getHostname,
  normalizeSpace,
  type SearchCandidate,
  type SearchPlan
} from "./common.js";

export class ResearchKnownEndpointService {
  getCandidates(plan: SearchPlan, excludeUrls: string[] = []) {
    const excluded = new Set(excludeUrls);

    return KNOWN_FRESH_ENDPOINTS.map((endpoint) => {
      const domainMatch = endpoint.domains.some(
        (domain) =>
          plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase())) ||
          getHostname(endpoint.url).endsWith(domain.toLowerCase())
      );
      const termHitStats = countEntityTermHits(
        `${endpoint.title} ${endpoint.snippet} ${endpoint.termHints.join(" ")} ${endpoint.url}`,
        plan.entityTerms,
        plan.preferredDomains
      );
      const requiresSpecificHit =
        plan.intent === "current_status" || plan.intent === "release_freshness";
      const intentMatch = endpoint.intents.includes(plan.intent);
      const score =
        endpoint.priority +
        (intentMatch ? 18 : 0) +
        (domainMatch ? 20 : 0) +
        termHitStats.totalHits * 10 +
        termHitStats.specificHits * 12;

      return {
        endpoint,
        score,
        include:
          !excluded.has(endpoint.url) &&
          termHitStats.totalHits > 0 &&
          (plan.preferredDomains.length === 0 || termHitStats.identityHits > 0) &&
          (!requiresSpecificHit ||
            termHitStats.specificHits > 0 ||
            termHitStats.totalHits >= 2) &&
          (intentMatch || domainMatch) &&
          score >= 92
      };
    })
      .filter((entry) => entry.include)
      .sort((left, right) => right.score - left.score || left.endpoint.url.localeCompare(right.endpoint.url))
      .slice(0, 4)
      .map(
        (entry) =>
          ({
            title: entry.endpoint.title,
            url: entry.endpoint.url,
            snippet: normalizeSpace(entry.endpoint.snippet),
            retrievalChannel: "live",
            retrievalOrigin: "known_endpoint",
            retrievalEngine: "known_endpoint"
          }) satisfies SearchCandidate
      );
  }
}

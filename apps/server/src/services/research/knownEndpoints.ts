import { KNOWN_FRESH_ENDPOINTS } from "../../data/researchKnownEndpoints.js";
import {
  getHostname,
  normalizeSpace,
  uniqueStrings,
  type SearchCandidate,
  type SearchPlan
} from "./common.js";

export class ResearchKnownEndpointService {
  getCandidates(plan: SearchPlan, excludeUrls: string[] = []) {
    const excluded = new Set(excludeUrls);
    const planTerms = uniqueStrings([
      ...plan.requiredTerms,
      ...plan.factFocusTerms,
      ...plan.preferredDomains
    ]).map((term) => term.toLowerCase());

    return KNOWN_FRESH_ENDPOINTS.map((endpoint) => {
      const domainMatch = endpoint.domains.some(
        (domain) =>
          plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase())) ||
          getHostname(endpoint.url).endsWith(domain.toLowerCase())
      );
      const termHits = endpoint.termHints.filter((term) =>
        planTerms.some((planTerm) => planTerm.includes(term.toLowerCase()) || term.includes(planTerm))
      ).length;
      const intentMatch = endpoint.intents.includes(plan.intent);
      const score =
        endpoint.priority +
        (intentMatch ? 18 : 0) +
        (domainMatch ? 20 : 0) +
        termHits * 10;

      return {
        endpoint,
        score,
        include: !excluded.has(endpoint.url) && (domainMatch || termHits > 0) && score >= 92
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

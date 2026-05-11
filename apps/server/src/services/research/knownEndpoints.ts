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

    const staticCandidates = KNOWN_FRESH_ENDPOINTS.map((endpoint) => {
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
      const allowHighPrioritySpecificAlias =
        endpoint.priority >= 90 && termHitStats.specificHits > 0;
      const intentMatch = endpoint.intents.includes(plan.intent);
      const score =
        endpoint.priority +
        (intentMatch ? 18 : 0) +
        (domainMatch ? 20 : 0) +
        termHitStats.totalHits * 10 +
        termHitStats.specificHits * 12;

      const allowHighPriorityIdentityOnly =
        requiresSpecificHit && termHitStats.identityHits > 0 && endpoint.priority >= 90;

      return {
        endpoint,
        score,
        include:
          !excluded.has(endpoint.url) &&
          termHitStats.totalHits > 0 &&
          (plan.preferredDomains.length === 0 ||
            termHitStats.identityHits > 0 ||
            allowHighPrioritySpecificAlias) &&
          (!requiresSpecificHit ||
            termHitStats.specificHits > 0 ||
            termHitStats.totalHits >= 2 ||
            allowHighPriorityIdentityOnly) &&
          (intentMatch || domainMatch) &&
          score >= 92
      };
    })
      .filter((entry) => entry.include)
      .sort((left, right) => right.score - left.score || left.endpoint.url.localeCompare(right.endpoint.url))
      .slice(0, 4);
    const generatedCandidates = [
      ...this.buildIdentityReferenceCandidates(plan, excluded),
      ...this.buildDefinitionReferenceCandidates(plan, excluded),
      ...this.buildGeneratedCandidates(plan, excluded)
    ];

    return [...staticCandidates, ...generatedCandidates]
      .sort((left, right) => right.score - left.score || left.endpoint.url.localeCompare(right.endpoint.url))
      .slice(0, 6)
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

  private buildIdentityReferenceCandidates(plan: SearchPlan, excluded: Set<string>) {
    if (
      plan.intent !== "fact_check" ||
      !/\b(?:identity lookup|biography encyclopedia|historical reference)\b/i.test(
        `${plan.reasoning} ${plan.queries.join(" ")}`
      )
    ) {
      return [];
    }

    const subject = this.extractIdentitySubject(plan);
    if (!subject) {
      return [];
    }

    const slug = subject
      .split(/\s+/)
      .filter(Boolean)
      .map((part) =>
        /^(?:i|v|x|l|c|d|m)+$/i.test(part)
          ? part.toUpperCase()
          : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
      )
      .join("_");
    const urls = [
      `https://fr.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      `https://fr.wikipedia.org/wiki/${slug}`,
      `https://en.wikipedia.org/wiki/${slug}`
    ];

    return urls
      .filter((url) => !excluded.has(url))
      .map((url, index) => ({
        endpoint: {
          url,
          title: subject,
          snippet: `Reference page for ${subject}.`
        },
        score: 130 - index
      }));
  }

  private extractIdentitySubject(plan: SearchPlan) {
    const query = plan.queries[0] ?? "";
    const subject = normalizeSpace(
      query
        .replace(/\bsite:[^\s]+/gi, " ")
        .replace(/\b(?:biographie|encyclopedie|encyclopédie|biography|encyclopedia|historical|reference|wikipedia|francais|français)\b/gi, " ")
        .replace(/["']/g, " ")
    );

    return subject.length >= 2 ? subject.toLowerCase() : "";
  }

  private buildDefinitionReferenceCandidates(plan: SearchPlan, excluded: Set<string>) {
    if (plan.intent !== "definition") {
      return [];
    }

    const subject = this.extractDefinitionSubject(plan);
    if (!subject) {
      return [];
    }

    const slug = subject
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join("_");
    const urls = [
      `https://fr.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      `https://fr.wikipedia.org/wiki/${slug}`,
      `https://en.wikipedia.org/wiki/${slug}`
    ];

    return urls
      .filter((url) => !excluded.has(url))
      .map((url, index) => ({
        endpoint: {
          url,
          title: subject,
          snippet: `Encyclopedia reference page for ${subject}.`
        },
        score: 118 - index
      }));
  }

  private extractDefinitionSubject(plan: SearchPlan) {
    const terms = [
      ...plan.factFocusTerms,
      ...plan.entityTerms,
      ...plan.requiredTerms,
      ...plan.queries.flatMap((query) =>
        normalizeSpace(query)
          .replace(/\bsite:[^\s]+/gi, " ")
          .replace(
            /\b(?:official|documentation|reference|explanation|examples|standard|rfc|mdn|encyclopedia|encyclopedie|encyclopÃ©die)\b/gi,
            " "
          )
          .split(/\s+/)
      )
    ]
      .map((term) => normalizeSpace(term.replace(/["']/g, " ")).toLowerCase())
      .filter((term) => /^[a-z0-9][a-z0-9-]{2,40}$/i.test(term));

    return terms.find(Boolean) ?? "";
  }

  private buildGeneratedCandidates(plan: SearchPlan, excluded: Set<string>) {
    const primaryDomains = plan.preferredDomains
      .filter((domain) => domain.includes(".") && domain !== "github.com")
      .slice(0, 2);

    const pathTemplates =
      plan.intent === "current_status"
        ? [
            { path: "/about", title: "About", snippet: "Official about and leadership page.", terms: ["leadership", "team", "about"] },
            { path: "/team", title: "Team", snippet: "Official team and leadership page.", terms: ["team", "leadership"] },
            { path: "/leadership", title: "Leadership", snippet: "Official leadership page.", terms: ["leadership", "ceo", "executive"] },
            { path: "/pricing", title: "Pricing", snippet: "Official pricing and current plan page.", terms: ["pricing", "price"] },
            { path: "/status", title: "Status", snippet: "Official current service status page.", terms: ["status", "availability"] }
          ]
        : plan.intent === "recent_updates"
          ? [
              { path: "/news", title: "News", snippet: "Official news and announcements page.", terms: ["news", "announcements"] },
              { path: "/blog", title: "Blog", snippet: "Official blog and updates page.", terms: ["blog", "updates"] },
              { path: "/announcements", title: "Announcements", snippet: "Official announcements page.", terms: ["announcements", "updates"] },
              { path: "/changelog", title: "Changelog", snippet: "Official changelog and release updates.", terms: ["changelog", "release"] }
            ]
          : [
              { path: "/releases", title: "Releases", snippet: "Official releases page.", terms: ["releases", "release", "version"] },
              { path: "/release", title: "Release", snippet: "Official release information page.", terms: ["release", "version"] },
              { path: "/changelog", title: "Changelog", snippet: "Official changelog page.", terms: ["changelog", "release"] },
              { path: "/blog", title: "Blog", snippet: "Official release posts and announcements.", terms: ["blog", "release"] }
            ];

    return primaryDomains.flatMap((domain) =>
      pathTemplates
        .map((template) => {
          const url = `https://${domain}${template.path}`;
          const termHitStats = countEntityTermHits(
            `${domain} ${template.title} ${template.snippet} ${template.terms.join(" ")}`,
            plan.entityTerms,
            plan.preferredDomains
          );
          const score =
            68 +
            termHitStats.totalHits * 10 +
            termHitStats.specificHits * 12 +
            (termHitStats.identityHits > 0 ? 18 : 0);

          const allowHighPriorityIdentityOnly =
            (plan.intent === "current_status" || plan.intent === "release_freshness") &&
            termHitStats.identityHits > 0 &&
            score >= 92;
          const allowHighPrioritySpecificAlias =
            (plan.intent === "current_status" || plan.intent === "release_freshness") &&
            termHitStats.specificHits > 0 &&
            score >= 92;

          return {
            endpoint: {
              url,
              title: `${domain} ${template.title}`,
              snippet: template.snippet
            },
            score,
            include:
              !excluded.has(url) &&
              termHitStats.totalHits > 0 &&
              (termHitStats.identityHits > 0 || allowHighPrioritySpecificAlias) &&
              (termHitStats.specificHits > 0 ||
                termHitStats.totalHits >= 2 ||
                allowHighPriorityIdentityOnly)
          };
        })
        .filter((entry) => entry.include)
    );
  }
}

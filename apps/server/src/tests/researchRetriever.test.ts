import test from "node:test";
import assert from "node:assert/strict";
import { ResearchRetriever } from "../services/research/retriever.js";
import type { SearchPlan } from "../services/research/common.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";

function buildPlan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    intent: "current_status",
    mode: "targeted_verify",
    queries: ["openai current ceo official"],
    requiredTerms: ["openai", "ceo", "official"],
    preferredDomains: ["openai.com"],
    factFocusTerms: ["ceo", "leadership"],
    entityTerms: ["openai", "ceo", "altman"],
    temporalProfile: {
      ...buildDefaultTemporalProfile(),
      isTemporal: true,
      focus: "current",
      queryType: "current_status",
      recencyDays: 120,
      absoluteDateHint: "April 17, 2026"
    },
    reasoning: "Test plan.",
    ...overrides
  };
}

test("research retriever ranking prefers official current-status pages over generic or low-trust results", async () => {
  const retriever = new ResearchRetriever({
    searchService: {
      async search() {
        return [
          {
            title: "OpenAI leadership",
            url: "https://openai.com/leadership",
            snippet: "Current leadership team and CEO",
            retrievalChannel: "live",
            retrievalOrigin: "known_endpoint",
            retrievalEngine: "known_endpoint"
          },
          {
            title: "OpenAI blog update",
            url: "https://openai.com/blog/company-update",
            snippet: "Company update from OpenAI",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          },
          {
            title: "StackOverflow discussion",
            url: "https://stackoverflow.com/questions/1/openai-ceo",
            snippet: "Community discussion",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          }
        ];
      }
    }
  });

  const ranked = await retriever.searchAll(buildPlan());

  assert.equal(ranked[0]?.url, "https://openai.com/leadership");
  assert.ok(!ranked.some((candidate) => candidate.url.includes("stackoverflow.com")));
});

test("research retriever keeps high-trust release pages when ranking temporal release freshness queries", async () => {
  const retriever = new ResearchRetriever({
    searchService: {
      async search() {
        return [
          {
            title: "Node.js v24 release notes",
            url: "https://nodejs.org/en/blog/release/v24.1.0",
            snippet: "Release notes and version details",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          },
          {
            title: "Random forum post",
            url: "https://forum.example.com/node-v24",
            snippet: "Someone talking about Node v24",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          }
        ];
      }
    }
  });

  const ranked = await retriever.searchAll(
    buildPlan({
      intent: "release_freshness",
      queries: ["nodejs latest release official"],
      preferredDomains: ["nodejs.org"],
      factFocusTerms: ["release", "version", "v24"],
      entityTerms: ["nodejs", "release", "v24"],
      temporalProfile: {
        ...buildDefaultTemporalProfile(),
        isTemporal: true,
        focus: "latest",
        queryType: "release_freshness",
        recencyDays: 365,
        absoluteDateHint: "April 17, 2026"
      }
    })
  );

  assert.equal(ranked[0]?.url, "https://nodejs.org/en/blog/release/v24.1.0");
});

test("research retriever keeps known GitHub release feeds for temporal release queries when the canonical product domain differs", async () => {
  const retriever = new ResearchRetriever({
    searchService: {
      async search() {
        return [];
      }
    }
  });

  const ranked = await retriever.searchAll(
    buildPlan({
      intent: "release_freshness",
      queries: ["TypeScript latest release official"],
      preferredDomains: ["typescriptlang.org", "devblogs.microsoft.com", "github.com"],
      requiredTerms: ["typescript", "latest", "release"],
      factFocusTerms: ["latest", "typescript", "release"],
      entityTerms: ["typescript"],
      temporalProfile: {
        ...buildDefaultTemporalProfile(),
        isTemporal: true,
        focus: "latest",
        queryType: "release_freshness",
        recencyDays: 365,
        absoluteDateHint: "April 18, 2026"
      }
    }),
    [
      {
        title: "TypeScript Releases Atom",
        url: "https://github.com/microsoft/TypeScript/releases.atom",
        snippet: "Canonical TypeScript release feed with dated entries.",
        retrievalChannel: "live",
        retrievalOrigin: "known_endpoint",
        retrievalEngine: "known_endpoint"
      }
    ]
  );

  assert.equal(ranked[0]?.url, "https://github.com/microsoft/TypeScript/releases.atom");
});

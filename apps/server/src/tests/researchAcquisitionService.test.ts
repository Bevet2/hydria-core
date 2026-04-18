import test from "node:test";
import assert from "node:assert/strict";
import { ResearchAcquisitionService } from "../services/research/acquisitionService.js";
import type { SearchPlan } from "../services/research/common.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";

function buildPlan(overrides: Partial<SearchPlan> = {}): SearchPlan {
  return {
    intent: "current_status",
    mode: "targeted_verify",
    queries: ["openai current ceo official"],
    requiredTerms: ["openai", "ceo"],
    preferredDomains: ["openai.com"],
    factFocusTerms: ["ceo"],
    entityTerms: ["openai", "ceo"],
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

test("research acquisition excludes cached urls from extraction and persists extracted sources", async () => {
  const plan = buildPlan();
  const extractedCalls: { urls: string[]; plan: SearchPlan }[] = [];
  const rememberedCalls: Array<{ plan: SearchPlan; urls: string[] }> = [];

  const service = new ResearchAcquisitionService({
    sourceCacheEnabled: true,
    sourceCacheService: {
      async getFreshSources() {
        return [
          {
            title: "OpenAI leadership",
            url: "https://openai.com/leadership",
            snippet: "Leadership team",
            excerpt: "OpenAI leadership page with CEO details.",
            publishedAt: null,
            modifiedAt: null,
            effectiveDate: null,
            dateSource: null,
            retrievalChannel: "cache",
            retrievalOrigin: "known_endpoint",
            retrievalEngine: "cache"
          }
        ];
      },
      async rememberSources(inputPlan, sources) {
        rememberedCalls.push({
          plan: inputPlan,
          urls: sources.map((source) => source.url)
        });
      }
    },
    knownEndpointService: {
      getCandidates() {
        return [
          {
            title: "OpenAI leadership",
            url: "https://openai.com/leadership",
            snippet: "Leadership team",
            retrievalChannel: "live",
            retrievalOrigin: "known_endpoint",
            retrievalEngine: "known_endpoint"
          }
        ];
      }
    },
    retriever: {
      async searchAll() {
        return [
          {
            title: "OpenAI blog",
            url: "https://openai.com/blog/update",
            snippet: "Recent update",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          },
          {
            title: "OpenAI leadership",
            url: "https://openai.com/leadership",
            snippet: "Leadership team",
            retrievalChannel: "live",
            retrievalOrigin: "known_endpoint",
            retrievalEngine: "known_endpoint"
          }
        ];
      }
    },
    extractor: {
      async extractSources(results, inputPlan) {
        extractedCalls.push({
          urls: results.map((result) => result.url),
          plan: inputPlan
        });
        return [
          {
            title: "OpenAI blog",
            url: "https://openai.com/blog/update",
            snippet: "Recent update",
            excerpt: "The blog confirms a dated leadership update.",
            publishedAt: "2026-04-16T00:00:00.000Z",
            modifiedAt: null,
            effectiveDate: "2026-04-16T00:00:00.000Z",
            dateSource: "meta",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          }
        ];
      }
    }
  });

  const result = await service.collect(plan);

  assert.deepEqual(extractedCalls[0]?.urls, ["https://openai.com/blog/update"]);
  assert.equal(rememberedCalls.length, 1);
  assert.deepEqual(rememberedCalls[0]?.urls, ["https://openai.com/blog/update"]);
  assert.deepEqual(
    result.sources.map((source) => source.url),
    ["https://openai.com/leadership", "https://openai.com/blog/update"]
  );
});

test("research acquisition prefers dated or richer sources when merging duplicates", async () => {
  const plan = buildPlan({
    intent: "release_freshness",
    preferredDomains: ["nodejs.org"],
    entityTerms: ["nodejs", "release", "v24"],
    factFocusTerms: ["release", "v24"]
  });

  const service = new ResearchAcquisitionService({
    sourceCacheEnabled: false,
    sourceCacheService: {
      async getFreshSources() {
        return [];
      },
      async rememberSources() {}
    },
    knownEndpointService: {
      getCandidates() {
        return [];
      }
    },
    retriever: {
      async searchAll() {
        return [
          {
            title: "Node release",
            url: "https://nodejs.org/en/blog/release/v24",
            snippet: "Release page",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          }
        ];
      }
    },
    extractor: {
      async extractSources() {
        return [
          {
            title: "Node release",
            url: "https://nodejs.org/en/blog/release/v24",
            snippet: "Release page",
            excerpt: "Node v24 release announcement.",
            publishedAt: null,
            modifiedAt: null,
            effectiveDate: null,
            dateSource: null,
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          },
          {
            title: "Node release",
            url: "https://nodejs.org/en/blog/release/v24",
            snippet: "Release page",
            excerpt: "Node v24 release announcement with explicit publication date and extra details.",
            publishedAt: "2026-04-15T00:00:00.000Z",
            modifiedAt: null,
            effectiveDate: "2026-04-15T00:00:00.000Z",
            dateSource: "meta",
            retrievalChannel: "live",
            retrievalOrigin: "generic_search",
            retrievalEngine: "bing_html"
          }
        ];
      }
    }
  });

  const result = await service.collect(plan);
  const merged = result.sources[0];

  assert.ok(merged);
  assert.equal(merged.effectiveDate, "2026-04-15T00:00:00.000Z");
  assert.match(merged.excerpt, /explicit publication date/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
import { ResearchExtractor } from "../services/research/extractor.js";
import { ResearchExtractorDateService } from "../services/research/extractorDateService.js";
import { ResearchExtractorPageService } from "../services/research/extractorPageService.js";
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
      absoluteDateHint: "April 18, 2026"
    },
    reasoning: "Test plan.",
    ...overrides
  };
}

test("extractor page service detects leadership pages and surfaces leadership claims in excerpts", () => {
  const service = new ResearchExtractorPageService();
  const plan = buildPlan();
  const pageType = service.detectPageType(
    {
      title: "OpenAI leadership",
      url: "https://openai.com/leadership",
      snippet: "Leadership team and executives"
    },
    plan
  );

  const excerpt = service.buildRelevantExcerpt(
    "OpenAI leadership overview. Sam Altman is the CEO of OpenAI and leads the organization as of April 2026. The rest of the page contains background information about the leadership team and company history.",
    plan,
    pageType,
    "Leadership team and executives",
    "OpenAI leadership"
  );

  assert.equal(pageType, "leadership");
  assert.match(excerpt ?? "", /Sam Altman is the CEO of OpenAI/i);
});

test("extractor page service treats governance pages as leadership sources when they name the CEO", () => {
  const service = new ResearchExtractorPageService();
  const plan = buildPlan({
    requiredTerms: ["openai", "ceo", "current"],
    factFocusTerms: ["ceo", "leadership", "current"],
    entityTerms: ["openai", "ceo", "sam altman"]
  });
  const pageType = service.detectPageType(
    {
      title: "OpenAI Our Structure",
      url: "https://openai.com/our-structure/",
      snippet: "Official OpenAI structure and governance page."
    },
    plan
  );

  const excerpt = service.buildRelevantExcerpt(
    "OpenAI structure overview. We designed OpenAI's structure so the mission and governance stay aligned over time. This recapitalization provides OpenAI Group with the structure to raise capital and attract and retain talent needed to advance the mission. Additional governance details follow. The OpenAI Foundation is governed by its board of directors, which includes CEO Sam Altman. The structure is designed so the mission and governance stay aligned.",
    plan,
    pageType,
    "Official OpenAI structure and governance page.",
    "OpenAI Our Structure"
  );

  assert.equal(pageType, "leadership");
  assert.match(excerpt ?? "", /CEO Sam Altman/i);
});

test("extractor date service prefers explicit meta dates over weaker fallbacks", () => {
  const service = new ResearchExtractorDateService();
  const $ = load(`
    <html>
      <head>
        <meta property="article:published_time" content="2026-04-10T08:00:00.000Z" />
        <meta property="article:modified_time" content="2026-04-15T10:30:00.000Z" />
        <script type="application/ld+json">
          {"datePublished":"2026-04-09T12:00:00.000Z","dateModified":"2026-04-14T12:00:00.000Z"}
        </script>
      </head>
      <body>
        <article>
          <p>Updated April 15, 2026 with leadership changes.</p>
        </article>
      </body>
    </html>
  `);

  const metadata = service.extractDateMetadata({
    $,
    title: "OpenAI leadership update",
    snippet: "Leadership changes announced"
  });

  assert.equal(metadata.publishedAt, "2026-04-09T12:00:00.000Z");
  assert.equal(metadata.modifiedAt, "2026-04-15T10:30:00.000Z");
  assert.equal(metadata.effectiveDate, "2026-04-15T10:30:00.000Z");
  assert.equal(metadata.dateSource, "meta");
});

test("research extractor pulls dated excerpts from atom release feeds", () => {
  const extractor = new ResearchExtractor();
  const extracted = (extractor as any).tryExtractFeedDocument(
    {
      title: "Next.js Releases Atom",
      url: "https://github.com/vercel/next.js/releases.atom",
      snippet: "Canonical Next.js release feed.",
      retrievalChannel: "live",
      retrievalOrigin: "known_endpoint",
      retrievalEngine: "known_endpoint"
    },
    `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>v16.0.0</title>
          <updated>2026-04-14T12:00:00Z</updated>
          <summary>Next.js 16.0.0 release with cache components and routing updates.</summary>
        </entry>
        <entry>
          <title>v15.4.2</title>
          <updated>2026-03-22T08:30:00Z</updated>
          <summary>Patch release.</summary>
        </entry>
      </feed>`,
    buildPlan({
      intent: "release_freshness",
      queries: ["nextjs latest release official"],
      preferredDomains: ["nextjs.org", "github.com"],
      factFocusTerms: ["release", "version", "nextjs"],
      entityTerms: ["nextjs", "release", "version"],
      temporalProfile: {
        ...buildDefaultTemporalProfile(),
        isTemporal: true,
        focus: "latest",
        queryType: "release_freshness",
        recencyDays: 180,
        absoluteDateHint: "April 18, 2026"
      }
    })
  );

  assert.ok(extracted);
  assert.match(extracted.excerpt, /Next\.js 16\.0\.0 release/i);
  assert.equal(extracted.effectiveDate, "2026-04-14T12:00:00.000Z");
  assert.doesNotMatch(extracted.excerpt, /<[^>]+>/);
});

test("research extractor rejects 404 or challenge pages as unusable sources", async () => {
  const extractor = new ResearchExtractor();
  const extracted = (extractor as any).tryBuildSnippetFallback(
    {
      title: "OpenAI leadership",
      url: "https://openai.com/leadership",
      snippet:
        "URL Source: http://openai.com/leadership Warning: Target URL returned error 404: Not Found Markdown Content: # 404: This page could not be found.",
      retrievalChannel: "live",
      retrievalOrigin: "known_endpoint",
      retrievalEngine: "known_endpoint"
    },
    buildPlan()
  );

  assert.equal(extracted, null);
});

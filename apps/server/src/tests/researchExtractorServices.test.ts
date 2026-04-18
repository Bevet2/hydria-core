import test from "node:test";
import assert from "node:assert/strict";
import { load } from "cheerio";
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

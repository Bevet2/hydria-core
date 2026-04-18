import test from "node:test";
import assert from "node:assert/strict";
import { detectTemporalQuery } from "../services/research/temporal.js";
import {
  getSearchDomainTrustScore,
  getSourceTrustScore
} from "../services/research/trust.js";

test("detectTemporalQuery resolves this week into an absolute window", () => {
  const profile = detectTemporalQuery(
    "major AI updates this week",
    new Date("2026-04-17T12:00:00.000Z")
  );

  assert.equal(profile.isTemporal, true);
  assert.equal(profile.queryType, "recent_updates");
  assert.equal(profile.focus, "this_week");
  assert.equal(profile.dateRangeStart, "2026-04-13");
  assert.equal(profile.dateRangeEnd, "2026-04-19");
});

test("trust helpers distinguish temporal official news from generic fact-check paths", () => {
  const recentScore = getSearchDomainTrustScore({
    domain: "openai.com",
    path: "/blog/update",
    preferredDomains: [],
    intent: "recent_updates"
  });
  const factCheckScore = getSearchDomainTrustScore({
    domain: "openai.com",
    path: "/blog/update",
    preferredDomains: [],
    intent: "fact_check"
  });

  assert.equal(recentScore, 34);
  assert.equal(factCheckScore, 20);
  assert.equal(getSourceTrustScore("https://stackoverflow.com/questions/1", []), -12);
});

import test from "node:test";
import assert from "node:assert/strict";
import { ResearchVerifier } from "../services/research/verifier.js";
import type {
  ResearchDecision,
  ResearchDecisionArgs,
  SearchCandidate
} from "../services/research/common.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";
import type { ResearchSource } from "../types/arena.js";

const baseRespondent = {
  modelRole: "respondent" as const,
  answer: "Distributed systems often trade some immediacy for availability.",
  key_points: ["Tradeoffs matter."],
  assumptions: [],
  confidence: 68
};

const baseRedTeam = {
  modelRole: "redteam" as const,
  attacks_on_a: [],
  attacks_on_b: [],
  shared_risks: [],
  failure_scenarios: [],
  hidden_assumptions: [],
  potentially_false_claims: [],
  factual_risk_level: 32,
  reasoning_risk_level: 28,
  winner_so_far: "tie" as const
};

function buildArgs(): ResearchDecisionArgs {
  return {
    question: "Who is the current CEO of OpenAI?",
    category: "mixed_reasoning",
    respondentA: baseRespondent,
    respondentB: baseRespondent,
    redTeam: baseRedTeam,
    shouldRefineA: true,
    shouldRefineB: true,
    orchestration: null
  };
}

function buildDecision(recencyDays = 365): ResearchDecision {
  return {
    shouldUse: true,
    reasons: ["Temporal current-status query requires fresh sourcing."],
    triggerSignals: ["temporal_query_current_status"],
    targetClaims: ["Sam Altman is the current CEO of OpenAI."],
    expectedValue: "high",
    expectedCostMs: 2600,
    knowledgeStrategy: null,
    plan: {
      intent: "current_status",
      mode: "targeted_verify",
      queries: ["openai current ceo official leadership"],
      requiredTerms: ["openai", "ceo", "altman"],
      preferredDomains: ["openai.com"],
      factFocusTerms: ["ceo", "altman"],
      entityTerms: ["openai", "ceo", "altman"],
      temporalProfile: {
        ...buildDefaultTemporalProfile(),
        isTemporal: true,
        focus: "current",
        queryType: "current_status",
        recencyDays,
        absoluteDateHint: "April 17, 2026"
      },
      reasoning: "Verify the current status from official leadership pages."
    }
  };
}

function buildSearchResults(): SearchCandidate[] {
  return [
    {
      title: "OpenAI leadership",
      url: "https://openai.com/leadership",
      snippet: "Leadership team"
    }
  ];
}

function buildFreshSource(effectiveDate: string): ResearchSource {
  return {
    title: "OpenAI leadership",
    url: "https://openai.com/leadership",
    snippet: "Leadership team",
    excerpt:
      "As of April 10, 2026, Sam Altman is the CEO of OpenAI and leads the organization.",
    publishedAt: effectiveDate,
    modifiedAt: null,
    effectiveDate,
    dateSource: "meta",
    retrievalChannel: "live",
    retrievalOrigin: "known_endpoint",
    retrievalEngine: "known_endpoint"
  };
}

test("research verifier uses fresh official sources for temporal current-status claims", () => {
  const verifier = new ResearchVerifier();
  const log = verifier.buildLog({
    decision: buildDecision(),
    args: buildArgs(),
    searchResults: buildSearchResults(),
    sources: [buildFreshSource("2026-04-10T00:00:00.000Z")],
    startedAt: Date.now() - 50
  });

  assert.equal(log.used, true);
  assert.equal(log.verification.freshnessSatisfied, true);
  assert.equal(log.truth.no_reliable_source, false);
  assert.ok(log.truth.verified_facts.some((fact) => /sam altman/i.test(fact)));
});

test("research verifier rejects stale temporal sources and reports freshness failure", () => {
  const verifier = new ResearchVerifier();
  const log = verifier.buildLog({
    decision: buildDecision(30),
    args: buildArgs(),
    searchResults: buildSearchResults(),
    sources: [buildFreshSource("2024-01-15T00:00:00.000Z")],
    startedAt: Date.now() - 50
  });

  assert.equal(log.used, false);
  assert.equal(log.verification.freshnessSatisfied, false);
  assert.equal(log.truth.no_reliable_source, true);
  assert.match(log.impactNotes[0] ?? "", /no sufficiently recent source/i);
});

test("research verifier impact accounting marks visible source uptake as positive", () => {
  const verifier = new ResearchVerifier();
  const log = verifier.buildLog({
    decision: buildDecision(),
    args: buildArgs(),
    searchResults: buildSearchResults(),
    sources: [buildFreshSource("2026-04-10T00:00:00.000Z")],
    startedAt: Date.now() - 50
  });

  const finalized = verifier.finalizeImpact({
    log,
    respondentA: {
      ...baseRespondent,
      answer: "OpenAI has a leadership team."
    },
    respondentB: {
      ...baseRespondent,
      answer: "The company has executives."
    },
    refineA: {
      improved_answer: "Sam Altman is the current CEO of OpenAI, according to the leadership page.",
      fixes_applied: ["Added the verified CEO name."]
    },
    refineB: {
      improved_answer: "The leadership page lists Sam Altman as CEO of OpenAI.",
      fixes_applied: ["Grounded the executive claim."]
    }
  });

  assert.equal(finalized.impact.refineChangedBecauseOfTool, true);
  assert.equal(finalized.impact.netImpact, "positive");
  assert.ok(finalized.impact.sourceBackedClaimsCount >= 1);
});

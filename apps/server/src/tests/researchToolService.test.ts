import test from "node:test";
import assert from "node:assert/strict";
import { ResearchToolService } from "../services/researchToolService.js";
import type { ResearchDecisionArgs } from "../services/research/common.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";

const baseRespondent = {
  modelRole: "respondent" as const,
  answer: "Placeholder answer.",
  key_points: ["Placeholder"],
  assumptions: [],
  confidence: 60
};

const baseRedTeam = {
  modelRole: "redteam" as const,
  attacks_on_a: [],
  attacks_on_b: [],
  shared_risks: [],
  failure_scenarios: [],
  hidden_assumptions: [],
  potentially_false_claims: [],
  factual_risk_level: 12,
  reasoning_risk_level: 12,
  winner_so_far: "tie" as const
};

function buildDecision(shouldUse = false) {
  return {
    shouldUse,
    reasons: [shouldUse ? "Policy requested research." : "Policy did not request research."],
    triggerSignals: shouldUse ? ["policy_signal"] : ["no_external_verification_signal"],
    targetClaims: [],
    expectedValue: shouldUse ? ("medium" as const) : ("low" as const),
    expectedCostMs: shouldUse ? 1800 : 0,
    knowledgeStrategy: null,
    plan: shouldUse
      ? {
          intent: "fact_check" as const,
          mode: "fact_check_only" as const,
          queries: ["placeholder query"],
          requiredTerms: [],
          preferredDomains: [],
          factFocusTerms: [],
          entityTerms: [],
          temporalProfile: buildDefaultTemporalProfile(),
          reasoning: "Policy fallback plan."
        }
      : null
  };
}

function buildArgs(question: string): ResearchDecisionArgs {
  return {
    question,
    category: "other",
    respondentA: baseRespondent,
    respondentB: baseRespondent,
    redTeam: baseRedTeam,
    shouldRefineA: true,
    shouldRefineB: false,
    orchestration: null,
    studentStrategy: null
  };
}

test("research tool service forces a direct tool path for live time questions", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    }
  });

  const log = await service.maybeCollect(buildArgs("What time is it in Paris right now?"));

  assert.equal(log.toolRouting.toolRequired, true);
  assert.equal(log.toolRouting.toolType, "time");
  assert.equal(log.toolRouting.intent, "current_time");
  assert.equal(log.route, "used");
  assert.equal(log.toolRouting.toolResultUsed, true);
  assert.ok(log.truth.verified_facts[0]?.toLowerCase().includes("current time"));
});

test("research tool service uses direct weather tool results instead of generic search", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    },
    localToolExecutionService: {
      tryExecute(routing) {
        assert.equal(routing.toolType, "weather");
        return {
          toolType: "weather",
          intent: "current_weather",
          summary: ["Outil meteo: Paris -> ciel degage, 21 deg C."],
          verifiedFacts: ["Meteo actuelle pour Paris: ciel degage, temperature 21 deg C."],
          confidenceScore: 0.96,
          resultLabel: "Paris: ciel degage, 21 deg C"
        };
      }
    }
  });

  const log = await service.maybeCollect(buildArgs("Quel temps fait-il aujourd'hui a Paris ?"));

  assert.equal(log.toolRouting.toolRequired, true);
  assert.equal(log.toolRouting.toolType, "weather");
  assert.equal(log.route, "used");
  assert.equal(log.toolRouting.toolResultUsed, true);
  assert.equal(log.truth.confidence_score, 0.96);
  assert.match(log.truth.verified_facts[0] ?? "", /21 deg C/);
});

test("research tool service uses direct finance tool results instead of generic search", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    },
    localToolExecutionService: {
      tryExecute(routing) {
        assert.equal(routing.toolType, "finance");
        return {
          toolType: "finance",
          intent: "current_price",
          summary: ["Outil finance: Bitcoin (BTC) -> 78,892 USD."],
          verifiedFacts: ["Prix actuel de Bitcoin (BTC): 78,892 USD selon CoinGecko."],
          confidenceScore: 0.96,
          resultLabel: "Bitcoin (BTC) 78,892 USD",
          sources: [
            {
              title: "CoinGecko Simple Price API",
              url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
              snippet: "Current Bitcoin price.",
              excerpt: "Prix actuel de Bitcoin (BTC): 78,892 USD selon CoinGecko.",
              publishedAt: null,
              modifiedAt: null,
              effectiveDate: "2026-05-04T14:00:00.000Z",
              dateSource: "time",
              retrievalChannel: "live",
              retrievalOrigin: "known_endpoint",
              retrievalEngine: "known_endpoint"
            }
          ]
        };
      }
    }
  });

  const log = await service.maybeCollect(buildArgs("Quel est le prix du BTC maintenant ?"));

  assert.equal(log.toolRouting.toolRequired, true);
  assert.equal(log.toolRouting.toolType, "finance");
  assert.equal(log.route, "used");
  assert.equal(log.toolRouting.toolResultUsed, true);
  assert.equal(log.truth.confidence_score, 0.96);
  assert.match(log.truth.verified_facts[0] ?? "", /78,892 USD/);
  assert.equal(log.sources[0]?.retrievalOrigin, "known_endpoint");
});

test("research tool service fails safely when a weather request has no location", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    },
    localToolExecutionService: {
      tryExecute() {
        return null;
      }
    }
  });

  const log = await service.maybeCollect(buildArgs("Quel temps fait-il aujourd'hui ?"));

  assert.equal(log.toolRouting.toolRequired, true);
  assert.equal(log.toolRouting.toolType, "weather");
  assert.equal(log.route, "failed");
  assert.equal(log.truth.no_reliable_source, false);
  assert.match(log.truth.uncertain_claims[0] ?? "", /ville/);
  assert.match(log.truth.uncertain_claims[0] ?? "", /Demande/);
});

test("research tool service asks for missing calculator details", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    },
    toolRoutingService: {
      route() {
        return {
          considered: true,
          toolRequired: true,
          toolRecommended: false,
          toolType: "calculator",
          intent: "arithmetic",
          confidence: 0.9,
          fallbackAllowed: false,
          reason: "Arithmetic should use a calculator.",
          extractedArgs: {},
          toolResultUsed: false
        };
      }
    },
    localToolExecutionService: {
      tryExecute() {
        return null;
      }
    }
  });

  const log = await service.maybeCollect(buildArgs("Calculate"));

  assert.equal(log.toolRouting.toolType, "calculator");
  assert.equal(log.route, "failed");
  assert.equal(log.truth.no_reliable_source, false);
  assert.match(log.truth.uncertain_claims[0] ?? "", /calculation|calcul/i);
});

test("research tool service does not force tools for stable explanations", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    }
  });

  const log = await service.maybeCollect(
    buildArgs("Explain eventual consistency with one practical example.")
  );

  assert.equal(log.toolRouting.toolRequired, false);
  assert.equal(log.toolRouting.toolType, "none");
  assert.equal(log.route, "not_needed");
});

test("research tool service keeps non-live documentation requests as tool-recommended only", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    }
  });

  const log = await service.maybeCollect(
    buildArgs("According to the official OAuth documentation, explain the authorization code flow.")
  );

  assert.equal(log.toolRouting.toolRequired, false);
  assert.equal(log.toolRouting.toolRecommended, true);
  assert.equal(log.toolRouting.intent, "documentation_lookup");
  assert.equal(log.route, "not_needed");
});

test("agent routing recommendation does not break the core fallback flow", async () => {
  const service = new ResearchToolService({
    decisionPolicyService: {
      async decide() {
        return buildDecision(false);
      }
    },
    agentRoutingService: {
      async route() {
        return {
          considered: true,
          agentFound: true,
          agentId: "agent::code_analysis",
          domain: "code_analysis",
          confidence: 0.88,
          reason: "CodeAnalysisAgent matches the repo-analysis domain.",
          requiredSkills: ["skill::repo", "skill::file"],
          fallbackToCore: true,
          recommendation: {
            type: "agent_routing_recommendation",
            agentId: "agent::code_analysis",
            domain: "code_analysis",
            confidence: 0.88,
            requiredSkills: ["skill::repo", "skill::file"],
            requiredTools: ["repo"],
            reason: "CodeAnalysisAgent matches the repo-analysis domain.",
            fallbackPlan: "core_generalist"
          }
        };
      }
    }
  });

  const log = await service.maybeCollect(
    buildArgs("Explain eventual consistency with one practical example.")
  );

  assert.equal(log.route, "not_needed");
  assert.equal(log.agentRouting.agentFound, true);
  assert.equal(log.agentRecommendation?.type, "agent_routing_recommendation");
  assert.equal(log.fallbackUsed, true);
});

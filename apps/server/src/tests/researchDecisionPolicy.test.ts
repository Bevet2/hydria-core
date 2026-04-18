import test from "node:test";
import assert from "node:assert/strict";
import { ResearchDecisionPolicyService } from "../services/research/decisionPolicy.js";
import type { ResearchDecisionArgs } from "../services/research/common.js";
import type { StudentResponseStrategy } from "../types/student.js";

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

const openShortStrategy: StudentResponseStrategy = {
  strategyId: "open_short",
  context: {
    questionType: "open",
    promptLength: "short",
    promptWordCount: 12,
    signals: []
  },
  impactStatus: "cautious",
  activationMode: "fallback",
  impactConfidence: 0.5,
  impactReason: "fallback",
  targetLengthWords: {
    min: 70,
    max: 110
  },
  directives: ["Be direct.", "Add one useful angle."],
  avoidances: ["Do not be thin."],
  influencedBy: {
    signals: [],
    studentRuleIds: [],
    memoryDomains: [],
    winningPatterns: []
  },
  reasoning: ["Fallback strategy.", "No empirical signal yet."]
};

function buildArgs(overrides: Partial<ResearchDecisionArgs> = {}): ResearchDecisionArgs {
  return {
    question: "Explain eventual consistency in distributed systems.",
    category: "technical_explanation",
    respondentA: baseRespondent,
    respondentB: baseRespondent,
    redTeam: baseRedTeam,
    shouldRefineA: true,
    shouldRefineB: true,
    orchestration: null,
    studentStrategy: openShortStrategy,
    ...overrides
  };
}

test("decision policy always triggers research for temporal freshness queries", async () => {
  const policy = new ResearchDecisionPolicyService({
    loadKnowledgeInsight: async () => null,
    getRelevantMemoryRules: async () => []
  });

  const decision = await policy.decide(
    buildArgs({
      question: "Who is the current CEO of OpenAI?",
      category: "mixed_reasoning",
      studentStrategy: {
        ...openShortStrategy,
        strategyId: "factual_verify_first",
        context: {
          questionType: "factual",
          promptLength: "short",
          promptWordCount: 7,
          signals: ["claims"]
        }
      }
    })
  );

  assert.equal(decision.shouldUse, true);
  assert.equal(decision.plan?.intent, "current_status");
  assert.ok(decision.triggerSignals.includes("temporal_query_current_status"));
  assert.equal(decision.expectedValue, "high");
  assert.ok(
    decision.targetClaims.some((claim) => /current status target:\s*who is the current ceo of openai/i.test(claim))
  );
});

test("decision policy keeps research off for open-like writing tasks without external verification pressure", async () => {
  const policy = new ResearchDecisionPolicyService({
    loadKnowledgeInsight: async () => null,
    getRelevantMemoryRules: async () => []
  });

  const decision = await policy.decide(
    buildArgs({
      question: "Write a short internal note explaining why the team should improve code reviews.",
      category: "operational_writing",
      studentStrategy: openShortStrategy,
      redTeam: {
        ...baseRedTeam,
        factual_risk_level: 20,
        reasoning_risk_level: 25
      }
    })
  );

  assert.equal(decision.shouldUse, false);
  assert.equal(decision.plan, null);
  assert.deepEqual(decision.triggerSignals, ["no_external_verification_signal"]);
});

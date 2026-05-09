import test from "node:test";
import assert from "node:assert/strict";
import { OrchestrationPolicyService } from "../services/orchestrationPolicy.js";
import { orchestrationPolicySchema, type RedTeamOutput, type RespondentOutput } from "../types/arena.js";

function buildRespondent(answer: string): RespondentOutput {
  return {
    modelRole: "respondent",
    answer,
    key_points: ["One key point"],
    assumptions: [],
    confidence: 70
  };
}

test("orchestration policy emits integer bias values for product strategy", async () => {
  const redTeam: RedTeamOutput = {
    modelRole: "redteam",
    attacks_on_a: ["Missing metrics."],
    attacks_on_b: [],
    shared_risks: ["Plan may stay too generic."],
    failure_scenarios: [],
    hidden_assumptions: [],
    potentially_false_claims: [],
    factual_risk_level: 45,
    reasoning_risk_level: 55,
    winner_so_far: "tie"
  };

  const policy = await new OrchestrationPolicyService().planRound({
    question: "Create a product strategy for launching an AI assistant.",
    category: "product_strategy",
    respondentA: buildRespondent("Launch broadly with success metrics and pilots."),
    respondentB: buildRespondent("Start with a pilot and measure adoption."),
    redTeam
  });

  orchestrationPolicySchema.parse(policy);
  assert.equal(Number.isInteger(policy.refineBias), true);
  assert.equal(Number.isInteger(policy.researchBias), true);
});

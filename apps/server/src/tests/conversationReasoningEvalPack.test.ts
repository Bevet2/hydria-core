import test from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_REASONING_EVAL_PACK,
  CONVERSATION_REASONING_GATE_ID
} from "../data/conversationReasoningEvalPack.js";
import {
  CONVERSATION_REASONING_GATE_V2_EVAL_PACK,
  CONVERSATION_REASONING_GATE_V2_ID
} from "../data/conversationReasoningGateV2EvalPack.js";
import {
  CONVERSATION_REASONING_GATE_V3_EVAL_PACK,
  CONVERSATION_REASONING_GATE_V3_ID
} from "../data/conversationReasoningGateV3EvalPack.js";

test("conversation reasoning eval pack contains a balanced 100-150 case multi-turn gate", () => {
  assert.equal(CONVERSATION_REASONING_GATE_ID, "hydria-conversation-reasoning-gate-v1");
  assert.ok(CONVERSATION_REASONING_EVAL_PACK.length >= 100);
  assert.ok(CONVERSATION_REASONING_EVAL_PACK.length <= 150);

  const ids = new Set(CONVERSATION_REASONING_EVAL_PACK.map((item) => item.id));
  assert.equal(ids.size, CONVERSATION_REASONING_EVAL_PACK.length);

  const domains = new Set(CONVERSATION_REASONING_EVAL_PACK.map((item) => item.domain));
  assert.deepEqual(
    [...domains].sort(),
    [
      "architecture_design",
      "debug_diagnostic",
      "incident_response",
      "mixed_reasoning",
      "product_strategy"
    ]
  );

  const languages = new Set(CONVERSATION_REASONING_EVAL_PACK.map((item) => item.language));
  assert.deepEqual([...languages].sort(), ["en", "fr"]);

  for (const item of CONVERSATION_REASONING_EVAL_PACK) {
    assert.equal(item.conversation.length, 5);
    assert.match(item.conversation[0] ?? "", /^user:/);
    assert.match(item.conversation[1] ?? "", /^assistant:/);
    assert.match(item.conversation[2] ?? "", /^user:/);
    assert.match(item.conversation[3] ?? "", /^assistant:/);
    assert.match(item.conversation[4] ?? "", /^user:/);
    assert.ok(item.expectedBehaviors.length >= 5);
    assert.ok(item.keyChallenges.length >= 4);
    assert.equal(typeof item.shouldAdaptContext, "boolean");
    assert.equal(typeof item.shouldReviseAssumptions, "boolean");
    assert.equal(typeof item.shouldAskClarification, "boolean");
  }
});

test("conversation reasoning eval pack covers required scenario families", () => {
  const allChallenges = CONVERSATION_REASONING_EVAL_PACK
    .flatMap((item) => item.keyChallenges)
    .join("\n");

  assert.match(allChallenges, /changed constraint/);
  assert.match(allChallenges, /contradictory user information/);
  assert.match(allChallenges, /progressively clarified ambiguity/);
  assert.match(allChallenges, /complex decision with tradeoffs/);
  assert.match(allChallenges, /evolving incident urgency/);
  assert.match(allChallenges, /budget limit/);
  assert.match(allChallenges, /scale increase/);
  assert.match(allChallenges, /environment change/);
});

test("conversation reasoning gate v2 contains harder long adversarial multi-turn cases", () => {
  assert.equal(CONVERSATION_REASONING_GATE_V2_ID, "hydria-conversation-reasoning-gate-v2");
  assert.equal(CONVERSATION_REASONING_GATE_V2_EVAL_PACK.length, 40);

  const ids = new Set(CONVERSATION_REASONING_GATE_V2_EVAL_PACK.map((item) => item.id));
  assert.equal(ids.size, CONVERSATION_REASONING_GATE_V2_EVAL_PACK.length);

  const domains = new Set(CONVERSATION_REASONING_GATE_V2_EVAL_PACK.map((item) => item.domain));
  assert.deepEqual(
    [...domains].sort(),
    [
      "architecture_design",
      "debug_diagnostic",
      "incident_response",
      "mixed_reasoning",
      "product_strategy"
    ]
  );

  const languages = new Set(CONVERSATION_REASONING_GATE_V2_EVAL_PACK.map((item) => item.language));
  assert.deepEqual([...languages].sort(), ["en", "fr"]);

  for (const item of CONVERSATION_REASONING_GATE_V2_EVAL_PACK) {
    const userTurns = item.conversation.filter((line) => /^user:/i.test(line));
    const assistantTurns = item.conversation.filter((line) => /^assistant:/i.test(line));

    assert.equal(item.difficulty, "adversarial");
    assert.equal(userTurns.length, 7);
    assert.equal(assistantTurns.length, 6);
    assert.ok(item.conversation.length >= 13);
    assert.ok(item.expectedBehaviors.length >= 8);
    assert.ok(item.keyChallenges.includes("gate v2"));
    assert.ok(item.keyChallenges.includes("adversarial conversational pressure"));
    assert.ok(item.keyChallenges.includes("six to eight turn strategy retention"));
    assert.ok(item.keyChallenges.includes("conflicting constraints"));
    assert.equal(item.shouldAdaptContext, true);
    assert.equal(item.shouldReviseAssumptions, true);
  }
});

test("conversation reasoning gate v2 covers the required hard scenario families", () => {
  const allChallenges = CONVERSATION_REASONING_GATE_V2_EVAL_PACK
    .flatMap((item) => item.keyChallenges)
    .join("\n");
  const allTurns = CONVERSATION_REASONING_GATE_V2_EVAL_PACK
    .flatMap((item) => item.conversation)
    .join("\n");

  assert.match(allChallenges, /adversarial_context_injection/);
  assert.match(allChallenges, /cascading_constraint_conflict/);
  assert.match(allChallenges, /long_strategy_continuity/);
  assert.match(allChallenges, /conflicting_stakeholders/);
  assert.match(allTurns, /Ignore everything above|Ignore tout ce qui precede/);
  assert.match(allTurns, /contradiction|contradiction|conflict|conflit/i);
  assert.match(allTurns, /Turn 7|Tour 7/);
  assert.match(allTurns, /stakeholders|parties|CEO|legal|juridique/i);
});

test("conversation reasoning gate v3 hidden contains unseen long generalization cases", () => {
  assert.equal(CONVERSATION_REASONING_GATE_V3_ID, "hydria-conversation-reasoning-gate-v3-hidden");
  assert.equal(CONVERSATION_REASONING_GATE_V3_EVAL_PACK.length, 60);

  const ids = new Set(CONVERSATION_REASONING_GATE_V3_EVAL_PACK.map((item) => item.id));
  assert.equal(ids.size, CONVERSATION_REASONING_GATE_V3_EVAL_PACK.length);

  const domains = new Set(CONVERSATION_REASONING_GATE_V3_EVAL_PACK.map((item) => item.domain));
  assert.deepEqual(
    [...domains].sort(),
    [
      "architecture_design",
      "debug_diagnostic",
      "incident_response",
      "mixed_reasoning",
      "product_strategy"
    ]
  );

  const languages = new Set(CONVERSATION_REASONING_GATE_V3_EVAL_PACK.map((item) => item.language));
  assert.deepEqual([...languages].sort(), ["en", "fr"]);

  for (const item of CONVERSATION_REASONING_GATE_V3_EVAL_PACK) {
    const userTurns = item.conversation.filter((line) => /^user:/i.test(line));
    const assistantTurns = item.conversation.filter((line) => /^assistant:/i.test(line));

    assert.equal(item.difficulty, "adversarial");
    assert.equal(userTurns.length, 7);
    assert.equal(assistantTurns.length, 6);
    assert.ok(item.conversation.length >= 13);
    assert.ok(item.expectedBehaviors.length >= 9);
    assert.ok(item.keyChallenges.includes("gate v3 hidden"));
    assert.ok(item.keyChallenges.includes("unseen generalization"));
    assert.ok(item.keyChallenges.includes("context recall budget"));
    assert.ok(item.keyChallenges.includes("tool/research boundary"));
    assert.ok(item.keyChallenges.includes("long strategic memory"));
    assert.ok(item.keyChallenges.includes("adversarial context injection"));
    assert.ok(item.keyChallenges.includes("non templated answer"));
    assert.equal(item.shouldAdaptContext, true);
    assert.equal(item.shouldReviseAssumptions, true);
    assert.equal(item.shouldAskClarification, false);
  }
});

test("conversation reasoning gate v3 hidden covers the new adversarial scenario families", () => {
  const allChallenges = CONVERSATION_REASONING_GATE_V3_EVAL_PACK
    .flatMap((item) => item.keyChallenges)
    .join("\n");
  const allExpectedBehaviors = CONVERSATION_REASONING_GATE_V3_EVAL_PACK
    .flatMap((item) => item.expectedBehaviors)
    .join("\n");
  const allTurns = CONVERSATION_REASONING_GATE_V3_EVAL_PACK
    .flatMap((item) => item.conversation)
    .join("\n");

  assert.match(allChallenges, /strategy_memory_under_interruptions/);
  assert.match(allChallenges, /tool_boundary_snapshot/);
  assert.match(allChallenges, /conflicting_metrics_reversal/);
  assert.match(allChallenges, /role_handoff_policy_conflict/);
  assert.match(allChallenges, /silent_assumption_trap/);
  assert.match(allChallenges, /deadline_escalation_ladder/);
  assert.match(allExpectedBehaviors, /scenario cache|hidden scenario/);
  assert.match(allTurns, /snapshot fourni|provided snapshot/i);
  assert.match(allTurns, /pas un acces live|not live access/i);
  assert.match(allTurns, /hypothese silencieuse|silent assumption/i);
  assert.match(allTurns, /handoff|reprends le dossier|taking over/i);
  assert.match(allTurns, /deadline|Escalade|Escalation/i);
  assert.match(allTurns, /Ignore le cap initial|Ignore the initial direction/i);
});

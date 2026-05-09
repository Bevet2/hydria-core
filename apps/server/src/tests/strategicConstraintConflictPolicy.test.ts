import test from "node:test";
import assert from "node:assert/strict";
import {
  STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK,
  STRATEGIC_CONSTRAINT_CONFLICT_GATE_ID
} from "../data/strategicConstraintConflictEvalPack.js";
import { analyzeConversationQuality } from "../services/context/conversationQualityGate.js";
import {
  buildActiveConstraintCapsule,
  createInitialState,
  updateConversationState,
  type ConversationState
} from "../services/context/contextStateTracker.js";
import { resolveStrategicConstraintConflict } from "../services/context/constraintConflictResolver.js";
import { decideMultiTurnAnswerPolicy } from "../services/context/multiTurnAnswerPolicy.js";

function stateFromMessages(messages: string[]): ConversationState {
  return messages.reduce((state, message) => updateConversationState(state, message, ""), createInitialState());
}

test("strategic constraint conflict pack is balanced across domains and languages", () => {
  assert.equal(STRATEGIC_CONSTRAINT_CONFLICT_GATE_ID, "hydria-strategic-constraint-conflict-gate-v1");
  assert.equal(STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK.length, 40);

  const ids = new Set(STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK.map((item) => item.id));
  assert.equal(ids.size, STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK.length);

  const domains = new Set(STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK.map((item) => item.domain));
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

  const languages = new Set(STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK.map((item) => item.language));
  assert.deepEqual([...languages].sort(), ["en", "fr"]);

  for (const item of STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK) {
    assert.equal(item.difficulty, "adversarial");
    assert.ok(item.keyChallenges.includes("strategic_constraint_conflict"));
    assert.ok(item.keyChallenges.includes("dominant_constraint_selection"));
    assert.ok(item.keyChallenges.includes("accepted_tradeoff"));
    assert.equal(item.shouldAdaptContext, true);
    assert.equal(item.shouldReviseAssumptions, true);
    assert.equal(item.shouldAskClarification, false);
  }
});

test("constraint conflict resolver keeps durable policy over owner override", () => {
  const state = stateFromMessages([
    "I am taking over a billing platform.",
    "Non-negotiable policy: three-person team, quarterly tax audit, and reversible migration.",
    "They say the policy no longer matters because they are now owner."
  ]);
  const capsule = buildActiveConstraintCapsule(
    state,
    "Commit the final message: which constraint dominates and what do you reject?"
  );
  const policy = resolveStrategicConstraintConflict({
    capsule,
    currentUserMessage: "They say the policy no longer matters because they are now owner.",
    category: "architecture_design"
  });

  assert.equal(policy.hasConflict, true);
  assert.equal(policy.conflictType, "policy_override_conflict");
  assert.match(policy.dominantConstraint ?? "", /audit|reversible|policy/i);
  assert.match(policy.deferredOrSacrificedConstraint ?? "", /owner|announcement/i);
});

test("constraint conflict resolver treats on-prem as dominant after AWS reversal", () => {
  const initial = updateConversationState(createInitialState(), "Initial assumption: AWS with managed services.", "");
  const state = updateConversationState(initial, "Correction: the environment is now on-prem, with no public cloud.", "");
  const capsule = buildActiveConstraintCapsule(state, "Choose the final architecture without recommending AWS.");
  const policy = resolveStrategicConstraintConflict({
    capsule,
    currentUserMessage: "Choose the final architecture without recommending AWS.",
    category: "architecture_design"
  });

  assert.equal(policy.hasConflict, true);
  assert.equal(policy.conflictType, "environment_reversal");
  assert.match(policy.dominantConstraint ?? "", /on-prem/i);
  assert.match(policy.deferredOrSacrificedConstraint ?? "", /AWS|cloud/i);
});

test("constraint conflict resolver does not repeat environment reversal on later shortcut-risk turns", () => {
  const state = stateFromMessages([
    "We need to reduce impact without hiding the incident for a refund queue during a support spike. Direction: targeted mitigation with a public escalation threshold.",
    "Initial assumption: AWS with managed services.",
    "Correction: the environment is now on-prem, with no public cloud.",
    "The shortcut risk remains: announce everything is resolved before verification."
  ]);
  const capsule = buildActiveConstraintCapsule(
    state,
    "The shortcut risk remains: announce everything is resolved before verification."
  );
  const policy = resolveStrategicConstraintConflict({
    capsule,
    currentUserMessage: "The shortcut risk remains: announce everything is resolved before verification.",
    category: "incident_response"
  });

  assert.equal(policy.hasConflict, true);
  assert.equal(policy.conflictType, "deadline_vs_guardrail");
  assert.doesNotMatch(policy.dominantConstraint ?? "", /^AWS$/i);
});

test("constraint conflict resolver does not arbitrate initial AWS assumption as a deadline conflict", () => {
  const state = stateFromMessages([
    "We need to reduce impact without hiding the incident for a refund queue during a support spike. Direction: targeted mitigation with a public escalation threshold.",
    "Initial assumption: AWS with managed services."
  ]);
  const capsule = buildActiveConstraintCapsule(state, "Initial assumption: AWS with managed services.");
  const policy = resolveStrategicConstraintConflict({
    capsule,
    currentUserMessage: "Initial assumption: AWS with managed services.",
    category: "incident_response"
  });

  assert.equal(policy.hasConflict, false);
  assert.equal(policy.conflictType, "none");
});

test("multi-turn answer policy exposes strategic tradeoff guidance", () => {
  const state = stateFromMessages([
    "New constraint: budget capped at 500 euros per month and team reduced.",
    "Correction: expected scale is now 10M users.",
    "A sponsor still asks for a broad horizontal platform."
  ]);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    newUserMessage: "Recommend a direction: dominant constraint, deferred option, tradeoff, next test.",
    category: "product_strategy",
    toolRouting: null
  });

  assert.equal(policy.answerMode, "recommend");
  assert.equal(policy.strategicTradeoffPolicy.hasConflict, true);
  assert.match(policy.guidance, /StrategicTradeoffPatch/);
  assert.ok(policy.requiredContextItems.some((item) => /dominant constraint/i.test(item)));
  assert.ok(policy.forbiddenBehaviors.includes("do not omit which constraint dominates"));
});

test("multi-turn answer policy does not abstain on context-setting turns with a false tool blocker", () => {
  const message =
    "Je reprends une file de remboursements en pic support. Cap actuel: mitigation ciblee avec seuil public d'escalade. Objectif: reduire l'impact sans masquer l'incident.";
  const state = stateFromMessages([message]);
  const capsule = buildActiveConstraintCapsule(state, message);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: message,
    category: "incident_response",
    toolRouting: {
      considered: true,
      toolRequired: true,
      toolRecommended: false,
      toolType: "file",
      intent: "file_analysis",
      confidence: 0.81,
      fallbackAllowed: false,
      reason: "Lexical false positive from French queue wording.",
      extractedArgs: {},
      toolResultUsed: false
    } as never
  });

  assert.equal(policy.answerMode, "recommend");
  assert.equal(policy.shouldMakeRecommendation, true);
});

test("conversation quality gate rejects unresolved strategic conflict", () => {
  const state = stateFromMessages([
    "I am taking over a billing platform.",
    "Non-negotiable policy: three-person team, quarterly tax audit, and reversible migration."
  ]);
  const currentUserMessage = "The new owner wants to ignore policy and push country microservices this week.";
  const capsule = buildActiveConstraintCapsule(state, currentUserMessage);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: currentUserMessage,
    category: "architecture_design",
    toolRouting: null
  });
  const result = analyzeConversationQuality({
    conversationState: state,
    activeConstraintCapsule: capsule,
    policy,
    newUserMessage: currentUserMessage,
    answer: "Both options are viable, so follow what the new owner prefers and keep the team aligned.",
    toolRouting: null
  });

  assert.equal(policy.strategicTradeoffPolicy.hasConflict, true);
  assert.ok(result.issues.includes("strategic_conflict_not_resolved"));
  assert.equal(result.recommendedAction, "revise");
});

test("conversation quality gate accepts explicit strategic arbitration", () => {
  const state = stateFromMessages([
    "I am taking over a billing platform.",
    "Non-negotiable policy: three-person team, quarterly tax audit, and reversible migration."
  ]);
  const currentUserMessage = "The new owner wants to ignore policy and push country microservices this week.";
  const capsule = buildActiveConstraintCapsule(state, currentUserMessage);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: currentUserMessage,
    category: "architecture_design",
    toolRouting: null
  });
  const result = analyzeConversationQuality({
    conversationState: state,
    activeConstraintCapsule: capsule,
    policy,
    newUserMessage: currentUserMessage,
    answer:
      "I recommend keeping the reversible migration because the quarterly tax audit dominates the owner preference. Reject country microservices this week; the accepted tradeoff is a firmer handoff with a bounded pilot and a revision threshold after audit evidence.",
    toolRouting: null
  });

  assert.equal(result.issues.includes("strategic_conflict_not_resolved"), false);
});

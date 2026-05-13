import test from "node:test";
import assert from "node:assert/strict";
import {
  STRATEGIC_CONSTRAINT_CONFLICT_EVAL_PACK,
  STRATEGIC_CONSTRAINT_CONFLICT_GATE_ID
} from "../data/strategicConstraintConflictEvalPack.js";
import {
  STRATEGIC_COHERENCE_FINE_EVAL_PACK,
  STRATEGIC_COHERENCE_FINE_GATE_ID
} from "../data/strategicCoherenceFineEvalPack.js";
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

test("strategic coherence fine pack targets revision conditions and false equivalence", () => {
  assert.equal(STRATEGIC_COHERENCE_FINE_GATE_ID, "hydria-strategic-coherence-fine-gate-v1");
  assert.equal(STRATEGIC_COHERENCE_FINE_EVAL_PACK.length, 20);

  const ids = new Set(STRATEGIC_COHERENCE_FINE_EVAL_PACK.map((item) => item.id));
  assert.equal(ids.size, STRATEGIC_COHERENCE_FINE_EVAL_PACK.length);

  const languages = new Set(STRATEGIC_COHERENCE_FINE_EVAL_PACK.map((item) => item.language));
  assert.deepEqual([...languages].sort(), ["en", "fr"]);

  for (const item of STRATEGIC_COHERENCE_FINE_EVAL_PACK) {
    assert.equal(item.difficulty, "adversarial");
    assert.ok(item.keyChallenges.includes("fine_strategic_coherence"));
    assert.ok(item.keyChallenges.includes("revision_condition_required"));
    assert.ok(item.keyChallenges.includes("false_equivalence_rejection"));
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
  assert.ok(policy.requiredContextItems.some((item) => /revision condition/i.test(item)));
  assert.ok(policy.forbiddenBehaviors.includes("do not omit which constraint dominates"));
  assert.ok(
    policy.forbiddenBehaviors.includes(
      "do not make a strategic choice sound permanent; include the revision condition"
    )
  );
  assert.equal(policy.strategicCoherencePolicy.requiresRevisionCondition, true);
  assert.match(policy.strategicCoherencePolicy.revisionTrigger ?? "", /signal|budget|funded|load|capacity|team/i);
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

test("conversation quality gate rejects recommendation that contradicts active environment constraint", () => {
  const state = stateFromMessages([
    "Bonjour, on doit choisir entre AWS et on-prem.",
    "Finalement contrainte on-prem stricte."
  ]);
  const currentUserMessage = "Tu recommandes quoi ?";
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
      "Je recommande AWS. Cette decision est basee sur la contrainte environment: on-prem, mais le cloud reste preferable.",
    toolRouting: null
  });

  assert.ok(result.issues.includes("active_constraint_contradicted"));
  assert.equal(result.recommendedAction, "revise");
});

test("conversation quality gate rejects current user message echo", () => {
  const state = stateFromMessages([
    "Bonjour, on doit choisir entre AWS et on-prem.",
    "Finalement contrainte on-prem stricte."
  ]);
  const currentUserMessage = "Tu recommandes quoi ?";
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
    answer: currentUserMessage,
    toolRouting: null
  });

  assert.ok(result.issues.includes("current_user_message_echo"));
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

test("conversation quality gate accepts dominant constraint use with a bounded revision condition", () => {
  const state = stateFromMessages([
    "Bonjour, on doit choisir entre AWS et on-prem.",
    "Finalement contrainte on-prem stricte."
  ]);
  const currentUserMessage = "Architecture finale: on-prem obligatoire. Tu recommandes quoi ?";
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
      "Je recommande une architecture on-prem minimale parce que l'obligation on-prem impose d'ecarter AWS maintenant. Je reconsidererais seulement si cette contrainte est levee explicitement.",
    toolRouting: null
  });

  assert.equal(result.issues.includes("strategic_conflict_not_resolved"), false);
});

test("conversation quality gate rejects strategic arbitration without revision condition", () => {
  const state = stateFromMessages([
    "New constraint: budget capped at 500 euros per month and team reduced.",
    "Correction: expected scale is now 10M users.",
    "A sponsor still asks for a broad horizontal platform."
  ]);
  const currentUserMessage = "Recommend a direction: dominant constraint, deferred option, tradeoff, next test.";
  const capsule = buildActiveConstraintCapsule(state, currentUserMessage);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: currentUserMessage,
    category: "product_strategy",
    toolRouting: null
  });
  const result = analyzeConversationQuality({
    conversationState: state,
    activeConstraintCapsule: capsule,
    policy,
    newUserMessage: currentUserMessage,
    answer:
      "I recommend the frugal slice because budget capped at 500 euros dominates the broad platform request. Reject broad horizontal expansion; the accepted tradeoff is proving value with the current team before widening scope.",
    toolRouting: null
  });

  assert.equal(policy.strategicCoherencePolicy.requiresRevisionCondition, true);
  assert.ok(result.issues.includes("missing_strategic_revision_condition"));
  assert.equal(result.recommendedAction, "revise");
});

test("conversation quality gate rejects over-rigid strategic answer", () => {
  const state = stateFromMessages([
    "New constraint: budget capped at 500 euros per month and team reduced.",
    "Correction: expected scale is now 10M users.",
    "A sponsor still asks for a broad horizontal platform."
  ]);
  const currentUserMessage = "Recommend a direction: dominant constraint, deferred option, tradeoff, next test.";
  const capsule = buildActiveConstraintCapsule(state, currentUserMessage);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: currentUserMessage,
    category: "product_strategy",
    toolRouting: null
  });
  const result = analyzeConversationQuality({
    conversationState: state,
    activeConstraintCapsule: capsule,
    policy,
    newUserMessage: currentUserMessage,
    answer:
      "I will never change this direction: budget capped at 500 euros dominates, so reject the broad horizontal platform. The accepted tradeoff is a smaller reversible slice with the reduced team.",
    toolRouting: null
  });

  assert.ok(result.issues.includes("over_rigid_strategic_answer"));
});

test("conversation quality gate accepts firm default with revision condition", () => {
  const state = stateFromMessages([
    "New constraint: budget capped at 500 euros per month and team reduced.",
    "Correction: expected scale is now 10M users.",
    "A sponsor still asks for a broad horizontal platform."
  ]);
  const currentUserMessage = "Recommend a direction: dominant constraint, deferred option, tradeoff, next test.";
  const capsule = buildActiveConstraintCapsule(state, currentUserMessage);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: currentUserMessage,
    category: "product_strategy",
    toolRouting: null
  });
  const result = analyzeConversationQuality({
    conversationState: state,
    activeConstraintCapsule: capsule,
    policy,
    newUserMessage: currentUserMessage,
    answer:
      "I recommend the frugal slice because budget capped at 500 euros dominates the broad horizontal platform request. Defer platform expansion; the accepted tradeoff is proving value with the reduced team. Revise only if the signal proves value and recurring budget is funded.",
    toolRouting: null
  });

  assert.equal(result.issues.includes("missing_strategic_revision_condition"), false);
  assert.equal(result.issues.includes("over_rigid_strategic_answer"), false);
});

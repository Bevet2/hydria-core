import test from "node:test";
import assert from "node:assert/strict";
import { StudentChatAdapter } from "../services/studentChatAdapter.js";
import {
  buildActiveConstraintCapsule,
  createInitialState
} from "../services/context/contextStateTracker.js";
import { decideMultiTurnAnswerPolicy } from "../services/context/multiTurnAnswerPolicy.js";

test("student chat adapter normalizes cloud fallback student role variations", async () => {
  const state = createInitialState();
  const capsule = buildActiveConstraintCapsule(state, "qui est charlemagne");
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: "qui est charlemagne",
    category: "other",
    toolRouting: null,
    lastAssistantAnswer: ""
  });
  const adapter = new StudentChatAdapter(
    {
      getConfiguredModelName() {
        return "phi3:mini";
      },
      async testPrompt() {
        throw new Error("local timeout");
      }
    },
    {
      async complete() {
        return {
          content: JSON.stringify({
            modelRole: "assistant",
            answer: "Charlemagne est un roi des Francs et empereur carolingien.",
            key_points: ["Roi des Francs", "Empereur carolingien"],
            assumptions: [],
            confidence: "not-a-number"
          }),
          latencyMs: 12
        };
      }
    }
  );

  const result = await adapter.answer({
    question: "User message to answer:\nqui est charlemagne",
    routingQuestion: "qui est charlemagne",
    userMessage: "qui est charlemagne",
    runtimeMode: "direct",
    category: "other",
    recentMessages: [],
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    requiresExternalGrounding: true
  });

  assert.equal(result.provider, "openrouter");
  assert.equal(result.answer.modelRole, "student");
  assert.equal(result.answer.confidence, 70);
  assert.match(result.answer.answer, /Charlemagne/);
});

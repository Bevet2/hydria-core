import test from "node:test";
import assert from "node:assert/strict";
import { StudentChatAdapter, type StudentChatAdapterInput } from "../services/studentChatAdapter.js";
import {
  buildActiveConstraintCapsule,
  createInitialState
} from "../services/context/contextStateTracker.js";
import { decideMultiTurnAnswerPolicy } from "../services/context/multiTurnAnswerPolicy.js";

function buildInput(): StudentChatAdapterInput {
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
  return {
    question: "User message to answer:\nqui est charlemagne",
    routingQuestion: "qui est charlemagne",
    userMessage: "qui est charlemagne",
    runtimeMode: "direct",
    category: "other",
    recentMessages: [],
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    requiresExternalGrounding: true
  };
}

test("student chat adapter normalizes local student role variations and uses the chat timeout", async () => {
  let timeoutMs = 0;
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt(_prompt, _system, options) {
      timeoutMs = options?.timeoutMs ?? 0;
      return {
        provider: "ollama",
        model: "phi3:mini",
        response: JSON.stringify({
          modelRole: "assistant",
          answer: "Charlemagne est un roi des Francs et empereur carolingien.",
          key_points: ["Roi des Francs", "Empereur carolingien"],
          assumptions: [],
          confidence: 0.95
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(buildInput());

  assert.equal(result.provider, "ollama");
  assert.equal(result.answer.modelRole, "student");
  assert.equal(result.answer.confidence, 95);
  assert.equal(timeoutMs > 1000, true);
  assert.match(result.answer.answer, /Charlemagne/);
});

test("student chat adapter does not call cloud fallback when local generation fails", async () => {
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt() {
      throw new Error("local timeout");
    }
  });

  const result = await adapter.answer(buildInput());

  assert.equal(result.provider, "fallback");
  assert.equal(result.model, "phi3:mini");
  assert.equal(result.validationIssues.includes("student_chat_generation_failed"), true);
});

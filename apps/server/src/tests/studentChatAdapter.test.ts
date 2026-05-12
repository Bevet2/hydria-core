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
  let selectedModel = "";
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt(_prompt, _system, options) {
      timeoutMs = options?.timeoutMs ?? 0;
      selectedModel = options?.modelName ?? "";
      return {
        provider: "ollama",
        model: selectedModel || "phi3:mini",
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
  assert.equal(result.model, "mistral:7b");
  assert.equal(result.specialist.role, "writing_business");
  assert.equal(result.answer.modelRole, "student");
  assert.equal(result.answer.confidence, 95);
  assert.equal(timeoutMs > 1000, true);
  assert.equal(selectedModel, "mistral:7b");
  assert.match(result.answer.answer, /Charlemagne/);
});

test("student chat adapter routes code questions to the local code specialist", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "debug_diagnostic" as const,
    routingQuestion: "Debug this TypeScript API error",
    userMessage: "Debug this TypeScript API error",
    question: "Debug this TypeScript API error"
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      return {
        provider: "ollama",
        model: selectedModel,
        response: JSON.stringify({
          modelRole: "student",
          answer: "Start by reproducing the TypeScript API error and checking the failing stack trace.",
          key_points: ["Code diagnostic"],
          assumptions: [],
          confidence: 85
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5-coder:7b");
  assert.equal(result.specialist.role, "code_specialist");
  assert.equal(result.specialist.pipeline.some((step) => step.includes("qwen2.5-coder:7b")), true);
});

test("student chat adapter routes strategic decisions to the local deep reasoner", async () => {
  let selectedModel = "";
  const state = createInitialState();
  const capsule = {
    ...buildActiveConstraintCapsule(state, "On-prem strict, deadline demain. Tu recommandes quoi ?"),
    decisionNeeded: true
  };
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: "On-prem strict, deadline demain. Tu recommandes quoi ?",
    category: "architecture_design",
    toolRouting: null,
    lastAssistantAnswer: ""
  });
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      return {
        provider: "ollama",
        model: selectedModel,
        response: JSON.stringify({
          modelRole: "student",
          answer: "Je recommande une option on-prem minimale, car la contrainte bloque AWS et le delai impose un scope reduit.",
          key_points: ["Decision contextualisee"],
          assumptions: [],
          confidence: 84
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer({
    question: "On-prem strict, deadline demain. Tu recommandes quoi ?",
    routingQuestion: "On-prem strict, deadline demain. Tu recommandes quoi ?",
    userMessage: "On-prem strict, deadline demain. Tu recommandes quoi ?",
    runtimeMode: "conversation",
    category: "architecture_design",
    recentMessages: [],
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    requiresExternalGrounding: false
  });

  assert.equal(selectedModel, "deepseek-r1:14b");
  assert.equal(result.specialist.role, "deep_reasoner");
  assert.equal(result.specialist.pipeline.some((step) => step.includes("deepseek-r1:14b")), true);
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
  assert.equal(result.model, "mistral:7b");
  assert.equal(result.specialist.role, "writing_business");
  assert.equal(result.validationIssues.includes("student_chat_generation_failed"), true);
});

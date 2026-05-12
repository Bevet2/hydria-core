import test from "node:test";
import assert from "node:assert/strict";
import { StudentChatAdapter, type StudentChatAdapterInput } from "../services/studentChatAdapter.js";
import {
  buildActiveConstraintCapsule,
  createInitialState
} from "../services/context/contextStateTracker.js";
import { decideMultiTurnAnswerPolicy } from "../services/context/multiTurnAnswerPolicy.js";
import { defaultChatToolMetadata } from "../types/chat.js";

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
    requiresExternalGrounding: true,
    tooling: defaultChatToolMetadata
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
  assert.equal(result.model, "qwen2.5:14b");
  assert.equal(result.specialist.role, "primary_brain");
  assert.equal(result.answer.modelRole, "student");
  assert.equal(result.answer.confidence, 95);
  assert.equal(timeoutMs > 1000, true);
  assert.equal(selectedModel, "qwen2.5:14b");
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

test("student chat adapter routes concise direct answers to the writing specialist", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "other" as const,
    routingQuestion: "Quel est le role de Hydria Core ?",
    userMessage: "Reponds en une phrase courte : quel est le role de Hydria Core ?",
    question: "Reponds en une phrase courte : quel est le role de Hydria Core ?",
    runtimeMode: "direct" as const,
    requiresExternalGrounding: false
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
          answer: "Hydria Core orchestre le raisonnement, les outils et les modeles locaux.",
          key_points: ["Routage general"],
          assumptions: [],
          confidence: 88
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "mistral:7b");
  assert.equal(result.specialist.role, "writing_business");
  assert.match(result.specialist.routingReason, /short-answer constraint/i);
  assert.equal(result.runtimeBudget?.profile, "writing_chat");
});

test("student chat adapter uses fast budget for verified calculator tool answers", async () => {
  let selectedModel = "";
  let timeoutMs = 0;
  let numPredict = 0;
  const input = {
    ...buildInput(),
    category: "technical_explanation" as const,
    routingQuestion: "Calcule 12 * 37.",
    userMessage: "Calcule 12 * 37.",
    question: "Calcule 12 * 37.",
    requiresExternalGrounding: true,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used" as const,
      used: true,
      routing: {
        ...defaultChatToolMetadata.routing,
        toolRequired: true,
        toolRecommended: true,
        toolResultUsed: true,
        toolType: "calculator" as const,
        intent: "arithmetic",
        fallbackAllowed: false
      },
      verifiedFacts: ["12 * 37 = 444"]
    }
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:14b";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      timeoutMs = options?.timeoutMs ?? 0;
      numPredict = options?.numPredict ?? 0;
      return {
        provider: "ollama",
        model: selectedModel,
        response: JSON.stringify({
          modelRole: "student",
          answer: "Le resultat de 12 multiplie par 37 est 444.",
          key_points: ["Calcul verifie"],
          assumptions: [],
          confidence: 96
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "phi3:mini");
  assert.equal(result.specialist.role, "fast_router");
  assert.equal(result.runtimeBudget?.profile, "fast_tool");
  assert.equal(timeoutMs <= 12000, true);
  assert.equal(numPredict <= 96, true);
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
    requiresExternalGrounding: false,
    tooling: defaultChatToolMetadata
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
  assert.equal(result.model, "qwen2.5:14b");
  assert.equal(result.specialist.role, "primary_brain");
  assert.equal(result.validationIssues.includes("student_chat_generation_failed"), true);
});

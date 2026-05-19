import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudentChatPrompt,
  StudentChatAdapter,
  type StudentChatAdapterInput
} from "../services/studentChatAdapter.js";
import {
  buildActiveConstraintCapsule,
  createInitialState
} from "../services/context/contextStateTracker.js";
import { decideMultiTurnAnswerPolicy } from "../services/context/multiTurnAnswerPolicy.js";
import { defaultChatToolMetadata } from "../types/chat.js";
import { defaultChatKnowledgeRetrievalMetadata } from "../types/knowledgeRetrieval.js";

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
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata
  };
}

test("student chat adapter routes stable biographies through the Mistral factual writing route", async () => {
  let timeoutMs = 0;
  let numPredict = 0;
  let selectedModel = "";
  let usedFormat = false;
  let usedSystem = "";
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt(_prompt, system, options) {
      timeoutMs = options?.timeoutMs ?? 0;
      numPredict = options?.numPredict ?? 0;
      selectedModel = options?.modelName ?? "";
      usedFormat = Boolean(options?.format);
      usedSystem = system ?? "";
      return {
        provider: "ollama",
        model: selectedModel || "phi3:mini",
        response: "Charlemagne est un roi des Francs et empereur carolingien.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(buildInput());

  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "mistral:7b");
  assert.equal(result.specialist.role, "writing_business");
  assert.equal(result.answer.modelRole, "student");
  assert.equal(result.answer.confidence, 82);
  assert.equal(timeoutMs > 1000, true);
  assert.equal(selectedModel, "mistral:7b");
  assert.equal(result.runtimeBudget?.profile, "stable_fact_chat");
  assert.equal(result.runtimeBudget?.maxOutputTokens, 104);
  assert.equal(numPredict, 104);
  assert.equal(usedFormat, false);
  assert.match(usedSystem, /plain final text only/i);
  assert.match(result.answer.answer, /Charlemagne/);
});

test("student chat prompt compacts stable factual biographies", () => {
  const prompt = buildStudentChatPrompt(buildInput());

  assert.match(prompt, /Stable factual answer shape/i);
  assert.match(prompt, /18-32 words/i);
  assert.match(prompt, /every JSON string value must be French/i);
  assert.match(prompt, /highest title\/role/i);
  assert.match(prompt, /own realm or dynasty/i);
  assert.match(prompt, /anachronistic labels/i);
  assert.match(prompt, /Saint-Empire romain germanique/i);
  assert.match(prompt, /Do not list extra battles/i);
  assert.match(prompt, /key_points to one short item/i);
  assert.match(prompt, /Do not write a long biography/i);
});

test("student chat adapter retries stable factual chat on the light local model before static fallback", async () => {
  const selectedModels: string[] = [];
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt(_prompt, _system, options) {
      const selectedModel = options?.modelName ?? "";
      selectedModels.push(selectedModel);
      if (selectedModel === "mistral:7b") {
        throw new Error("mistral timeout");
      }
      return {
        provider: "ollama",
        model: selectedModel,
        response: "Charlemagne est un roi des Francs et un empereur carolingien lie a l'empire carolingien.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(buildInput());

  assert.deepEqual(selectedModels, ["mistral:7b", "qwen2.5:3b"]);
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "qwen2.5:3b");
  assert.equal(result.usedRetry, true);
  assert.equal(result.runtimeBudget?.profile, "stable_fact_chat");
  assert.equal(result.validationIssues.some((issue) => issue.includes("mistral timeout")), true);
});

test("student chat adapter routes simple stable definitions through standard-light chat", async () => {
  let selectedModel = "";
  let timeoutMs = 0;
  const input = {
    ...buildInput(),
    category: "technical_explanation" as const,
    routingQuestion: "Explique simplement ce qu'est une API.",
    userMessage: "Explique simplement ce qu'est une API.",
    question: "Explique simplement ce qu'est une API.",
    requiresExternalGrounding: false
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "phi3:mini";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      timeoutMs = options?.timeoutMs ?? 0;
      return {
        provider: "ollama",
        model: selectedModel,
        response: JSON.stringify({
          modelRole: "student",
          answer: "Une API est une interface qui permet a deux logiciels de communiquer.",
          key_points: ["API"],
          assumptions: [],
          confidence: 91
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "primary_brain");
  assert.equal(result.runtimeBudget?.profile, "standard_light_chat");
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal(timeoutMs >= 45000, true);
});

test("student chat adapter reserves qwen 14B for complex standard reasoning", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "other" as const,
    routingQuestion: "Explain consistency model tradeoffs for a payment ledger migration.",
    userMessage: "Explain consistency model tradeoffs for a payment ledger migration.",
    question: "Explain consistency model tradeoffs for a payment ledger migration.",
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
          answer: "Use strong consistency for ledger writes and eventual consistency only for derived read models.",
          key_points: ["Consistency tradeoff"],
          assumptions: [],
          confidence: 86
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5:14b");
  assert.equal(result.specialist.role, "primary_brain");
  assert.equal(result.runtimeBudget?.profile, "standard_chat");
});

test("student chat adapter routes code questions to the local code specialist", async () => {
  let selectedModel = "";
  let usedFormat = false;
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
      usedFormat = Boolean(options?.format);
      return {
        provider: "ollama",
        model: selectedModel,
        response: "Start by reproducing the TypeScript API error and checking the failing stack trace.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5-coder:7b");
  assert.equal(result.specialist.role, "code_specialist");
  assert.equal(result.specialist.pipeline.some((step) => step.includes("qwen2.5-coder:7b")), true);
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal(usedFormat, false);
  assert.match(result.answer.answer, /TypeScript API error/);
});

test("student chat adapter routes concise direct answers to the fast 3B specialist", async () => {
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

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "fast_router");
  assert.match(result.specialist.routingReason, /short-answer constraint/i);
  assert.equal(result.runtimeBudget?.profile, "concise_chat");
});

test("student chat adapter keeps short conceptual Docker questions on the concise path", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "technical_explanation" as const,
    routingQuestion: "Reponse courte : c'est quoi Docker ?",
    userMessage: "Reponse courte : c'est quoi Docker ?",
    question: "Reponse courte : c'est quoi Docker ?",
    runtimeMode: "direct" as const,
    requiresExternalGrounding: false
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:14b";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      return {
        provider: "ollama",
        model: selectedModel,
        response: JSON.stringify({
          modelRole: "student",
          answer: "Docker isole une application dans des conteneurs portables.",
          key_points: ["Definition courte"],
          assumptions: [],
          confidence: 88
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "fast_router");
  assert.equal(result.runtimeBudget?.profile, "concise_chat");
});

test("student chat adapter still routes explicit Docker build errors to code specialist", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "debug_diagnostic" as const,
    routingQuestion: "Debug this Docker build error",
    userMessage: "Debug this Docker build error",
    question: "Debug this Docker build error",
    runtimeMode: "direct" as const,
    requiresExternalGrounding: false
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:14b";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      return {
        provider: "ollama",
        model: selectedModel,
        response: "Start by reading the Docker build error and the Dockerfile step that failed.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5-coder:7b");
  assert.equal(result.specialist.role, "code_specialist");
  assert.equal(result.runtimeBudget?.profile, "code_chat");
});

test("student chat adapter routes French writing tasks through plain Qwen 3B without heavy fallback", async () => {
  let selectedModel = "";
  let usedFormat = false;
  let timeoutMs = 0;
  const input = {
    ...buildInput(),
    category: "operational_writing" as const,
    routingQuestion: "Redige un message client annoncant un retard.",
    userMessage: "Redige un message client annoncant un retard.",
    question: "Redige un message client annoncant un retard.",
    runtimeMode: "direct" as const,
    requiresExternalGrounding: false
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "mistral:7b";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      usedFormat = Boolean(options?.format);
      timeoutMs = options?.timeoutMs ?? 0;
      return {
        provider: "ollama",
        model: selectedModel,
        response: "Bonjour, nous vous informons que la livraison aura un retard.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "writing_business");
  assert.equal(result.runtimeBudget?.profile, "writing_chat");
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal(usedFormat, false);
  assert.equal(timeoutMs >= 45000, true);
  assert.match(result.answer.answer, /retard/);
});

test("student chat adapter routes English writing tasks through plain Mistral", async () => {
  let selectedModel = "";
  let usedFormat = false;
  const input = {
    ...buildInput(),
    category: "operational_writing" as const,
    routingQuestion: "Write a stakeholder update about a delayed migration.",
    userMessage: "Write a stakeholder update about a delayed migration.",
    question: "Write a stakeholder update about a delayed migration.",
    runtimeMode: "direct" as const,
    requiresExternalGrounding: false
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:14b";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      usedFormat = Boolean(options?.format);
      return {
        provider: "ollama",
        model: selectedModel,
        response: "The migration is delayed; we will share the updated plan today.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "mistral:7b");
  assert.equal(result.specialist.role, "writing_business");
  assert.equal(result.runtimeBudget?.profile, "writing_chat");
  assert.equal(usedFormat, false);
  assert.match(result.answer.answer, /migration/);
});

test("student chat adapter routes French recipe requests through practical writing path", async () => {
  const selectedModels: string[] = [];
  let timeoutMs = 0;
  let numPredict = 0;
  let prompt = "";
  let system = "";
  const input = {
    ...buildInput(),
    category: "other" as const,
    routingQuestion: "donne moi une recette de tiramisu",
    userMessage: "donne moi une recette de tiramisu",
    question: "donne moi une recette de tiramisu",
    runtimeMode: "direct" as const,
    requiresExternalGrounding: false
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:14b";
    },
    async testPrompt(inputPrompt, inputSystem, options) {
      prompt = inputPrompt;
      system = inputSystem ?? "";
      const selectedModel = options?.modelName ?? "";
      selectedModels.push(selectedModel);
      timeoutMs = options?.timeoutMs ?? 0;
      numPredict = options?.numPredict ?? 0;
      return {
        provider: "ollama",
        model: selectedModel,
        response:
          "Pour un tiramisu, melangez mascarpone, jaunes d'oeufs et sucre, incorporez les blancs montes, puis alternez avec des biscuits imbibes de cafe. 2.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.deepEqual(selectedModels, ["mistral:7b"]);
  assert.equal(result.specialist.role, "writing_business");
  assert.match(result.specialist.routingReason, /Practical recipe/i);
  assert.equal(result.runtimeBudget?.profile, "writing_chat");
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal(timeoutMs < 150000, true);
  assert.equal(numPredict >= 180, true);
  assert.equal(numPredict <= 220, true);
  assert.match(system, /coffee-soaked sponge fingers/i);
  assert.match(system, /biscuits a la cuillere/i);
  assert.match(prompt, /avoid pastry cream/i);
  assert.match(result.answer.answer, /tiramisu/);
  assert.match(result.answer.answer, /biscuits a la cuillere/);
  assert.match(result.answer.answer, /cacao/);
  assert.doesNotMatch(result.answer.answer, /mascarpone cream|ladyfingers/i);
  assert.doesNotMatch(result.answer.answer, /\s2\.$/);
  assert.equal(result.answer.assumptions.includes("practical_recipe_quality_repair"), true);
});

test("student chat adapter routes lightweight context-setting turns to the fast 3B specialist", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "other" as const,
    routingQuestion: "On parle de bases de donnees.",
    userMessage: "On parle de bases de donnees.",
    question: "On parle de bases de donnees.",
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
          answer: "C'est note, on reste sur les bases de donnees.",
          key_points: ["Contexte conserve"],
          assumptions: [],
          confidence: 90
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "fast_router");
  assert.match(result.specialist.routingReason, /context-setting turn/i);
  assert.equal(result.runtimeBudget?.profile, "concise_chat");
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

test("student chat adapter routes strategic decisions to the CPU-safe local deep reasoner", async () => {
  let selectedModel = "";
  let usedFormat = false;
  let prompt = "";
  let system = "";
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
    async testPrompt(inputPrompt, inputSystem, options) {
      prompt = inputPrompt;
      system = inputSystem ?? "";
      selectedModel = options?.modelName ?? "";
      usedFormat = Boolean(options?.format);
      return {
        provider: "ollama",
        model: selectedModel,
        response: "Je recommande une option minimale, car la contrainte bloque AWS et le delai impose un scope reduit.",
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
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata
  });

  assert.equal(selectedModel, "qwen2.5:14b");
  assert.equal(result.specialist.role, "deep_reasoner");
  assert.equal(result.specialist.pipeline.some((step) => step.includes("qwen2.5:14b")), true);
  assert.equal(result.runtimeBudget?.profile, "deep_reasoning");
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal(result.runtimeBudget?.maxOutputTokens, 180);
  assert.match(result.answer.answer, /on-prem/i);
  assert.equal(usedFormat, false);
  assert.match(system, /exact term on-prem/i);
  assert.match(prompt, /exact term on-prem/i);
  assert.match(system, /smallest reversible option/i);
  assert.match(prompt, /minimal reversible path/i);
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

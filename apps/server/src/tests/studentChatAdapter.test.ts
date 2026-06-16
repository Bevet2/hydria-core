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
import { defaultAnswerabilityPlanner } from "../services/answerability/answerabilityPlanner.js";
import { defaultAgenticOrchestrationPlanner } from "../services/orchestration/agenticOrchestrationPlanner.js";

function buildEvidenceCapsule(args: {
  question: string;
  userMessage?: string;
  category?: StudentChatAdapterInput["category"];
}) {
  const state = createInitialState();
  return defaultAnswerabilityPlanner.buildCapsule({
    question: args.question,
    userMessage: args.userMessage ?? args.question,
    category: args.category ?? "other",
    toolRouting: defaultChatToolMetadata.routing,
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata,
    conversationState: state,
    hasPriorConversation: false
  });
}

function buildAgenticPlan(args: {
  question: string;
  category?: StudentChatAdapterInput["category"];
  evidenceCapsule: StudentChatAdapterInput["evidenceCapsule"];
}) {
  const state = createInitialState();
  return defaultAgenticOrchestrationPlanner.buildPlan({
    question: args.question,
    category: args.category ?? "other",
    toolRouting: defaultChatToolMetadata.routing,
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata,
    evidenceRequirement: defaultAnswerabilityPlanner.planRequirement({
      question: args.question,
      userMessage: args.question,
      category: args.category ?? "other",
      toolRouting: defaultChatToolMetadata.routing,
      conversationState: state,
      hasPriorConversation: false
    }),
    evidenceCapsule: args.evidenceCapsule
  });
}

function buildInput(): StudentChatAdapterInput {
  const state = createInitialState();
  const capsule = buildActiveConstraintCapsule(state, "qui est charlemagne");
  const evidenceCapsule = buildEvidenceCapsule({ question: "qui est charlemagne" });
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
    evidenceCapsule,
    agenticPlan: buildAgenticPlan({ question: "qui est charlemagne", evidenceCapsule }),
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
      return "qwen2.5:3b";
    },
    async testPrompt(_prompt, system, options) {
      timeoutMs = options?.timeoutMs ?? 0;
      numPredict = options?.numPredict ?? 0;
      selectedModel = options?.modelName ?? "";
      usedFormat = Boolean(options?.format);
      usedSystem = system ?? "";
      return {
        provider: "ollama",
        model: selectedModel || "qwen2.5:3b",
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
  assert.match(usedSystem, /do not include birthplace or death place/i);
  assert.match(result.answer.answer, /Charlemagne/);
});

test("student chat prompt compacts stable factual biographies", () => {
  const prompt = buildStudentChatPrompt(buildInput());

  assert.match(prompt, /Stable factual answer shape/i);
  assert.match(prompt, /18-32 words/i);
  assert.match(prompt, /every JSON string value must be French/i);
  assert.match(prompt, /highest title\/role/i);
  assert.match(prompt, /Do not include birthplace or death place/i);
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
      return "qwen2.5:3b";
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
      return "qwen2.5:3b";
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
  assert.equal(result.runtimeBudget?.fallbackDepth, 1);
  assert.equal(timeoutMs >= 45000, true);
});

test("student chat adapter keeps conceptual streaming architecture explanations on the light route", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "architecture_design" as const,
    routingQuestion: "Explique le traitement temps reel dans une architecture streaming.",
    userMessage: "Explique le traitement temps reel dans une architecture streaming.",
    question: "Explique le traitement temps reel dans une architecture streaming.",
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
        response: "Le streaming temps reel traite les evenements en continu des leur arrivee.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "primary_brain");
  assert.equal(result.runtimeBudget?.profile, "standard_light_chat");
  assert.match(result.specialist.routingReason, /Conceptual architecture/i);
  assert.match(result.answer.answer, /streaming/i);
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
      return "qwen2.5:3b";
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
  let usedSystem = "";
  const input = {
    ...buildInput(),
    category: "debug_diagnostic" as const,
    routingQuestion: "Debug a Docker build error where npm install fails.",
    userMessage: "Debug a Docker build error where npm install fails.",
    question: "Debug a Docker build error where npm install fails."
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:3b";
    },
    async testPrompt(_prompt, system, options) {
      selectedModel = options?.modelName ?? "";
      usedFormat = Boolean(options?.format);
      usedSystem = system ?? "";
      return {
        provider: "ollama",
        model: selectedModel,
        response: "Start with the Docker npm install failure, then inspect the lockfile and build cache.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5-coder:7b");
  assert.equal(result.specialist.role, "code_specialist");
  assert.equal(result.specialist.pipeline.some((step) => step.includes("qwen2.5-coder:7b")), true);
  assert.equal(result.runtimeBudget?.fallbackDepth, 1);
  assert.equal(usedFormat, false);
  assert.match(usedSystem, /failing command/i);
  assert.match(buildStudentChatPrompt(input), /npm install/i);
  assert.match(result.answer.answer, /npm install/);
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
      return "qwen2.5:3b";
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

test("student chat adapter keeps short conceptual PostgreSQL explanations off the code route", async () => {
  let selectedModel = "";
  const input = {
    ...buildInput(),
    category: "technical_explanation" as const,
    routingQuestion: "Explique PostgreSQL en respectant ma contrainte.",
    userMessage: "Explique PostgreSQL en respectant ma contrainte.",
    question: "Explique PostgreSQL en respectant ma contrainte.",
    runtimeMode: "conversation" as const,
    requiresExternalGrounding: false,
    activeConstraintCapsule: {
      ...buildInput().activeConstraintCapsule,
      language: "fr" as const,
      topConstraints: ["User preference: reponds en moins de 12 mots"]
    }
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
          answer: "PostgreSQL est une base de donnees relationnelle SQL robuste.",
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
  assert.notEqual(result.specialist.role, "code_specialist");
  assert.notEqual(result.runtimeBudget?.profile, "code_chat");
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
  assert.equal(result.runtimeBudget?.fallbackDepth, 2);
  assert.equal(usedFormat, false);
  assert.equal(timeoutMs >= 45000, true);
  assert.match(result.answer.answer, /retard/);
});

test("student chat adapter warns against fabricated citations in free writing mode", async () => {
  let usedSystem = "";
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
    async testPrompt(_prompt, system, options) {
      usedSystem = system ?? "";
      return {
        provider: "ollama",
        model: options?.modelName ?? "",
        response: "Bonjour, nous vous informons que la livraison aura un retard.",
        durationMs: 12
      };
    }
  });

  await adapter.answer(input);

  assert.match(usedSystem, /do not invent specific statistics|fabricated number/i);
});

test("student chat adapter removes writing instructions and repeated final text", async () => {
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "student-local";
    },
    async testPrompt(_prompt, _system, options) {
      return {
        provider: "ollama",
        model: options?.modelName ?? "student-local",
        response:
          "Phrase courte : \"Ne garde pas ceci.\" Final answer: \"Merci pour votre confiance. Nous restons à votre disposition. Cordialement, Hydria Merci pour votre confiance.\"",
        durationMs: 12
      };
    }
  });

  const input = {
    ...buildInput(),
    question: "Ecris un court message pour remercier un client.",
    routingQuestion: "Ecris un court message pour remercier un client.",
    userMessage: "Ecris un court message pour remercier un client.",
    category: "operational_writing" as const,
    requiresExternalGrounding: false
  };
  const result = await adapter.answer(input);

  assert.equal(
    result.answer.answer,
    "Merci pour votre confiance. Nous restons à votre disposition. Cordialement, Hydria"
  );
  assert.doesNotMatch(result.answer.answer, /final answer|phrase doit|pas besoin/i);
});

test("student chat adapter enforces a one-sentence French writing request", async () => {
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "student-local";
    },
    async testPrompt(_prompt, _system, options) {
      return {
        provider: "ollama",
        model: options?.modelName ?? "student-local",
        response:
          "Je veux une seule phrase simple et positive. Merci pour votre confiance. Nous restons à votre disposition.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer({
    ...buildInput(),
    question: "Ecris une phrase courte pour remercier un client.",
    routingQuestion: "Ecris une phrase courte pour remercier un client.",
    userMessage: "Ecris une phrase courte pour remercier un client.",
    category: "operational_writing",
    requiresExternalGrounding: false
  });

  assert.equal(result.answer.answer, "Merci pour votre confiance.");
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
  assert.equal(result.runtimeBudget?.fallbackDepth, 2);
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

test("student chat adapter retries practical recipes on Qwen 3B before static fallback", async () => {
  const selectedModels: string[] = [];
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
    async testPrompt(_prompt, _system, options) {
      const selectedModel = options?.modelName ?? "";
      selectedModels.push(selectedModel);
      if (selectedModel === "mistral:7b") {
        throw new Error("mistral timeout");
      }
      return {
        provider: "ollama",
        model: selectedModel,
        response:
          "Pour un tiramisu classique, utilise du cafe, du mascarpone, des biscuits a la cuillere et du cacao, puis laisse reposer au frais.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.deepEqual(selectedModels, ["mistral:7b", "qwen2.5:3b"]);
  assert.equal(result.provider, "ollama");
  assert.equal(result.model, "qwen2.5:3b");
  assert.equal(result.usedRetry, true);
  assert.equal(result.runtimeBudget?.profile, "writing_chat");
  assert.equal(result.validationIssues.some((issue) => issue.includes("mistral timeout")), true);
  assert.match(result.answer.answer, /mascarpone/);
  assert.match(result.answer.answer, /cacao/);
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
      return "qwen2.5:3b";
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

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "fast_router");
  assert.equal(result.runtimeBudget?.profile, "fast_tool");
  assert.equal(timeoutMs <= 12000, true);
  assert.equal(numPredict <= 96, true);
});

test("student chat adapter gives source-backed research synthesis a longer single local attempt", async () => {
  let selectedModel = "";
  let timeoutMs = 0;
  const input = {
    ...buildInput(),
    category: "other" as const,
    routingQuestion: "Tu connais les regles du bowling ?",
    userMessage: "Tu connais les regles du bowling ?",
    question: "Tu connais les regles du bowling ?",
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
        toolType: "research" as const,
        intent: "fact_check",
        fallbackAllowed: false,
        extractedArgs: {
          subject: "Bowling",
          language: "fr"
        }
      },
      verifiedFacts: [
        "Bowling: une partie compte dix carreaux; chaque joueur lance deux boules par carreau."
      ]
    }
  };
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "mistral:7b";
    },
    async testPrompt(_prompt, _system, options) {
      selectedModel = options?.modelName ?? "";
      timeoutMs = options?.timeoutMs ?? 0;
      return {
        provider: "ollama",
        model: selectedModel,
        response:
          "Au bowling, une partie compte dix carreaux. A chaque carreau, le joueur lance jusqu'a deux boules pour renverser les quilles.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.runtimeBudget?.profile, "standard_light_chat");
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal(timeoutMs >= 90000, true);
  assert.match(result.specialist.routingReason, /Verified external tool facts/i);
});

test("student chat adapter routes bounded strategic decisions to the light local reasoner", async () => {
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
      return "qwen2.5:3b";
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
    evidenceCapsule: buildEvidenceCapsule({
      question: "On doit choisir une architecture. Au depart je pensais AWS.",
      category: "architecture_design"
    }),
    agenticPlan: buildAgenticPlan({
      question: "On-prem strict, deadline demain. Tu recommandes quoi ?",
      category: "architecture_design",
      evidenceCapsule: buildEvidenceCapsule({
        question: "On doit choisir une architecture. Au depart je pensais AWS.",
        category: "architecture_design"
      })
    }),
    requiresExternalGrounding: false,
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata
  });

  assert.equal(selectedModel, "qwen2.5:14b");
  assert.equal(result.specialist.role, "deep_reasoner");
  assert.equal(result.specialist.pipeline.some((step) => step.includes("strategic_primary_reasoner:qwen2.5:14b")), true);
  assert.equal(result.runtimeBudget?.profile, "deep_reasoning");
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal((result.runtimeBudget?.timeoutMs ?? 0) >= 240000, true);
  assert.equal((result.runtimeBudget?.maxOutputTokens ?? 0) >= 260, true);
  assert.match(result.answer.answer, /on-prem/i);
  assert.equal(usedFormat, false);
  assert.match(system, /exact decisive terms/i);
  assert.match(prompt, /on-prem/i);
  assert.match(system, /smallest reversible option/i);
  assert.match(prompt, /User:\s+On-prem strict/i);
  assert.doesNotMatch(prompt, /AgenticOrchestrationPlan:/i);
  assert.doesNotMatch(prompt, /Recent conversation turns:/i);
  assert.equal(prompt.length < 1400, true);
});

test("student chat adapter routes bounded budget and deadline changes through compact Qwen 14B reasoning", async () => {
  const attemptedModels: string[] = [];
  const state = createInitialState();
  const question =
    "Le budget tombe a 12000 euros et la date avance au 31 juillet. Que dois-je changer dans le plan et pourquoi ?";
  const capsule = buildActiveConstraintCapsule(state, question);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: question,
    category: "product_strategy",
    toolRouting: null,
    lastAssistantAnswer: ""
  });
  const evidenceCapsule = buildEvidenceCapsule({
    question,
    category: "product_strategy"
  });
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "mistral:7b";
    },
    async testPrompt(_prompt, _system, options) {
      const model = options?.modelName ?? "";
      attemptedModels.push(model);
      return {
        provider: "ollama",
        model,
        response: JSON.stringify({
          modelRole: "student",
          answer:
            "Je recommande de reduire le perimetre au chemin critique, de phaser les livrables et de proteger les controles essentiels. Le budget plus faible et la date avancee imposent ce compromis; reevalue le plan si le delai ou le financement change.",
          key_points: ["Perimetre reduit", "Livraison phasee"],
          assumptions: [],
          confidence: 84
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer({
    question,
    routingQuestion: question,
    userMessage: question,
    runtimeMode: "conversation",
    category: "product_strategy",
    recentMessages: [],
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    evidenceCapsule,
    agenticPlan: buildAgenticPlan({
      question,
      category: "product_strategy",
      evidenceCapsule
    }),
    requiresExternalGrounding: false,
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata
  });

  assert.deepEqual(attemptedModels, ["qwen2.5:14b"]);
  assert.equal(result.model, "qwen2.5:14b");
  assert.match(result.answer.answer, /perimetre|livrables/i);
});

test("student chat adapter falls back from an unavailable 14B route to Qwen 3B", async () => {
  const attemptedModels: string[] = [];
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
      return "mistral:7b";
    },
    async testPrompt(_prompt, _system, options) {
      const model = options?.modelName ?? "";
      attemptedModels.push(model);
      if (model === "qwen2.5:14b") {
        throw new Error("14B timeout");
      }
      return {
        provider: "ollama",
        model,
        response: JSON.stringify({
          modelRole: "student",
          answer:
            "Use strong consistency for ledger writes and eventual consistency for derived read models, then revise only if measured availability requirements demand it.",
          key_points: ["Consistency tradeoff"],
          assumptions: [],
          confidence: 84
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer(input);

  assert.deepEqual(attemptedModels, ["qwen2.5:14b", "qwen2.5:3b"]);
  assert.equal(result.model, "qwen2.5:3b");
  assert.match(result.answer.answer, /strong consistency/i);
});

test("student chat adapter routes strategic setup turns to the fast local path", async () => {
  let selectedModel = "";
  const state = createInitialState();
  const capsule = buildActiveConstraintCapsule(state, "On doit choisir une architecture. Au depart je pensais AWS.");
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: "On doit choisir une architecture. Au depart je pensais AWS.",
    category: "architecture_design",
    toolRouting: null,
    lastAssistantAnswer: ""
  });
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
          answer: "C'est note, AWS est l'hypothese initiale.",
          key_points: ["Contexte conserve"],
          assumptions: [],
          confidence: 86
        }),
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer({
    question: "On doit choisir une architecture. Au depart je pensais AWS.",
    routingQuestion: "On doit choisir une architecture. Au depart je pensais AWS.",
    userMessage: "On doit choisir une architecture. Au depart je pensais AWS.",
    runtimeMode: "conversation",
    category: "architecture_design",
    recentMessages: [],
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    evidenceCapsule: buildEvidenceCapsule({
      question: "On-prem strict, deadline demain. Tu recommandes quoi ?",
      category: "architecture_design"
    }),
    agenticPlan: buildAgenticPlan({
      question: "On doit choisir une architecture. Au depart je pensais AWS.",
      category: "architecture_design",
      evidenceCapsule: buildEvidenceCapsule({
        question: "On-prem strict, deadline demain. Tu recommandes quoi ?",
        category: "architecture_design"
      })
    }),
    requiresExternalGrounding: false,
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata
  });

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.specialist.role, "primary_brain");
  assert.equal(result.runtimeBudget?.profile, "concise_chat");
  assert.equal(result.runtimeBudget?.fallbackDepth, 1);
});

test("student chat adapter allocates a long-form budget when the user requests 900 words", async () => {
  let selectedModel = "";
  let maxTokens = 0;
  let numCtx = 0;
  let prompt = "";
  const state = createInitialState();
  const question =
    "Explique en profondeur, en au moins 900 mots, comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident.";
  const capsule = buildActiveConstraintCapsule(state, question);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: question,
    category: "technical_explanation",
    toolRouting: null,
    lastAssistantAnswer: ""
  });
  const evidenceCapsule = buildEvidenceCapsule({
    question,
    category: "technical_explanation"
  });
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:14b";
    },
    async testPrompt(inputPrompt, _system, options) {
      prompt = inputPrompt;
      selectedModel = options?.modelName ?? "";
      maxTokens = options?.numPredict ?? 0;
      numCtx = options?.numCtx ?? 0;
      return {
        provider: "ollama",
        model: selectedModel,
        response:
          "PostgreSQL combine le journal WAL, les transactions MVCC, les checkpoints et la reprise pour proteger les donnees.",
        durationMs: 12
      };
    }
  });

  const result = await adapter.answer({
    question,
    routingQuestion: question,
    userMessage: question,
    runtimeMode: "direct",
    category: "technical_explanation",
    recentMessages: [],
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    evidenceCapsule,
    agenticPlan: buildAgenticPlan({
      question,
      category: "technical_explanation",
      evidenceCapsule
    }),
    requiresExternalGrounding: false,
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata
  });

  assert.equal(selectedModel, "qwen2.5:3b");
  assert.equal(result.runtimeBudget?.profile, "long_form_chat");
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.ok((result.runtimeBudget?.maxOutputTokens ?? 0) >= 1600);
  assert.equal(maxTokens, result.runtimeBudget?.maxOutputTokens);
  assert.ok(numCtx >= 8192);
  assert.equal(
    result.specialist.pipeline.some((step) => step.includes("response_length:long_form_900_words")),
    true
  );
  assert.match(prompt, /Resolve ambiguous terms/i);
  assert.doesNotMatch(prompt, /AgenticOrchestrationPlan:/i);
});

test("student chat adapter does not chain local models after a long-form timeout", async () => {
  const attemptedModels: string[] = [];
  const question =
    "Explique en profondeur, en au moins 300 mots, les garanties et limites de PostgreSQL.";
  const state = createInitialState();
  const capsule = buildActiveConstraintCapsule(state, question);
  const policy = decideMultiTurnAnswerPolicy({
    conversationState: state,
    activeConstraintCapsule: capsule,
    newUserMessage: question,
    category: "technical_explanation",
    toolRouting: null,
    lastAssistantAnswer: ""
  });
  const evidenceCapsule = buildEvidenceCapsule({
    question,
    category: "technical_explanation"
  });
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:14b";
    },
    async testPrompt(_prompt, _system, options) {
      attemptedModels.push(options?.modelName ?? "");
      throw new Error("local timeout");
    }
  });

  const result = await adapter.answer({
    question,
    routingQuestion: question,
    userMessage: question,
    runtimeMode: "direct",
    category: "technical_explanation",
    recentMessages: [],
    activeConstraintCapsule: capsule,
    answerPolicy: policy,
    evidenceCapsule,
    agenticPlan: buildAgenticPlan({
      question,
      category: "technical_explanation",
      evidenceCapsule
    }),
    requiresExternalGrounding: false,
    tooling: defaultChatToolMetadata,
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata
  });

  assert.deepEqual(attemptedModels, ["qwen2.5:3b"]);
  assert.equal(result.runtimeBudget?.fallbackDepth, 0);
  assert.equal(result.provider, "fallback");
});

test("student chat adapter does not call cloud fallback when local generation fails", async () => {
  const adapter = new StudentChatAdapter({
    getConfiguredModelName() {
      return "qwen2.5:3b";
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

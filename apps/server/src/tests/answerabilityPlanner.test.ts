import test from "node:test";
import assert from "node:assert/strict";
import { defaultToolRoutingDecision, type ToolRoutingDecision } from "../types/arena.js";
import { defaultChatToolMetadata, type ChatToolMetadata } from "../types/chat.js";
import { defaultChatKnowledgeRetrievalMetadata } from "../types/knowledgeRetrieval.js";
import { AnswerabilityPlanner } from "../services/answerability/answerabilityPlanner.js";
import { createInitialState } from "../services/context/contextStateTracker.js";

const planner = new AnswerabilityPlanner();

function route(overrides: Partial<ToolRoutingDecision>) {
  return {
    ...defaultToolRoutingDecision,
    ...overrides
  } as ToolRoutingDecision;
}

function tooling(overrides: Partial<ChatToolMetadata> = {}): ChatToolMetadata {
  return {
    ...defaultChatToolMetadata,
    ...overrides,
    routing: overrides.routing ?? defaultChatToolMetadata.routing
  };
}

test("answerability planner requires source-backed evidence for current or latest facts", () => {
  const plan = planner.planRequirement({
    question: "Quelles sont les dernieres nouveautes IA cette semaine ?",
    userMessage: "Quelles sont les dernieres nouveautes IA cette semaine ?",
    category: "technical_explanation",
    toolRouting: route({
      toolRequired: true,
      toolType: "research",
      intent: "recent_updates",
      fallbackAllowed: false
    }),
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(plan.answerabilityMode, "source_backed");
  assert.equal(plan.requiresResearch, true);
  assert.equal(plan.sourceBound, true);
  assert.equal(plan.abstainIfMissing, true);
  assert.ok(plan.requiredEvidence.includes("source_research"));
});

test("answerability planner separates executable live tools from source research", () => {
  const plan = planner.planRequirement({
    question: "Calcule 245 + 389.",
    userMessage: "Calcule 245 + 389.",
    category: "other",
    toolRouting: route({
      toolRequired: true,
      toolType: "calculator",
      intent: "arithmetic",
      fallbackAllowed: false
    }),
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(plan.answerabilityMode, "tool_first");
  assert.ok(plan.requiredEvidence.includes("tool_live"));
  assert.equal(plan.requiresResearch, false);
});

test("answerability planner marks conversation memory as required for recall turns", () => {
  const state = createInitialState();
  state.knownFacts.push("User said their project is Hydria Core.");

  const capsule = planner.buildCapsule({
    question: "Comment s'appelle mon projet ?",
    userMessage: "Comment s'appelle mon projet ?",
    category: "other",
    toolRouting: route({}),
    tooling: tooling(),
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata,
    conversationState: state,
    hasPriorConversation: true
  });

  assert.equal(capsule.answerabilityMode, "conversation_state");
  assert.ok(capsule.requiredEvidence.includes("conversation_memory"));
  assert.ok(capsule.usedEvidence.includes("conversation_state"));
  assert.equal(capsule.missingEvidence.length, 0);
});

test("answerability capsule reports missing required evidence before generation", () => {
  const toolRouting = route({
    toolRequired: true,
    toolType: "finance",
    intent: "current_price",
    fallbackAllowed: false
  });
  const capsule = planner.buildCapsule({
    question: "What is the current Bitcoin price?",
    userMessage: "What is the current Bitcoin price?",
    category: "other",
    toolRouting,
    tooling: tooling({ route: "failed", routing: toolRouting }),
    knowledgeRetrieval: defaultChatKnowledgeRetrievalMetadata,
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(capsule.reliabilityLevel, "blocked");
  assert.deepEqual(capsule.missingEvidence, ["tool_live"]);
  assert.match(capsule.promptGuidance, /instead of inventing/i);
});

test("answerability planner uses specialist synthesis for strategic decisions", () => {
  const plan = planner.planRequirement({
    question: "Budget bloque, deadline demain, on-prem seulement. Tu recommandes quoi ?",
    userMessage: "Budget bloque, deadline demain, on-prem seulement. Tu recommandes quoi ?",
    category: "architecture_design",
    toolRouting: route({}),
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(plan.answerabilityMode, "specialist_synthesis");
  assert.ok(plan.requiredEvidence.includes("multi_specialist_synthesis"));
  assert.equal(plan.requiresSynthesis, true);
});

test("answerability planner uses governed knowledge for Hydria runtime questions", () => {
  const plan = planner.planRequirement({
    question: "Explique comment Hydria utilise les watchers et sa memoire.",
    userMessage: "Explique comment Hydria utilise les watchers et sa memoire.",
    category: "technical_explanation",
    toolRouting: route({}),
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(plan.answerabilityMode, "knowledge_augmented");
  assert.ok(plan.requiredEvidence.includes("governed_knowledge"));
  assert.equal(plan.requiresKnowledge, true);
  assert.equal(plan.requiresResearch, false);
});

test("answerability planner does not force source research for practical everyday requests", () => {
  const plan = planner.planRequirement({
    question: "Donne moi une recette de tiramisu simple.",
    userMessage: "Donne moi une recette de tiramisu simple.",
    category: "operational_writing",
    toolRouting: route({}),
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(plan.answerabilityMode, "direct_model");
  assert.equal(plan.requiresResearch, false);
  assert.equal(plan.sourceBound, false);
});

test("answerability planner treats English explain turns as sourceable factual lookups", () => {
  const plan = planner.planRequirement({
    question: "Explain eventual consistency with a practical example.",
    userMessage: "Explain eventual consistency with a practical example.",
    category: "technical_explanation",
    toolRouting: route({}),
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(plan.answerabilityMode, "source_backed");
  assert.ok(plan.requiredEvidence.includes("source_research"));
  assert.equal(plan.requiresResearch, true);
});

test("answerability planner v2 requires sources for history and science facts", () => {
  for (const question of [
    "Raconte la Renaissance en quelques points.",
    "Explique la photosynthese simplement.",
    "Le roi Louis neuf de France, c'est qui ?"
  ]) {
    const plan = planner.planRequirement({
      question,
      userMessage: question,
      category: "other",
      toolRouting: route({}),
      conversationState: createInitialState(),
      hasPriorConversation: false
    });

    assert.equal(plan.answerabilityMode, "source_backed");
    assert.equal(plan.requiresResearch, true);
    assert.equal(plan.sourceBound, true);
  }
});

test("answerability planner keeps conceptual streaming architecture on direct model routing", () => {
  const plan = planner.planRequirement({
    question: "Explique le traitement temps reel dans une architecture streaming.",
    userMessage: "Explique le traitement temps reel dans une architecture streaming.",
    category: "architecture_design",
    toolRouting: route({}),
    conversationState: createInitialState(),
    hasPriorConversation: false
  });

  assert.equal(plan.answerabilityMode, "direct_model");
  assert.equal(plan.requiresResearch, false);
  assert.equal(plan.requiresSynthesis, false);
});

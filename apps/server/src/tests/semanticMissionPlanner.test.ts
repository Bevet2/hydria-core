import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticFrame, sourceMatchesSemanticFrame } from "../services/orchestration/semanticMissionPlanner.js";
import { verifyPostAnswerGrounding } from "../services/orchestration/postAnswerVerifier.js";
import { defaultChatToolMetadata } from "../types/chat.js";
import { defaultToolRoutingDecision, type ToolRoutingDecision } from "../types/arena.js";

function route(overrides: Partial<ToolRoutingDecision>): ToolRoutingDecision {
  return {
    ...defaultToolRoutingDecision,
    ...overrides,
    extractedArgs: overrides.extractedArgs ?? {}
  };
}

test("semantic frame rejects same-word but wrong-sense technical sources", () => {
  const frame = buildSemanticFrame({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    subject: "Docker",
    language: "fr"
  });

  const wrongSense = sourceMatchesSemanticFrame(
    frame,
    "Docker: Un docker ou debardeur est un ouvrier portuaire employe au chargement des navires."
  );
  const rightSense = sourceMatchesSemanticFrame(
    frame,
    "Docker est une plateforme logicielle de conteneurs qui sert a empaqueter et executer des applications."
  );

  assert.equal(wrongSense.passed, false);
  assert.match(wrongSense.reason, /rejected|expected/);
  assert.equal(rightSense.passed, true);
});

test("post-answer verifier flags answers that use a rejected source sense", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    subject: "Docker",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "Docker",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    answer: "Un docker est un ouvrier portuaire qui charge et decharge des navires.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "Docker est une plateforme logicielle de conteneurs pour empaqueter et executer des applications."
      ],
      sources: []
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("answer_uses_rejected_sense"));
  assert.equal(result.recommendedAction, "repair_from_verified_sources");
});

test("post-answer verifier accepts source-backed technical answers with ambiguous product names", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    subject: "Docker",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "Docker",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    answer:
      "Docker est une plateforme logicielle permettant de faire tourner des applications dans des conteneurs.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "Docker est une plateforme logicielle permettant de faire tourner des applications dans des conteneurs."
      ],
      sources: []
    }
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("post-answer verifier rejects product-level answers when sources identify an organization", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    subject: "NVIDIA",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "NVIDIA",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    answer:
      "NVIDIA est un processeur tout-en-un, ou SoC, derive de la famille d'architecture ARM produit par NVIDIA.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "Nvidia Corporation est une societe multinationale americaine de technologie specialisee dans les processeurs graphiques et les accelerateurs d'IA.",
        "Nvidia: fabricant americain de cartes graphiques et accelerateurs d'IA."
      ],
      sources: []
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("answer_entity_type_mismatch:organization_vs_product_device"));
  assert.equal(result.recommendedAction, "repair_from_verified_sources");
});

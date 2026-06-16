import assert from "node:assert/strict";
import test from "node:test";
import type { GeneralKnowledgeReliabilityCase } from "../data/generalKnowledgeReliabilityGatePack.js";
import {
  inspectProductionGeneralKnowledgeCase,
  selectProductionGeneralKnowledgeCases,
  sourceFamily
} from "../scripts/runProductionGeneralKnowledgeReliabilityGate.js";
import type { ResearchSource } from "../types/arena.js";

function researchSource(url: string, title: string, excerpt: string): ResearchSource {
  return {
    title,
    url,
    snippet: excerpt,
    excerpt,
    publishedAt: null,
    modifiedAt: null,
    effectiveDate: null,
    dateSource: null,
    retrievalChannel: "live",
    retrievalOrigin: "known_endpoint",
    retrievalEngine: "known_endpoint"
  };
}

function sourceBackedCase(): GeneralKnowledgeReliabilityCase {
  return {
    id: "bio_louis_ix_digit_fr",
    message: "Fais-moi une biographie de Louis 9 pour une presentation.",
    category: "other",
    expected: {
      kind: "source_backed",
      term: "Louis IX"
    }
  };
}

test("production general knowledge gate accepts corroborated source-backed research", () => {
  const result = inspectProductionGeneralKnowledgeCase(sourceBackedCase(), {
    durationMs: 900,
    assistantMessage: {
      content: "Louis IX, aussi appele Saint Louis, est un roi de France du XIIIe siecle."
    },
    evidenceCapsule: {
      answerabilityMode: "source_backed",
      usedEvidence: ["source_research"],
      missingEvidence: [],
      sourceBound: true,
      reliabilityLevel: "grounded"
    },
    generation: {
      provider: "tool",
      model: "research_general_knowledge",
      usedStaticFallback: false
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check",
        toolRequired: true,
        toolResultUsed: true
      },
      sources: [
        researchSource("https://fr.wikipedia.org/wiki/Louis_IX", "Louis IX", "Louis IX est roi de France."),
        researchSource("https://www.wikidata.org/wiki/Q346", "Louis IX", "Louis IX, Saint Louis, roi de France.")
      ]
    },
    orchestrationTrace: {
      steps: [{ id: "answerability", status: "passed", summary: "source_backed" }]
    }
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.sourceFamilies.sort(), ["wikidata", "wikipedia"]);
});

test("production general knowledge gate rejects wikipedia-only factual answers", () => {
  const result = inspectProductionGeneralKnowledgeCase(sourceBackedCase(), {
    assistantMessage: {
      content: "Louis IX, aussi appele Saint Louis, est un roi de France du XIIIe siecle."
    },
    evidenceCapsule: {
      answerabilityMode: "source_backed",
      missingEvidence: [],
      sourceBound: true
    },
    generation: {
      provider: "tool",
      model: "research_general_knowledge",
      usedStaticFallback: false
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check",
        toolRequired: true,
        toolResultUsed: true
      },
      sources: [researchSource("https://fr.wikipedia.org/wiki/Louis_IX", "Louis IX", "Louis IX est roi de France.")]
    },
    orchestrationTrace: {
      steps: [{ id: "answerability", status: "passed", summary: "source_backed" }]
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("insufficient_source_count:1"));
  assert.ok(result.issues.some((issue) => issue.startsWith("insufficient_source_families")));
});

test("production general knowledge gate rejects truncated source-backed answers", () => {
  const result = inspectProductionGeneralKnowledgeCase(sourceBackedCase(), {
    assistantMessage: {
      content: "Louis IX de France, dit Saint Louis, etait roi de France de 1226 a Il regna longtemps."
    },
    evidenceCapsule: {
      answerabilityMode: "source_backed",
      missingEvidence: [],
      sourceBound: true
    },
    generation: {
      provider: "tool",
      model: "research_general_knowledge",
      usedStaticFallback: false
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check",
        toolRequired: true,
        toolResultUsed: true
      },
      sources: [
        researchSource("https://fr.wikipedia.org/wiki/Louis_IX", "Louis IX", "Louis IX est roi de France."),
        researchSource("https://www.wikidata.org/wiki/Q346", "Louis IX", "Louis IX, Saint Louis, roi de France.")
      ]
    },
    orchestrationTrace: {
      steps: [{ id: "answerability", status: "passed", summary: "source_backed" }]
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("broken_answer"));
});

test("production general knowledge gate rejects ambiguous Cleopatra opera sources", () => {
  const testCase: GeneralKnowledgeReliabilityCase = {
    id: "bio_cleopatra_fr",
    message: "Qui etait Cleopatre ?",
    category: "other",
    expected: {
      kind: "source_backed",
      term: "Cleopatra VII"
    }
  };

  const result = inspectProductionGeneralKnowledgeCase(testCase, {
    assistantMessage: {
      content: "Cléopâtre is an opera by Jules Massenet which premiered in 1914."
    },
    evidenceCapsule: {
      answerabilityMode: "source_backed",
      missingEvidence: [],
      sourceBound: true
    },
    generation: {
      provider: "ollama",
      model: "qwen2.5:3b",
      usedStaticFallback: false
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check",
        toolRequired: true,
        toolResultUsed: true
      },
      sources: [
        researchSource("https://fr.wikipedia.org/wiki/Cléopâtre_(Massenet)", "Cléopâtre", "Opéra de Massenet."),
        researchSource("https://www.wikidata.org/wiki/Q2973190", "Cléopâtre", "opéra de Jules Massenet")
      ]
    },
    orchestrationTrace: {
      steps: [{ id: "answerability", status: "passed", summary: "source_backed" }]
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("missing_expected_term:Cleopatra VII"));
  assert.ok(result.issues.includes("source_subject_mismatch:Cleopatra VII"));
});

test("production general knowledge gate rejects Napoleon wrong-sense sources", () => {
  const testCase: GeneralKnowledgeReliabilityCase = {
    id: "bio_napoleon_fr",
    message: "Biographie courte de Napoleon Bonaparte.",
    category: "other",
    expected: {
      kind: "source_backed",
      term: "Napoleon I"
    }
  };

  const result = inspectProductionGeneralKnowledgeCase(testCase, {
    assistantMessage: {
      content:
        "Pierre-Napoleon Bonaparte est un membre de la famille Bonaparte. Napoleon Bonaparte est aussi le nom d'un ferry construit en 1996."
    },
    evidenceCapsule: {
      answerabilityMode: "source_backed",
      missingEvidence: [],
      sourceBound: true
    },
    generation: {
      provider: "tool",
      model: "research_multi_source_fallback",
      usedStaticFallback: false
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check",
        toolRequired: true,
        toolResultUsed: true
      },
      sources: [
        researchSource(
          "https://fr.wikipedia.org/wiki/Pierre-Napol%C3%A9on_Bonaparte",
          "Pierre-Napoleon Bonaparte",
          "Prince Bonaparte."
        ),
        researchSource(
          "https://www.wikidata.org/wiki/Q3335927",
          "Napoleon Bonaparte",
          "French cruiseferry built in 1996."
        )
      ]
    },
    orchestrationTrace: {
      steps: [{ id: "answerability", status: "passed", summary: "source_backed" }]
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("missing_expected_term:Napoleon I"));
  assert.ok(result.issues.includes("source_subject_mismatch:Napoleon I"));
});

test("production general knowledge gate rejects tools for direct practical tasks", () => {
  const testCase: GeneralKnowledgeReliabilityCase = {
    id: "direct_tiramisu_fr",
    message: "Donne-moi une recette de tiramisu simple.",
    category: "operational_writing",
    expected: {
      kind: "direct_model",
      term: "tiramisu"
    }
  };

  const result = inspectProductionGeneralKnowledgeCase(testCase, {
    assistantMessage: {
      content: "Voici une recette simple de tiramisu avec mascarpone et cafe."
    },
    evidenceCapsule: {
      answerabilityMode: "direct_model",
      missingEvidence: [],
      sourceBound: false
    },
    generation: {
      provider: "tool",
      model: "research_general_knowledge",
      usedStaticFallback: false
    },
    conversationQuality: {
      passed: true,
      issues: []
    },
    tooling: {
      used: true,
      route: "used",
      routing: {
        toolType: "research",
        intent: "fact_check",
        toolRequired: true,
        toolResultUsed: true
      },
      sources: [
        researchSource("https://fr.wikipedia.org/wiki/Tiramisu", "Tiramisu", "Dessert italien."),
        researchSource("https://www.wikidata.org/wiki/Q178", "Tiramisu", "Dessert italien.")
      ]
    },
    orchestrationTrace: {
      steps: [{ id: "answerability", status: "passed", summary: "direct_model" }]
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("unexpected_tool_for_direct:research"));
  assert.ok(result.issues.includes("unexpected_tool_provider_for_direct"));
});

test("production general knowledge gate selection supports explicit case ids", () => {
  const selected = selectProductionGeneralKnowledgeCases({
    offset: 0,
    limit: null,
    caseIds: ["bio_louis_ix_digit_fr", "direct_tiramisu_fr"]
  });

  assert.deepEqual(
    selected.map((item) => item.id),
    ["bio_louis_ix_digit_fr", "direct_tiramisu_fr"]
  );
});

test("production source family groups known factual sources", () => {
  assert.equal(sourceFamily(researchSource("https://en.wikipedia.org/wiki/DNA", "DNA", "DNA")), "wikipedia");
  assert.equal(sourceFamily(researchSource("https://www.wikidata.org/wiki/Q7430", "DNA", "DNA")), "wikidata");
  assert.equal(sourceFamily(researchSource("https://www.britannica.com/science/DNA", "DNA", "DNA")), "britannica");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyQuestion,
  classifyQuestionDetailed
} from "../services/questionClassifier.js";

test("question classifier v2 classifies official domains with matched signals", () => {
  const cases = [
    {
      question: "Plan an incident response for a leaked API key in production.",
      category: "incident_response"
    },
    {
      question: "Design an architecture for a multi-tenant streaming pipeline.",
      category: "architecture_design"
    },
    {
      question: "Explain the difference between Kafka topics and queues.",
      category: "technical_explanation"
    },
    {
      question: "Diagnose why the API intermittently returns 503 after deploy.",
      category: "debug_diagnostic"
    },
    {
      question: "Prioritize a SaaS roadmap using KPI and customer feedback.",
      category: "product_strategy"
    },
    {
      question: "Redige une update hebdomadaire projet pour le leadership.",
      category: "operational_writing"
    }
  ] as const;

  for (const entry of cases) {
    const result = classifyQuestionDetailed(entry.question);
    assert.equal(result.category, entry.category);
    assert.ok(result.confidence >= 0.6, entry.question);
    assert.ok(result.matchedSignals.length > 0, entry.question);
  }
});

test("question classifier v2 keeps explicit tradeoff decisions as mixed reasoning", () => {
  const result = classifyQuestionDetailed(
    "Should we choose Redis or Postgres for this cache? Compare risks, tradeoffs, and constraints."
  );

  assert.equal(result.category, "mixed_reasoning");
  assert.equal(classifyQuestion("Should we choose Redis or Postgres? List tradeoffs."), "mixed_reasoning");
  assert.ok(result.secondaryCategory);
});

test("question classifier v2 keeps simple who-is factual questions as general factual", () => {
  assert.equal(classifyQuestion("qui est louis 14"), "other");
  assert.equal(classifyQuestion("Who was Louis XIV?"), "other");
});

test("question classifier keeps explanatory incident terminology in technical explanation", () => {
  assert.equal(
    classifyQuestion(
      "Explique en profondeur comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident."
    ),
    "technical_explanation"
  );
});

test("question classifier v2 reduces other on benchmark-like prompts", () => {
  const prompts = [
    "Explique le traitement temps reel dans une architecture streaming.",
    "Comment structurer un document de migration ?",
    "Des caracteres accentues deviennent illisibles dans un export CSV, diagnostique les causes.",
    "Redige une checklist de rollback pour une migration monolithe vers services.",
    "Quel plan d'incident si un token de service a fuite ?",
    "Quelle roadmap MVP pour un outil interne LLM ?"
  ];

  const categories = prompts.map((prompt) => classifyQuestion(prompt));
  assert.equal(categories.filter((category) => category === "other").length, 0);
});

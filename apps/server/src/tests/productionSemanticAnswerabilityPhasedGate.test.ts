import assert from "node:assert/strict";
import test from "node:test";
import { GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES } from "../data/generalKnowledgeReliabilityGatePack.js";
import {
  buildSemanticAnswerabilityPhasedReport,
  parseSemanticAnswerabilityPhases,
  phaseOutputPath
} from "../scripts/runProductionSemanticAnswerabilityPhasedGate.js";

test("semantic answerability phased gate defaults to 50, 100, then 150 cases", () => {
  assert.deepEqual(parseSemanticAnswerabilityPhases(undefined), [50, 100, 150]);
  assert.deepEqual(parseSemanticAnswerabilityPhases("100,50,50"), [50, 100]);
});

test("semantic answerability phased gate writes phase-specific reports beside summary", () => {
  assert.equal(
    phaseOutputPath("storage/training/production-semantic-answerability-phased-gate-v1.json", 50),
    "storage/training/production-semantic-answerability-phased-gate-v1-limit50.json"
  );
});

test("semantic answerability first 150 cases stay source-backed for humiliating factual coverage", () => {
  const first50 = GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.slice(0, 50);
  const first100 = GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.slice(0, 100);
  const first150 = GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.slice(0, 150);

  assert.equal(first50.every((item) => item.expected.kind === "source_backed"), true);
  assert.equal(first100.every((item) => item.expected.kind === "source_backed"), true);
  assert.equal(first150.every((item) => item.expected.kind === "source_backed"), true);
  assert.ok(first100.some((item) => item.id.startsWith("bio_")));
  assert.ok(first100.some((item) => item.id.startsWith("science_")));
  assert.ok(first100.some((item) => item.id.startsWith("history_")));
  assert.ok(first150.some((item) => item.id.startsWith("adversarial_")));
});

test("semantic answerability phased summary fails when any completed phase fails", () => {
  const report = buildSemanticAnswerabilityPhasedReport(
    {
      baseUrl: "https://app.hydria.click",
      phases: [50, 100]
    },
    [
      {
        limit: 50,
        output: "phase50.json",
        completed: 50,
        passed: 49,
        failed: 1,
        passRate: 98,
        avgSemanticRelevanceScore: 96,
        avgDurationMs: 1000,
        durationMs: 50000,
        issueCounts: { semantic_missing_mechanism_answer: 1 },
        failures: [{ id: "science_motor_fr", issues: ["semantic_missing_mechanism_answer"], answer: "thin" }]
      }
    ]
  );

  assert.equal(report.passed, false);
  assert.equal(report.finalLimit, 50);
  assert.equal(report.failedPhaseCount, 1);
  assert.equal(report.issueCounts.semantic_missing_mechanism_answer, 1);
});

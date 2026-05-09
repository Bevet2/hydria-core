import test from "node:test";
import assert from "node:assert/strict";
import { buildHydriaQualityDiagnostics } from "../scripts/runHydriaQualityDiagnostics.js";

test("quality diagnostics counts benchmark quality risks", () => {
  const diagnostics = buildHydriaQualityDiagnostics({
    version: "probe",
    items: [
      {
        id: "bad_lang",
        prompt: "Explique les APIs simplement.",
        category: "other",
        output: {
          answer: "The API is a contract between software systems.",
          keyPoints: ["English answer"],
          assumptions: [],
          confidence: 80
        },
        observations: []
      },
      {
        id: "broken",
        prompt: "Explain queues.",
        category: "other",
        output: {
          answer: ",key_points",
          keyPoints: ["key_points"],
          assumptions: [],
          confidence: 90
        },
        observations: []
      },
      {
        id: "live",
        prompt: "What is the current BTC price?",
        category: "other",
        toolRouting: {
          toolRequired: true,
          toolType: "finance",
          intent: "current_price",
          fallbackAllowed: false,
          toolResultUsed: false
        },
        research: {
          used: true,
          toolResultUsed: false,
          noReliableSource: true,
          sourceCount: 0
        },
        output: {
          answer: "The current BTC price is 39851 USD.",
          keyPoints: ["39851 USD"],
          assumptions: [],
          confidence: 88
        },
        observations: []
      }
    ]
  });

  assert.equal(diagnostics.totals.completed, 3);
  assert.equal(diagnostics.counts.wrongLanguage, 1);
  assert.equal(diagnostics.counts.brokenAnswer, 1);
  assert.equal(diagnostics.counts.toolRequiredButNotUsed, 1);
  assert.equal(diagnostics.counts.noReliableSource, 1);
  assert.equal(diagnostics.counts.liveHallucinationRisk, 1);
  assert.ok(diagnostics.counts.otherCategory < diagnostics.counts.storedOtherCategory);
  assert.ok(diagnostics.examples.length >= 3);
});

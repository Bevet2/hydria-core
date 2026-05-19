import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatCapabilityCoverageReport,
  chatCapabilityCoverageCases,
  selectChatCapabilityCoverageCases,
  type ChatCapabilityCoverageCaseResult
} from "../scripts/runChatCapabilityCoverageGate.js";

test("chat capability gate selects deterministic offset and limit slices", () => {
  const selected = selectChatCapabilityCoverageCases({
    caseIds: [],
    offset: 1,
    limit: 2
  });

  assert.deepEqual(
    selected.map((testCase) => testCase.id),
    chatCapabilityCoverageCases.slice(1, 3).map((testCase) => testCase.id)
  );
});

test("chat capability gate selects explicit case ids before slicing", () => {
  const requested = [
    "tool_calculator_fr",
    "recipe_tiramisu_fr",
    "incident_payment_rollback_fr"
  ];
  const selected = selectChatCapabilityCoverageCases({
    caseIds: requested,
    offset: 1,
    limit: 1
  });

  assert.deepEqual(
    selected.map((testCase) => testCase.id),
    ["recipe_tiramisu_fr"]
  );
});

test("chat capability gate rejects unknown case ids", () => {
  assert.throws(
    () =>
      selectChatCapabilityCoverageCases({
        caseIds: ["missing_case"],
        offset: 0,
        limit: null
      }),
    /Unknown chat capability gate case id/
  );
});

test("chat capability coverage report keeps capability and provider diagnostics", () => {
  const result: ChatCapabilityCoverageCaseResult = {
    id: "tool_calculator_fr",
    capability: "calculator_tool",
    passed: true,
    issues: [],
    finalAnswer: "444",
    turns: [
      {
        index: 0,
        message: "Calcule 12 * 37.",
        answer: "444",
        provider: "tool",
        model: "calculator",
        budgetProfile: "fast_tool",
        runtimeMode: "direct",
        toolType: "calculator",
        toolUsed: true,
        toolRequired: true,
        qualityPassed: true,
        staticFallback: false,
        cloudRuntime: false,
        durationMs: 50,
        attempts: 1,
        issues: []
      }
    ]
  };

  const report = buildChatCapabilityCoverageReport({
    baseUrl: "https://app.hydria.click",
    results: [result],
    startedAt: Date.now()
  });

  assert.equal(report.passed, true);
  assert.equal(report.summary.passRate, 100);
  assert.equal(report.summary.byCapability.calculator_tool, 1);
  assert.equal(report.summary.byProvider.tool, 1);
  assert.equal(report.summary.toolExpectedButNotUsed, 0);
});

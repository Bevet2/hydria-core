import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChatCapabilityCoverageReport,
  chatCapabilityCoverageCases,
  selectChatCapabilityCoverageCases,
  type ChatCapabilityCoverageCaseResult
} from "../scripts/runChatCapabilityCoverageGate.js";
import { runSegmentedChatCapabilityCoverageGate } from "../scripts/runSegmentedChatCapabilityCoverageGate.js";

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

test("segmented chat capability gate resumes segments and writes aggregate report", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-chat-capability-gate-"));
  const segmentsDir = join(tempRoot, "segments");
  const output = join(tempRoot, "aggregate.json");

  const resultA: ChatCapabilityCoverageCaseResult = {
    id: "tool_calculator_fr",
    capability: "calculator_tool",
    passed: true,
    issues: [],
    finalAnswer: "444",
    turns: []
  };
  const resultB: ChatCapabilityCoverageCaseResult = {
    id: "tool_recent_ai_fr",
    capability: "current_research_tool",
    passed: false,
    issues: ["missing_expected_term:IA"],
    finalAnswer: "",
    turns: []
  };

  try {
    await mkdir(segmentsDir, { recursive: true });
    await writeFile(
      join(segmentsDir, "segment-01-tool_calculator_fr-to-tool_calculator_fr.json"),
      `${JSON.stringify({ passed: true, results: [resultA] }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      join(segmentsDir, "segment-02-tool_recent_ai_fr-to-tool_recent_ai_fr.json"),
      `${JSON.stringify({ passed: false, results: [resultB] }, null, 2)}\n`,
      "utf8"
    );

    const report = await runSegmentedChatCapabilityCoverageGate({
      baseUrl: "https://example.test",
      output,
      segmentsDir,
      timeoutMs: 1,
      segmentSize: 1,
      offset: 0,
      limit: 2,
      caseIds: [],
      delayMs: 0,
      resume: true,
      apiKey: ""
    });
    const persisted = JSON.parse(await readFile(output, "utf8")) as typeof report;

    assert.equal(report.passed, false);
    assert.equal(persisted.runner.complete, true);
    assert.equal(persisted.runner.completedSegments, 2);
    assert.equal(persisted.runner.resumedSegments, 2);
    assert.deepEqual(persisted.failedCaseIds, ["tool_recent_ai_fr"]);
    assert.deepEqual(
      persisted.runner.segments.map((segment) => ({
        resumed: segment.resumed,
        failedCases: segment.failedCases,
        failedCaseIds: segment.failedCaseIds
      })),
      [
        { resumed: true, failedCases: 0, failedCaseIds: [] },
        { resumed: true, failedCases: 1, failedCaseIds: ["tool_recent_ai_fr"] }
      ]
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

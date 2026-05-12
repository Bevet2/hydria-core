import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChatRuntimeSloGateReport,
  type ChatRuntimeSloCaseResult,
  type ChatRuntimeSloThresholds
} from "../scripts/runChatRuntimeSloGate.js";

const thresholds: ChatRuntimeSloThresholds = {
  maxP95LatencyMs: 60000,
  maxRetryRate: 10,
  maxStaticFallbackRate: 0,
  maxCloudRuntimeRate: 0,
  maxWrongLanguageRate: 0,
  maxQualityFailureRate: 0,
  minTraceCoverageRate: 100
};

function result(overrides: Partial<ChatRuntimeSloCaseResult> = {}): ChatRuntimeSloCaseResult {
  return {
    id: "case",
    passed: true,
    issues: [],
    turns: [
      {
        prompt: "Calcule 12 * 37.",
        answer: "444",
        provider: "tool",
        model: "calculator",
        budgetProfile: "fast_tool",
        runtimeMode: "direct",
        durationMs: 120,
        usedRetry: false,
        usedStaticFallback: false,
        cloudRuntime: false,
        wrongLanguage: false,
        qualityPassed: true,
        traceComplete: true,
        traceStepIds: ["language_context", "task_routing", "tool_routing", "model_selection", "quality_gate"],
        issues: []
      }
    ],
    ...overrides
  };
}

test("chat runtime SLO report passes clean local traced turns", () => {
  const report = buildChatRuntimeSloGateReport({
    baseUrl: "https://app.hydria.click",
    results: [result()],
    thresholds,
    startedAt: Date.now()
  });

  assert.equal(report.passed, true);
  assert.equal(report.summary.traceCoverageRate, 100);
  assert.equal(report.summary.staticFallbackRate, 0);
  assert.equal(report.summary.cloudRuntimeRate, 0);
});

test("chat runtime SLO report blocks fallback, trace loss, and latency regression", () => {
  const report = buildChatRuntimeSloGateReport({
    baseUrl: "https://app.hydria.click",
    results: [
      result({
        passed: false,
        issues: ["static_fallback", "missing_trace_step:model_selection"],
        turns: [
          {
            prompt: "Question",
            answer: "Je n'ai pas reussi a generer une reponse fiable.",
            provider: "fallback",
            model: "qwen2.5:3b",
            budgetProfile: "standard_light_chat",
            runtimeMode: "direct",
            durationMs: 70000,
            usedRetry: true,
            usedStaticFallback: true,
            cloudRuntime: false,
            wrongLanguage: false,
            qualityPassed: false,
            traceComplete: false,
            traceStepIds: ["language_context"],
            issues: ["static_fallback", "missing_trace_step:model_selection"]
          }
        ]
      })
    ],
    thresholds,
    startedAt: Date.now()
  });

  assert.equal(report.passed, false);
  assert.equal(report.blockers.some((blocker) => blocker.startsWith("failed_cases:")), true);
  assert.equal(report.blockers.some((blocker) => blocker.startsWith("p95_latency:")), true);
  assert.equal(report.blockers.some((blocker) => blocker.startsWith("static_fallback_rate:")), true);
  assert.equal(report.blockers.some((blocker) => blocker.startsWith("trace_coverage_rate:")), true);
});

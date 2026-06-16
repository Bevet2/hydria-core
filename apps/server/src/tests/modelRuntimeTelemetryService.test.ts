import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelRuntimeTelemetryService } from "../services/models/modelRuntimeTelemetryService.js";

async function withTelemetryFile<T>(fn: (service: ModelRuntimeTelemetryService) => Promise<T>) {
  const dir = await mkdtemp(join(tmpdir(), "hydria-model-ops-"));
  try {
    return await fn(new ModelRuntimeTelemetryService(join(dir, "events.jsonl")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("model runtime telemetry summarizes latency, retries, providers, and roles", async () => {
  await withTelemetryFile(async (service) => {
    await service.writeEventsForTest([
      {
        scope: "public_chat",
        status: "success",
        provider: "ollama",
        model: "qwen2.5:14b",
        capabilityId: "qwen-14b-instruct-main",
        specialistRole: "primary_brain",
        category: "other",
        runtimeMode: "direct",
        durationMs: 60000,
        retryUsed: false,
        attemptCount: 1,
        staticFallbackUsed: false,
        toolUsed: false,
        toolRequired: false,
        qualityPassed: true,
        issues: []
      },
      {
        scope: "public_chat",
        status: "success",
        provider: "ollama",
        model: "deepseek-r1:14b",
        capabilityId: "deepseek-r1-distill-qwen-reasoner",
        specialistRole: "deep_reasoner",
        category: "mixed_reasoning",
        runtimeMode: "conversation",
        durationMs: 90000,
        retryUsed: true,
        attemptCount: 2,
        staticFallbackUsed: false,
        toolUsed: true,
        toolRequired: true,
        qualityPassed: true,
        issues: ["retry"]
      }
    ]);

    const summary = await service.buildSummary();

    assert.equal(summary.window.eventCount, 2);
    assert.equal(summary.totals.localOllamaRate, 100);
    assert.equal(summary.totals.retryRate, 50);
    assert.equal(summary.totals.deepReasoningRate, 50);
    assert.equal(summary.totals.toolUseRate, 50);
    assert.equal(summary.byRole.primary_brain?.count, 1);
    assert.equal(summary.byRole.deep_reasoner?.count, 1);
    assert.equal(summary.recentEvents.length, 2);
  });
});

test("model runtime telemetry filters summaries by time window before applying the limit", async () => {
  await withTelemetryFile(async (service) => {
    await service.writeEventsForTest([
      {
        createdAt: "2026-05-12T10:00:00.000Z",
        scope: "public_chat",
        status: "fallback",
        provider: "fallback",
        model: "qwen2.5:14b",
        capabilityId: "qwen-14b-instruct-main",
        specialistRole: "primary_brain",
        category: "other",
        runtimeMode: "direct",
        durationMs: 60000,
        retryUsed: true,
        attemptCount: 2,
        staticFallbackUsed: true,
        toolUsed: false,
        toolRequired: false,
        qualityPassed: false,
        issues: ["old_failure"]
      },
      {
        createdAt: "2026-05-12T11:00:00.000Z",
        scope: "public_chat",
        status: "success",
        provider: "ollama",
        model: "gemma3n:e4b",
        capabilityId: "gemma-e4b-router",
        specialistRole: "fast_router",
        category: "other",
        runtimeMode: "direct",
        durationMs: 12000,
        retryUsed: false,
        attemptCount: 1,
        staticFallbackUsed: false,
        toolUsed: false,
        toolRequired: false,
        qualityPassed: true,
        issues: []
      }
    ]);

    const summary = await service.buildSummary({
      limit: 10,
      since: "2026-05-12T10:30:00.000Z"
    });

    assert.equal(summary.window.eventCount, 1);
    assert.equal(summary.window.since, "2026-05-12T10:30:00.000Z");
    assert.equal(summary.totals.staticFallbackRate, 0);
    assert.equal(summary.recentEvents[0]?.model, "gemma3n:e4b");
  });
});

test("model runtime ops gate blocks cloud runtime events and empty telemetry", async () => {
  await withTelemetryFile(async (service) => {
    const empty = service.buildGateReport(await service.buildSummary());
    assert.equal(empty.passed, false);
    assert.equal(empty.blockers.includes("not_enough_model_runtime_events"), true);

    await service.writeEventsForTest([
      {
        scope: "model_completion",
        status: "success",
        provider: "openrouter",
        model: "qwen/qwen-2.5-14b-instruct",
        capabilityId: "qwen-14b-instruct-main",
        specialistRole: "primary_brain",
        category: "architecture_design",
        runtimeMode: null,
        durationMs: 1200,
        retryUsed: false,
        attemptCount: 1,
        staticFallbackUsed: false,
        toolUsed: false,
        toolRequired: false,
        qualityPassed: null,
        issues: []
      }
    ]);

    const report = service.buildGateReport(await service.buildSummary());
    assert.equal(report.passed, false);
    assert.equal(report.blockers.includes("cloud_runtime_event_detected"), true);
  });
});

test("model runtime ops gate passes healthy local-only telemetry", async () => {
  await withTelemetryFile(async (service) => {
    await service.writeEventsForTest([
      {
        scope: "public_chat",
        status: "success",
        provider: "ollama",
        model: "mistral:7b",
        capabilityId: "mistral-mixtral-business",
        specialistRole: "writing_business",
        category: "operational_writing",
        runtimeMode: "direct",
        durationMs: 20000,
        retryUsed: false,
        attemptCount: 1,
        staticFallbackUsed: false,
        toolUsed: false,
        toolRequired: false,
        qualityPassed: true,
        issues: []
      }
    ]);

    const report = service.buildGateReport(await service.buildSummary());
    assert.equal(report.passed, true);
    assert.deepEqual(report.blockers, []);
  });
});

test("model runtime ops gate blocks over-budget profile latency", async () => {
  await withTelemetryFile(async (service) => {
    await service.writeEventsForTest([
      {
        scope: "public_chat",
        status: "success",
        provider: "ollama",
        model: "qwen2.5:14b",
        capabilityId: "qwen-14b-instruct-main",
        specialistRole: "primary_brain",
        category: "other",
        runtimeMode: "direct",
        durationMs: 60000,
        retryUsed: false,
        attemptCount: 1,
        staticFallbackUsed: false,
        toolUsed: false,
        toolRequired: false,
        qualityPassed: true,
        budgetProfile: "standard_chat",
        timeoutMs: 30000,
        budgetExceeded: true,
        issues: []
      }
    ]);

    const report = service.buildGateReport(await service.buildSummary(), {
      maxStandardP95LatencyMs: 45000
    });
    assert.equal(report.passed, false);
    assert.equal(report.blockers.includes("standard_chat_budget_p95_latency_exceeded"), true);
    assert.equal(report.warnings.includes("recent_model_runtime_budget_exceeded"), true);
  });
});

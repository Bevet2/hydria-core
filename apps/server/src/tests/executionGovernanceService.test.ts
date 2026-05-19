import assert from "node:assert/strict";
import test from "node:test";
import { executionSensitivePathGatePack } from "../data/executionSensitivePathGatePack.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";
import { ExecutionGovernanceService } from "../services/execution/executionGovernanceService.js";
import { LocalToolExecutionService } from "../services/tools/localToolExecutionService.js";
import type { ToolRoutingDecision } from "../types/arena.js";

const fixedNow = () => new Date("2026-05-20T12:00:00.000Z");

function fileRouting(intent = "file_analysis"): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "file",
    intent,
    confidence: 0.9,
    fallbackAllowed: false,
    reason: "A file tool is required.",
    extractedArgs: {},
    toolResultUsed: false
  };
}

function weatherRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "weather",
    intent: "current_weather",
    confidence: 0.92,
    fallbackAllowed: false,
    reason: "Current weather requires a live source.",
    extractedArgs: {
      location: "Paris",
      language: "fr"
    },
    toolResultUsed: false
  };
}

test("execution governance service audits sensitive path contracts without real execution", async () => {
  const auditStore = new ExecutionAuditStore();
  const service = new ExecutionGovernanceService({ auditStore, now: fixedNow });

  for (const gateCase of executionSensitivePathGatePack) {
    const plan = await service.plan(gateCase.request);
    assert.equal(plan.permissionDecision.allowed, gateCase.expected.allowed, gateCase.id);
    assert.equal(plan.request.capability, gateCase.expected.capability, gateCase.id);
    assert.equal(plan.dryRunPlan.noExecution, true, gateCase.id);
    assert.equal(plan.dryRunPlan.steps.some((step) => step.wouldExecute), false, gateCase.id);
    if (gateCase.expected.state) {
      assert.equal(plan.permissionDecision.state, gateCase.expected.state, gateCase.id);
    }
    if (typeof gateCase.expected.rollbackRequired === "boolean") {
      assert.equal(plan.rollbackHint.required, gateCase.expected.rollbackRequired, gateCase.id);
    }
    if (gateCase.expected.denialReason) {
      assert.ok(plan.permissionDecision.denialReasons.includes(gateCase.expected.denialReason), gateCase.id);
    }
  }

  const summary = await auditStore.buildSummary({ limit: 100 });
  assert.equal(summary.window.eventCount, executionSensitivePathGatePack.length);
  assert.equal(summary.totals.realExecutionStepCount, 0);
  assert.equal(summary.totals.sensitiveHeaderLeakCount, 0);
  assert.ok(summary.byActionKind.command_execution?.requiresReviewCount);
  assert.ok(summary.byCapability.fetcher_dynamic_browser?.disabledCount);
});

test("local tool execution emits execution audit for unsupported filesystem candidates", async () => {
  const auditStore = new ExecutionAuditStore();
  const executionGovernanceService = new ExecutionGovernanceService({ auditStore, now: fixedNow });
  const service = new LocalToolExecutionService({ executionGovernanceService });

  const result = await service.tryExecute(fileRouting());
  const summary = await auditStore.buildSummary({ limit: 20 });

  assert.equal(result, null);
  assert.equal(summary.window.eventCount, 1);
  assert.equal(summary.byActionKind.filesystem_read?.count, 1);
  assert.equal(summary.totals.realExecutionStepCount, 0);
});

test("local live tools attach execution audit ids to structured results", async (t) => {
  const auditStore = new ExecutionAuditStore();
  const executionGovernanceService = new ExecutionGovernanceService({ auditStore, now: fixedNow });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("geocoding-api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "Paris",
              country: "France",
              latitude: 48.8566,
              longitude: 2.3522,
              timezone: "Europe/Paris"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          current: {
            time: "2026-05-20T12:00",
            temperature_2m: 19,
            relative_humidity_2m: 45,
            precipitation: 0,
            weather_code: 0,
            wind_speed_10m: 9,
            wind_direction_10m: 200
          },
          daily: {
            temperature_2m_max: [21],
            temperature_2m_min: [12],
            weather_code: [0]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService({ executionGovernanceService });
  const result = await service.tryExecute(weatherRouting());
  const summary = await auditStore.buildSummary({ limit: 20 });

  assert.equal(result?.toolType, "weather");
  assert.equal(result?.executionAuditIds?.length, 1);
  assert.equal(summary.window.eventCount, 1);
  assert.equal(summary.byActionKind.acquisition_fetch?.count, 1);
  assert.equal(summary.byCapability.fetcher_http?.count, 1);
});

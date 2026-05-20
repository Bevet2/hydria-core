import assert from "node:assert/strict";
import test from "node:test";
import { sandboxExecutionGatePack } from "../data/sandboxExecutionGatePack.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";
import { SandboxCommandPolicyService } from "../services/execution/sandboxCommandPolicyService.js";

const fixedNow = () => new Date("2026-05-20T13:00:00.000Z");

test("sandbox command policy enforces whitelist, dry-run, cwd, timeout, and no execution", async () => {
  const auditStore = new ExecutionAuditStore();
  const service = new SandboxCommandPolicyService({ auditStore, now: fixedNow });

  for (const gateCase of sandboxExecutionGatePack) {
    const plan = await service.plan(gateCase.request);
    assert.equal(plan.decision.state, gateCase.expected.state, gateCase.id);
    assert.equal(plan.decision.allowedForDryRun, gateCase.expected.allowedForDryRun, gateCase.id);
    assert.equal(plan.decision.executionAllowed, false, gateCase.id);
    assert.equal(plan.decision.whitelisted, gateCase.expected.whitelisted, gateCase.id);
    assert.equal(plan.decision.destructive, gateCase.expected.destructive, gateCase.id);
    if (gateCase.expected.denialReason) {
      assert.ok(plan.decision.denialReasons.includes(gateCase.expected.denialReason), gateCase.id);
    }
    if (typeof gateCase.expected.timeoutMs === "number") {
      assert.equal(plan.normalized.timeoutMs, gateCase.expected.timeoutMs, gateCase.id);
    }
    assert.equal(plan.auditEvent.dryRunPlan.steps.some((step) => step.wouldExecute), false, gateCase.id);
  }

  const summary = await auditStore.buildSummary({ limit: 100 });
  assert.equal(summary.window.eventCount, sandboxExecutionGatePack.length);
  assert.equal(summary.totals.realExecutionStepCount, 0);
  assert.equal(summary.byActionKind.command_execution?.requiresReviewCount, sandboxExecutionGatePack.length);
});

test("sandbox command policy accepts combined command strings", async () => {
  const service = new SandboxCommandPolicyService({ now: fixedNow });
  const plan = await service.plan({
    requestId: "sandbox-test::combined",
    command: "npm run check",
    cwd: "/workspace/apps/server",
    allowedCwdRoots: ["/workspace"],
    dryRun: true,
    provenance: {
      requestedBy: "test",
      requestId: "sandbox-test::combined",
      source: "unit-test",
      parentTraceId: null,
      reason: "Combined command string parsing."
    }
  });

  assert.equal(plan.normalized.commandName, "npm");
  assert.deepEqual(plan.normalized.args, ["run", "check"]);
  assert.equal(plan.decision.allowedForDryRun, true);
  assert.equal(plan.decision.executionAllowed, false);
});

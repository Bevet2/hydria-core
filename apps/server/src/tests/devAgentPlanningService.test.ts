import assert from "node:assert/strict";
import test from "node:test";
import { devAgentGatePack } from "../data/devAgentGatePack.js";
import { DevAgentPlanningService } from "../services/agents/devAgentPlanningService.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";

const fixedNow = () => new Date("2026-05-20T14:00:00.000Z");

test("dev agent planning service produces OpenDevin-like dry-run contracts without mutation", async () => {
  const auditStore = new ExecutionAuditStore();
  const service = new DevAgentPlanningService({ auditStore, now: fixedNow });

  for (const gateCase of devAgentGatePack) {
    const plan = await service.plan(gateCase.request);
    for (const [capability, expectedState] of Object.entries(gateCase.expected.phaseStates)) {
      assert.equal(
        plan.phases.find((phase) => phase.capability === capability)?.state,
        expectedState,
        `${gateCase.id}:${capability}`
      );
    }
    if (gateCase.expected.blocker) {
      assert.ok(plan.blockers.includes(gateCase.expected.blocker), gateCase.id);
    }
    assert.equal(plan.finalReport.filesModified.length, gateCase.expected.filesModifiedCount, gateCase.id);
    assert.equal(plan.finalReport.testsRun, gateCase.expected.testsRun, gateCase.id);
    assert.equal(plan.finalReport.patchApplied, gateCase.expected.patchApplied, gateCase.id);
    assert.equal(plan.finalReport.fixIterationsRun, 0, gateCase.id);
    assert.equal(plan.finalReport.handoffRequired, true, gateCase.id);
    assert.equal(plan.auditEvents.some((event) => event.dryRunPlan.steps.some((step) => step.wouldExecute)), false);
    assert.equal(plan.sandboxPlans.some((sandboxPlan) => sandboxPlan.decision.executionAllowed), false);
  }

  const summary = await auditStore.buildSummary({ limit: 200 });
  assert.equal(summary.totals.realExecutionStepCount, 0);
  assert.ok(summary.byActionKind.dev_repo_read?.count);
  assert.ok(summary.byActionKind.filesystem_write?.requiresReviewCount);
  assert.ok(summary.byActionKind.command_execution?.requiresReviewCount);
});

test("dev agent full loop reports OS handoff for patch, test, and fix phases", async () => {
  const service = new DevAgentPlanningService({ now: fixedNow });
  const gateCase = devAgentGatePack.find((item) => item.id === "full-dev-loop-stays-os-handoff");
  assert.ok(gateCase);

  const plan = await service.plan(gateCase.request);
  const handoffPhases = plan.phases.filter((phase) =>
    ["apply_patch", "run_tests", "fix_loop"].includes(phase.capability)
  );

  assert.equal(handoffPhases.length, 3);
  assert.equal(handoffPhases.every((phase) => phase.osHandoffRequired), true);
  assert.equal(plan.sandboxPlans[0]?.normalized.display, "npm run test -w @hydria-arena/server");
  assert.equal(plan.finalReport.filesModified.length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { browserAutomationGatePack } from "../data/browserAutomationGatePack.js";
import { BrowserAutomationPolicyService } from "../services/browser/browserAutomationPolicyService.js";
import { BrowserSessionStore } from "../services/browser/browserSessionStore.js";
import { ExecutionPermissionPolicy } from "../services/execution/executionPermissionPolicy.js";
import { ExecutionRollbackPolicy } from "../services/execution/executionRollbackPolicy.js";

const fixedNow = () => new Date("2026-05-20T08:00:00.000Z");

test("browser automation policy prepares allowed navigation as dry-run only", async () => {
  const service = new BrowserAutomationPolicyService({ now: fixedNow });
  const gateCase = browserAutomationGatePack.find((entry) => entry.id === "allowed-domain-navigation");
  assert.ok(gateCase);

  const plan = await service.plan(gateCase.request);

  assert.equal(plan.permissionDecision.allowed, true);
  assert.equal(plan.permissionDecision.state, "dry_run_only");
  assert.equal(plan.capabilityPlan.recommendedCapability, "fetcher_http");
  assert.equal(plan.dryRunPlan.noExecution, true);
  assert.ok(plan.dryRunPlan.steps.every((step) => step.wouldExecute === false));
  assert.equal(plan.policyFlags.noRealExecution, true);
  assert.equal(plan.auditEvent.actionId, gateCase.request.requestId);
});

test("browser automation policy denies forbidden domains and secret/session access", async () => {
  const service = new BrowserAutomationPolicyService({ now: fixedNow });
  const forbidden = browserAutomationGatePack.find((entry) => entry.id === "forbidden-domain-navigation");
  const secret = browserAutomationGatePack.find((entry) => entry.id === "cookie-session-secret-refused");
  assert.ok(forbidden);
  assert.ok(secret);

  const forbiddenPlan = await service.plan(forbidden.request);
  const secretPlan = await service.plan(secret.request);

  assert.equal(forbiddenPlan.permissionDecision.allowed, false);
  assert.ok(forbiddenPlan.permissionDecision.denialReasons.includes("domain_blocked_by_policy"));
  assert.equal(secretPlan.permissionDecision.allowed, false);
  assert.ok(secretPlan.permissionDecision.denialReasons.includes("secret_or_cookie_access_blocked"));
  assert.equal(secretPlan.rollbackHint.required, true);
  assert.equal(Object.keys(secretPlan.acquisitionScore.responseHeaders).includes("set-cookie"), false);
});

test("browser automation policy keeps dynamic and stealth browser capabilities disabled", async () => {
  const service = new BrowserAutomationPolicyService({ now: fixedNow });
  const dynamic = browserAutomationGatePack.find((entry) => entry.id === "dynamic-browser-disabled");
  const stealth = browserAutomationGatePack.find((entry) => entry.id === "stealth-browser-disabled");
  assert.ok(dynamic);
  assert.ok(stealth);

  const dynamicPlan = await service.plan(dynamic.request);
  const stealthPlan = await service.plan(stealth.request);

  assert.equal(dynamicPlan.capabilityPlan.recommendedCapability, "fetcher_dynamic_browser");
  assert.equal(dynamicPlan.permissionDecision.state, "disabled");
  assert.ok(dynamicPlan.permissionDecision.denialReasons.includes("dynamic_browser_disabled"));
  assert.equal(stealthPlan.capabilityPlan.recommendedCapability, "fetcher_stealth_browser");
  assert.equal(stealthPlan.permissionDecision.state, "disabled");
  assert.ok(stealthPlan.permissionDecision.denialReasons.includes("stealth_browser_disabled"));
});

test("browser automation policy selects Scrapling fallback after HTTP parse failure", async () => {
  const service = new BrowserAutomationPolicyService({ now: fixedNow });
  const gateCase = browserAutomationGatePack.find((entry) => entry.id === "scrapling-fallback-after-parse-fail");
  assert.ok(gateCase);

  const plan = await service.plan(gateCase.request);

  assert.equal(plan.permissionDecision.allowed, true);
  assert.equal(plan.capabilityPlan.recommendedCapability, "fetcher_scrapling");
  assert.equal(plan.acquisitionScore.fetchMethod, "fetcher_scrapling");
  assert.equal(plan.acquisitionScore.retryCount, 1);
  assert.ok(plan.acquisitionScore.contentHash);
  assert.equal(plan.rollbackHint.required, false);
});

test("execution permission and rollback policies block command execution contractually", () => {
  const permission = new ExecutionPermissionPolicy();
  const rollback = new ExecutionRollbackPolicy();
  const decision = permission.evaluate({
    actionKind: "command_execution",
    capability: "sandbox_command",
    requestedPermissions: ["shell:run"],
    provenance: {
      requestedBy: "test",
      requestId: "execution-policy::command",
      source: "unit-test",
      parentTraceId: null,
      reason: "Verify command execution remains disabled."
    },
    riskHints: {
      commandExecution: true
    }
  });
  const hint = rollback.buildHint({
    actionKind: "command_execution",
    capability: "sandbox_command",
    riskLevel: decision.riskLevel,
    destructive: false,
    writesState: true
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.riskLevel, "critical");
  assert.ok(decision.denialReasons.includes("system_command_execution_blocked"));
  assert.equal(decision.policyFlags.systemCommandsDisabled, true);
  assert.equal(hint.required, true);
  assert.equal(hint.strategy, "revert_files");
});

test("browser session store keeps proposed sessions as metadata only", () => {
  const store = new BrowserSessionStore({ now: fixedNow });
  const session = store.createSession({
    allowedDomains: ["example.com"],
    notes: ["No browser process is started by this store."],
    ttlMinutes: 30
  });

  assert.equal(session.state, "proposed");
  assert.equal(session.allowedDomains[0], "example.com");
  assert.ok(session.expiresAt);
  assert.equal(store.getSession(session.sessionId)?.state, "proposed");
  assert.equal(store.stopSession(session.sessionId)?.state, "stopped");
});

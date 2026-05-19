import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserAutomationGatePack } from "../data/browserAutomationGatePack.js";
import { BrowserAutomationPolicyService } from "../services/browser/browserAutomationPolicyService.js";
import type { BrowserAutomationPlan } from "../types/browserAutomation.js";

type GateCaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  plan: BrowserAutomationPlan;
};

type BrowserAutomationGovernanceGateReport = {
  version: "hydria-browser-automation-governance-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    caseCount: number;
    passedCount: number;
    failedCount: number;
    dryRunOnlyCount: number;
    deniedCount: number;
    disabledCount: number;
    auditEventCount: number;
  };
  results: GateCaseResult[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "browser-automation-governance-gate-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function hasCompleteProvenance(plan: BrowserAutomationPlan) {
  const provenance = plan.permissionDecision.provenance;
  return Boolean(
    provenance.requestedBy &&
      provenance.requestId &&
      provenance.source &&
      provenance.reason &&
      plan.auditEvent.provenance.requestId === provenance.requestId
  );
}

function hasCompleteScoring(plan: BrowserAutomationPlan) {
  const score = plan.acquisitionScore;
  return Boolean(
    score.extractionTimestamp &&
      score.fetchMethod === plan.capabilityPlan.recommendedCapability &&
      typeof score.retryCount === "number" &&
      typeof score.extractionQualityScore === "number" &&
      typeof score.parseCompletenessScore === "number" &&
      typeof score.trustScore === "number" &&
      "failureReason" in score &&
      "contentHash" in score &&
      score.responseHeaders &&
      !Object.keys(score.responseHeaders).some((header) => /cookie|authorization|api-key/i.test(header))
  );
}

async function evaluateCase(service: BrowserAutomationPolicyService, gateCase: typeof browserAutomationGatePack[number]) {
  const plan = await service.plan(gateCase.request);
  const issues: string[] = [];

  if (plan.permissionDecision.allowed !== gateCase.expected.allowed) {
    issues.push(`allowed:${plan.permissionDecision.allowed}!=${gateCase.expected.allowed}`);
  }
  if (gateCase.expected.state && plan.permissionDecision.state !== gateCase.expected.state) {
    issues.push(`state:${plan.permissionDecision.state}!=${gateCase.expected.state}`);
  }
  if (plan.capabilityPlan.recommendedCapability !== gateCase.expected.capability) {
    issues.push(`capability:${plan.capabilityPlan.recommendedCapability}!=${gateCase.expected.capability}`);
  }
  if (
    typeof gateCase.expected.rollbackRequired === "boolean" &&
    plan.rollbackHint.required !== gateCase.expected.rollbackRequired
  ) {
    issues.push(`rollback:${plan.rollbackHint.required}!=${gateCase.expected.rollbackRequired}`);
  }
  if (
    gateCase.expected.denialReason &&
    !plan.permissionDecision.denialReasons.includes(gateCase.expected.denialReason)
  ) {
    issues.push(`missing_denial:${gateCase.expected.denialReason}`);
  }
  if (!plan.dryRunPlan.noExecution || plan.dryRunPlan.steps.some((step) => step.wouldExecute)) {
    issues.push("dry_run_plan_would_execute");
  }
  if (!plan.policyFlags.noRealExecution || !plan.policyFlags.dryRunOnly) {
    issues.push("missing_no_execution_policy_flags");
  }
  if (!hasCompleteProvenance(plan)) {
    issues.push("incomplete_provenance");
  }
  if (!hasCompleteScoring(plan)) {
    issues.push("incomplete_acquisition_scoring");
  }
  if (!plan.auditEvent.auditId || plan.auditEvent.actionId !== gateCase.request.requestId) {
    issues.push("missing_audit_event");
  }

  return {
    id: gateCase.id,
    passed: issues.length === 0,
    issues,
    plan
  };
}

export async function runBrowserAutomationGovernanceGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const service = new BrowserAutomationPolicyService({
    now: () => new Date("2026-05-20T08:00:00.000Z")
  });
  const results = [];
  for (const gateCase of browserAutomationGatePack) {
    results.push(await evaluateCase(service, gateCase));
  }
  const auditEvents = await service.listAuditEvents();
  const report: BrowserAutomationGovernanceGateReport = {
    version: "hydria-browser-automation-governance-gate-v1",
    generatedAt: new Date().toISOString(),
    passed: results.every((result) => result.passed),
    summary: {
      caseCount: results.length,
      passedCount: results.filter((result) => result.passed).length,
      failedCount: results.filter((result) => !result.passed).length,
      dryRunOnlyCount: results.filter((result) => result.plan.permissionDecision.state === "dry_run_only").length,
      deniedCount: results.filter((result) => result.plan.permissionDecision.state === "denied" || result.plan.permissionDecision.state === "requires_review").length,
      disabledCount: results.filter((result) => result.plan.permissionDecision.state === "disabled").length,
      auditEventCount: auditEvents.length
    },
    results
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        failedCases: report.results
          .filter((result) => !result.passed)
          .map((result) => ({ id: result.id, issues: result.issues })),
        output
      },
      null,
      2
    )
  );

  if (!report.passed) {
    process.exitCode = 1;
  }
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runBrowserAutomationGovernanceGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

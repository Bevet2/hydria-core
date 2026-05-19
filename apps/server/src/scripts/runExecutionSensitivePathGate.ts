import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executionSensitivePathGatePack } from "../data/executionSensitivePathGatePack.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";
import { ExecutionGovernanceService } from "../services/execution/executionGovernanceService.js";
import type { ExecutionGovernancePlan } from "../types/execution.js";

type GateCaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  plan: ExecutionGovernancePlan;
};

type ExecutionSensitivePathGateReport = {
  version: "hydria-execution-sensitive-path-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    caseCount: number;
    passedCount: number;
    failedCount: number;
    auditEventCount: number;
    dryRunOnlyCount: number;
    deniedOrReviewCount: number;
    disabledCount: number;
    rollbackRequiredCount: number;
    realExecutionStepCount: number;
    sensitiveHeaderLeakCount: number;
  };
  results: GateCaseResult[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "execution-sensitive-path-gate-v1.json");
const defaultAuditFile = resolve(projectRoot, "storage", "training", "execution-sensitive-path-gate-events.jsonl");

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

function hasCompleteProvenance(plan: ExecutionGovernancePlan) {
  const provenance = plan.permissionDecision.provenance;
  return Boolean(
    provenance.requestedBy &&
      provenance.requestId &&
      provenance.source &&
      provenance.reason &&
      plan.auditEvent.provenance.requestId === provenance.requestId
  );
}

async function evaluateCase(
  service: ExecutionGovernanceService,
  gateCase: typeof executionSensitivePathGatePack[number]
): Promise<GateCaseResult> {
  const plan = await service.plan(gateCase.request);
  const issues: string[] = [];

  if (plan.permissionDecision.allowed !== gateCase.expected.allowed) {
    issues.push(`allowed:${plan.permissionDecision.allowed}!=${gateCase.expected.allowed}`);
  }
  if (gateCase.expected.state && plan.permissionDecision.state !== gateCase.expected.state) {
    issues.push(`state:${plan.permissionDecision.state}!=${gateCase.expected.state}`);
  }
  if (plan.request.capability !== gateCase.expected.capability) {
    issues.push(`capability:${plan.request.capability}!=${gateCase.expected.capability}`);
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
  if (!plan.auditEvent.auditId || plan.auditEvent.actionId !== gateCase.request.actionId) {
    issues.push("missing_audit_event");
  }

  return {
    id: gateCase.id,
    passed: issues.length === 0,
    issues,
    plan
  };
}

export async function runExecutionSensitivePathGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const auditFile = resolve(projectRoot, readOption(argv, "--audit-file") ?? defaultAuditFile);
  await mkdir(dirname(auditFile), { recursive: true });
  await writeFile(auditFile, "", "utf8");
  const auditStore = new ExecutionAuditStore({
    filePath: auditFile,
    maxEvents: 200
  });
  const service = new ExecutionGovernanceService({
    auditStore,
    now: () => new Date("2026-05-20T12:00:00.000Z")
  });

  const results: GateCaseResult[] = [];
  for (const gateCase of executionSensitivePathGatePack) {
    results.push(await evaluateCase(service, gateCase));
  }
  const auditSummary = await auditStore.buildSummary({ limit: 200 });
  const report: ExecutionSensitivePathGateReport = {
    version: "hydria-execution-sensitive-path-gate-v1",
    generatedAt: new Date().toISOString(),
    passed:
      results.every((result) => result.passed) &&
      auditSummary.totals.realExecutionStepCount === 0 &&
      auditSummary.totals.sensitiveHeaderLeakCount === 0,
    summary: {
      caseCount: results.length,
      passedCount: results.filter((result) => result.passed).length,
      failedCount: results.filter((result) => !result.passed).length,
      auditEventCount: auditSummary.window.eventCount,
      dryRunOnlyCount: auditSummary.totals.dryRunOnlyCount,
      deniedOrReviewCount: auditSummary.totals.deniedCount + auditSummary.totals.requiresReviewCount,
      disabledCount: auditSummary.totals.disabledCount,
      rollbackRequiredCount: auditSummary.totals.rollbackRequiredCount,
      realExecutionStepCount: auditSummary.totals.realExecutionStepCount,
      sensitiveHeaderLeakCount: auditSummary.totals.sensitiveHeaderLeakCount
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
        output,
        auditFile
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
  runExecutionSensitivePathGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxExecutionGatePack } from "../data/sandboxExecutionGatePack.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";
import { SandboxCommandPolicyService } from "../services/execution/sandboxCommandPolicyService.js";
import type { SandboxCommandPlan } from "../types/sandboxExecution.js";

type GateCaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  plan: SandboxCommandPlan;
};

type SandboxExecutionGateReport = {
  version: "hydria-sandbox-execution-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    caseCount: number;
    passedCount: number;
    failedCount: number;
    auditEventCount: number;
    plannedDryRuns: number;
    blockedCount: number;
    realExecutionStepCount: number;
    sensitiveHeaderLeakCount: number;
  };
  results: GateCaseResult[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "sandbox-execution-gate-v1.json");
const defaultAuditFile = resolve(projectRoot, "storage", "training", "sandbox-execution-gate-events.jsonl");

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

async function evaluateCase(
  service: SandboxCommandPolicyService,
  gateCase: typeof sandboxExecutionGatePack[number]
): Promise<GateCaseResult> {
  const plan = await service.plan(gateCase.request);
  const issues: string[] = [];
  if (plan.decision.state !== gateCase.expected.state) {
    issues.push(`state:${plan.decision.state}!=${gateCase.expected.state}`);
  }
  if (plan.decision.allowedForDryRun !== gateCase.expected.allowedForDryRun) {
    issues.push(`allowedForDryRun:${plan.decision.allowedForDryRun}!=${gateCase.expected.allowedForDryRun}`);
  }
  if (plan.decision.executionAllowed !== false) {
    issues.push("execution_allowed");
  }
  if (plan.decision.whitelisted !== gateCase.expected.whitelisted) {
    issues.push(`whitelisted:${plan.decision.whitelisted}!=${gateCase.expected.whitelisted}`);
  }
  if (plan.decision.destructive !== gateCase.expected.destructive) {
    issues.push(`destructive:${plan.decision.destructive}!=${gateCase.expected.destructive}`);
  }
  if (gateCase.expected.denialReason && !plan.decision.denialReasons.includes(gateCase.expected.denialReason)) {
    issues.push(`missing_denial:${gateCase.expected.denialReason}`);
  }
  if (typeof gateCase.expected.timeoutMs === "number" && plan.normalized.timeoutMs !== gateCase.expected.timeoutMs) {
    issues.push(`timeout:${plan.normalized.timeoutMs}!=${gateCase.expected.timeoutMs}`);
  }
  if (plan.auditEvent.dryRunPlan.steps.some((step) => step.wouldExecute)) {
    issues.push("audit_plan_would_execute");
  }
  return {
    id: gateCase.id,
    passed: issues.length === 0,
    issues,
    plan
  };
}

export async function runSandboxExecutionGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const auditFile = resolve(projectRoot, readOption(argv, "--audit-file") ?? defaultAuditFile);
  await mkdir(dirname(auditFile), { recursive: true });
  await writeFile(auditFile, "", "utf8");
  const auditStore = new ExecutionAuditStore({
    filePath: auditFile,
    maxEvents: 100
  });
  const service = new SandboxCommandPolicyService({
    auditStore,
    now: () => new Date("2026-05-20T13:00:00.000Z")
  });
  const results = [];
  for (const gateCase of sandboxExecutionGatePack) {
    results.push(await evaluateCase(service, gateCase));
  }
  const auditSummary = await auditStore.buildSummary({ limit: 100 });
  const report: SandboxExecutionGateReport = {
    version: "hydria-sandbox-execution-gate-v1",
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
      plannedDryRuns: results.filter((result) => result.plan.decision.state === "dry_run_planned").length,
      blockedCount: results.filter((result) => result.plan.decision.state === "blocked").length,
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
  runSandboxExecutionGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

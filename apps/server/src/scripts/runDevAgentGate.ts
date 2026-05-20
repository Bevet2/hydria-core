import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devAgentGatePack } from "../data/devAgentGatePack.js";
import { DevAgentPlanningService } from "../services/agents/devAgentPlanningService.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";
import type { DevAgentPlan } from "../types/devAgent.js";

type GateCaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  plan: DevAgentPlan;
};

type DevAgentGateReport = {
  version: "hydria-dev-agent-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    caseCount: number;
    passedCount: number;
    failedCount: number;
    auditEventCount: number;
    sandboxPlanCount: number;
    filesModifiedCount: number;
    testsRunCount: number;
    patchAppliedCount: number;
    realExecutionStepCount: number;
  };
  results: GateCaseResult[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "dev-agent-gate-v1.json");
const defaultAuditFile = resolve(projectRoot, "storage", "training", "dev-agent-gate-events.jsonl");

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
  service: DevAgentPlanningService,
  gateCase: typeof devAgentGatePack[number]
): Promise<GateCaseResult> {
  const plan = await service.plan(gateCase.request);
  const issues: string[] = [];
  for (const [capability, expectedState] of Object.entries(gateCase.expected.phaseStates)) {
    const actual = plan.phases.find((phase) => phase.capability === capability)?.state;
    if (actual !== expectedState) {
      issues.push(`phase:${capability}:${actual}!=${expectedState}`);
    }
  }
  if (gateCase.expected.blocker && !plan.blockers.includes(gateCase.expected.blocker)) {
    issues.push(`missing_blocker:${gateCase.expected.blocker}`);
  }
  if (plan.finalReport.filesModified.length !== gateCase.expected.filesModifiedCount) {
    issues.push(`filesModified:${plan.finalReport.filesModified.length}!=${gateCase.expected.filesModifiedCount}`);
  }
  if (plan.finalReport.testsRun !== gateCase.expected.testsRun) {
    issues.push(`testsRun:${plan.finalReport.testsRun}!=${gateCase.expected.testsRun}`);
  }
  if (plan.finalReport.patchApplied !== gateCase.expected.patchApplied) {
    issues.push(`patchApplied:${plan.finalReport.patchApplied}!=${gateCase.expected.patchApplied}`);
  }
  if (plan.auditEvents.some((event) => event.dryRunPlan.steps.some((step) => step.wouldExecute))) {
    issues.push("audit_plan_would_execute");
  }
  if (plan.sandboxPlans.some((sandboxPlan) => sandboxPlan.decision.executionAllowed)) {
    issues.push("sandbox_execution_allowed");
  }
  return {
    id: gateCase.id,
    passed: issues.length === 0,
    issues,
    plan
  };
}

export async function runDevAgentGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const auditFile = resolve(projectRoot, readOption(argv, "--audit-file") ?? defaultAuditFile);
  await mkdir(dirname(auditFile), { recursive: true });
  await writeFile(auditFile, "", "utf8");
  const auditStore = new ExecutionAuditStore({
    filePath: auditFile,
    maxEvents: 200
  });
  const service = new DevAgentPlanningService({
    auditStore,
    now: () => new Date("2026-05-20T14:00:00.000Z")
  });
  const results = [];
  for (const gateCase of devAgentGatePack) {
    results.push(await evaluateCase(service, gateCase));
  }
  const auditSummary = await auditStore.buildSummary({ limit: 200 });
  const report: DevAgentGateReport = {
    version: "hydria-dev-agent-gate-v1",
    generatedAt: new Date().toISOString(),
    passed: results.every((result) => result.passed) && auditSummary.totals.realExecutionStepCount === 0,
    summary: {
      caseCount: results.length,
      passedCount: results.filter((result) => result.passed).length,
      failedCount: results.filter((result) => !result.passed).length,
      auditEventCount: auditSummary.window.eventCount,
      sandboxPlanCount: results.reduce((count, result) => count + result.plan.sandboxPlans.length, 0),
      filesModifiedCount: results.reduce((count, result) => count + result.plan.finalReport.filesModified.length, 0),
      testsRunCount: results.filter((result) => result.plan.finalReport.testsRun).length,
      patchAppliedCount: results.filter((result) => result.plan.finalReport.patchApplied).length,
      realExecutionStepCount: auditSummary.totals.realExecutionStepCount
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
  runDevAgentGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

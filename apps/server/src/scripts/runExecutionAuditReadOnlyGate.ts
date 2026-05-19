import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browserAutomationGatePack } from "../data/browserAutomationGatePack.js";
import { BrowserAutomationPolicyService } from "../services/browser/browserAutomationPolicyService.js";
import { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";

type ExecutionAuditReadOnlyGateReport = {
  version: "hydria-execution-audit-readonly-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: Awaited<ReturnType<ExecutionAuditStore["buildSummary"]>>;
  checks: Array<{
    id: string;
    passed: boolean;
    details: string;
  }>;
  output: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "execution-audit-readonly-gate-v1.json");
const defaultAuditFile = resolve(projectRoot, "storage", "training", "execution-audit-readonly-gate-events.jsonl");

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

function check(id: string, passed: boolean, details: string) {
  return { id, passed, details };
}

export async function runExecutionAuditReadOnlyGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const auditFile = resolve(projectRoot, readOption(argv, "--audit-file") ?? defaultAuditFile);
  await mkdir(dirname(auditFile), { recursive: true });
  await writeFile(auditFile, "", "utf8");
  const auditStore = new ExecutionAuditStore({
    filePath: auditFile,
    maxEvents: 100
  });
  const service = new BrowserAutomationPolicyService({
    auditStore,
    now: () => new Date("2026-05-20T09:00:00.000Z")
  });

  for (const gateCase of browserAutomationGatePack) {
    await service.plan(gateCase.request);
  }

  const summary = await auditStore.buildSummary({ limit: 100 });
  const firstEvent = summary.recentEvents.at(-1) ?? null;
  const fetchedEvent = firstEvent ? await auditStore.getById(firstEvent.auditId) : null;
  const checks = [
    check("events_persisted", summary.window.eventCount === browserAutomationGatePack.length, `${summary.window.eventCount} events`),
    check("read_by_id", Boolean(firstEvent && fetchedEvent?.auditId === firstEvent.auditId), firstEvent?.auditId ?? "none"),
    check("no_sensitive_headers", summary.totals.sensitiveHeaderLeakCount === 0, `${summary.totals.sensitiveHeaderLeakCount} leaks`),
    check("no_real_execution_steps", summary.totals.realExecutionStepCount === 0, `${summary.totals.realExecutionStepCount} real steps`),
    check("dry_run_present", summary.totals.dryRunOnlyCount >= 1, `${summary.totals.dryRunOnlyCount} dry-run events`),
    check("denials_present", summary.totals.deniedCount + summary.totals.requiresReviewCount >= 1, `${summary.totals.deniedCount + summary.totals.requiresReviewCount} denials/reviews`),
    check("disabled_present", summary.totals.disabledCount >= 1, `${summary.totals.disabledCount} disabled events`),
    check("rollback_visible", summary.totals.rollbackRequiredCount >= 1, `${summary.totals.rollbackRequiredCount} rollback-required events`)
  ];

  const report: ExecutionAuditReadOnlyGateReport = {
    version: "hydria-execution-audit-readonly-gate-v1",
    generatedAt: new Date().toISOString(),
    passed: checks.every((item) => item.passed),
    summary,
    checks,
    output
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        eventCount: summary.window.eventCount,
        checks,
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
  runExecutionAuditReadOnlyGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

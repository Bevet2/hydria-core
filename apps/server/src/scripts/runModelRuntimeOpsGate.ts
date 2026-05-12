import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ModelRuntimeTelemetryService,
  type ModelRuntimeOpsGateThresholds
} from "../services/models/modelRuntimeTelemetryService.js";

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "model-runtime-ops-gate-v1.json");

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

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function numberOption(argv: string[], name: string, fallback: number) {
  const value = Number(readOption(argv, name));
  return Number.isFinite(value) ? value : fallback;
}

export async function runModelRuntimeOpsGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const limit = numberOption(argv, "--limit", 500);
  const allowEmpty = hasFlag(argv, "--allow-empty");
  const thresholds: ModelRuntimeOpsGateThresholds = {
    minEvents: allowEmpty ? 0 : numberOption(argv, "--min-events", 1),
    maxP95LatencyMs: numberOption(argv, "--max-p95-ms", 300000),
    maxRetryRate: numberOption(argv, "--max-retry-rate", 35),
    maxStaticFallbackRate: numberOption(argv, "--max-static-fallback-rate", 10),
    maxDeepReasoningRate: numberOption(argv, "--max-deep-rate", 40),
    requireLocalOnly: !hasFlag(argv, "--allow-cloud-runtime")
  };
  const service = new ModelRuntimeTelemetryService();
  const summary = await service.buildSummary(limit);
  const report = service.buildGateReport(summary, thresholds);

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        totals: report.summary.totals,
        eventCount: report.summary.window.eventCount,
        blockers: report.blockers,
        warnings: report.warnings,
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
  runModelRuntimeOpsGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

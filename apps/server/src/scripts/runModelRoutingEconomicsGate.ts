import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildModelRoutingEconomicsGateReport,
  ModelRoutingGovernanceService
} from "../services/models/modelRoutingGovernanceService.js";
import { modelRoutingEconomicsEvalPack } from "../data/modelRoutingEconomicsEvalPack.js";

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "model-routing-economics-gate-v1.json");

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

export async function runModelRoutingEconomicsGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const allowFailures = hasFlag(argv, "--allow-failures");
  const service = new ModelRoutingGovernanceService();
  const report = service.buildReport(modelRoutingEconomicsEvalPack);

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        failedCases: report.results
          .filter((result) => result.status === "failed")
          .map((result) => ({
            id: result.id,
            issues: result.issues
          })),
        output
      },
      null,
      2
    )
  );

  if (!report.passed && !allowFailures) {
    process.exitCode = 1;
  }
  return report;
}

export { buildModelRoutingEconomicsGateReport };

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runModelRoutingEconomicsGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

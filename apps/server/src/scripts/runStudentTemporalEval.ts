import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { STUDENT_TEMPORAL_EVAL_PACK } from "../data/studentTemporalEvalPack.js";
import { LocalModelService } from "../services/localModel.js";
import { ResearchToolService } from "../services/researchToolService.js";
import {
  StudentTemporalEvalService,
  type StudentTemporalEvalReport
} from "../services/studentTemporalEvalService.js";
import { env, projectRoot } from "../utils/env.js";
import type { ResearchAcquisitionMode } from "../services/research/replayStore.js";

function parseArgs(argv: string[]) {
  const args = {
    limit: STUDENT_TEMPORAL_EVAL_PACK.length,
    output: resolve(projectRoot, "storage/benchmarks/student-temporal-eval-v1.json"),
    acquisitionMode: "live" as ResearchAcquisitionMode,
    fixtureFile: env.RESEARCH_EVAL_FIXTURE_FILE,
    sourceCacheEnabled: true
  };
  let cacheExplicit = false;

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = Math.min(STUDENT_TEMPORAL_EVAL_PACK.length, Math.trunc(parsed));
      }
    }

    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (value) {
        args.output = resolve(value);
      }
    }

    if (arg.startsWith("--acquisition=")) {
      const value = arg.slice("--acquisition=".length).trim().toLowerCase();
      if (value === "live" || value === "record" || value === "replay") {
        args.acquisitionMode = value;
      }
    }

    if (arg.startsWith("--fixtures=")) {
      const value = arg.slice("--fixtures=".length).trim();
      if (value) {
        args.fixtureFile = resolve(value);
      }
    }

    if (arg === "--cache=off") {
      args.sourceCacheEnabled = false;
      cacheExplicit = true;
    }

    if (arg === "--cache=on") {
      args.sourceCacheEnabled = true;
      cacheExplicit = true;
    }
  }

  if (!cacheExplicit && args.acquisitionMode !== "live") {
    args.sourceCacheEnabled = false;
  }

  return args;
}

async function persistReport(report: StudentTemporalEvalReport, outputPath: string) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const localModelService = new LocalModelService();
const researchToolService = new ResearchToolService({
  acquisitionMode: args.acquisitionMode,
  fixtureFile: args.fixtureFile,
  sourceCacheEnabled: args.sourceCacheEnabled
});
const studentTemporalEvalService = new StudentTemporalEvalService(
  localModelService,
  researchToolService
);

const report = await studentTemporalEvalService.run({
  limit: args.limit,
  continueOnError: true,
  acquisitionMode: args.acquisitionMode,
  fixtureFile: args.fixtureFile,
  sourceCacheEnabled: args.sourceCacheEnabled
});

await persistReport(report, args.output);

console.log(
  JSON.stringify(
    {
      runId: report.runId,
      outputPath: args.output,
      acquisitionMode: report.acquisitionMode,
      fixtureFile: report.fixtureFile,
      sourceCacheEnabled: report.sourceCacheEnabled,
      summary: report.summary
    },
    null,
    2
  )
);

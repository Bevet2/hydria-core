import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { TOOL_ROUTING_EVAL_PACK } from "../data/toolRoutingEvalPack.js";
import { ToolRoutingEvalService } from "../services/toolRoutingEvalService.js";
import { projectRoot } from "../utils/env.js";

function parseArgs(argv: string[]) {
  const args = {
    limit: TOOL_ROUTING_EVAL_PACK.length,
    output: resolve(projectRoot, "storage/benchmarks/tool-routing-eval-v1.json")
  };

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = Math.min(TOOL_ROUTING_EVAL_PACK.length, Math.trunc(parsed));
      }
    }

    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (value) {
        args.output = resolve(value);
      }
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const service = new ToolRoutingEvalService();
const report = service.run(args.limit);

await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      runId: report.runId,
      outputPath: args.output,
      total: report.total,
      passed: report.passed,
      accuracyPct: report.accuracyPct
    },
    null,
    2
  )
);

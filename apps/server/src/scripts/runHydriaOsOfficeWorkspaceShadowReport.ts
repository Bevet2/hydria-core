import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { OfficeWorkspaceShadowService } from "../services/publicApi/officeWorkspaceShadowService.js";
import { env } from "../utils/env.js";

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "hydria-os-office-workspace-shadow-report-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    input: resolve(projectRoot, readOption(argv, "--input") ?? env.HYDRIA_OS_OFFICE_V11_SHADOW_FILE),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput)
  };
}

export async function runHydriaOsOfficeWorkspaceShadowReport(args = parseArgs()) {
  const service = new OfficeWorkspaceShadowService({
    logFile: args.input
  });
  const report = await service.writeReport(args.output);

  console.log(
    JSON.stringify(
      {
        promotion: report.promotion,
        summary: report.summary,
        recentIssues: report.recentIssues,
        input: args.input,
        output: args.output
      },
      null,
      2
    )
  );

  return report;
}

if (resolve(process.argv[1] ?? "") === currentFilePath) {
  runHydriaOsOfficeWorkspaceShadowReport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

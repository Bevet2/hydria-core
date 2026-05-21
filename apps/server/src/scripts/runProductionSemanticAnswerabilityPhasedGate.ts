import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProductionSemanticAnswerRelevanceGate } from "./runProductionSemanticAnswerRelevanceGate.js";

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  delayMs: number;
  phases: number[];
  apiKey: string;
  continueOnFail: boolean;
};

type SemanticPhaseReport = {
  version: string;
  caseCount: number;
  completed: number;
  passed: number;
  failed: number;
  passRate: number;
  avgSemanticRelevanceScore: number;
  subjectNotAnsweredCount: number;
  missingCausalAnswerCount: number;
  missingMechanismAnswerCount: number;
  offTopicHybridVehicleCount: number;
  definitionInsteadOfCauseCount: number;
  avgDurationMs: number;
  durationMs: number;
  issueCounts: Record<string, number>;
  failures: Array<{ id: string; issues: string[]; answer: string }>;
};

type PhaseSummary = {
  limit: number;
  output: string;
  completed: number;
  passed: number;
  failed: number;
  passRate: number;
  avgSemanticRelevanceScore: number;
  avgDurationMs: number;
  durationMs: number;
  issueCounts: Record<string, number>;
  failures: SemanticPhaseReport["failures"];
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "production-semantic-answerability-phased-gate-v1.json"
);

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numberOption(argv: string[], name: string, fallback: number) {
  const value = Number(readOption(argv, name));
  return Number.isFinite(value) ? value : fallback;
}

function booleanOption(argv: string[], name: string) {
  return argv.includes(name) || readOption(argv, name) === "true";
}

export function parseSemanticAnswerabilityPhases(value: string | undefined) {
  const phases = (value ?? "50,100,150")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
  const uniquePhases = [...new Set(phases)].sort((left, right) => left - right);
  if (uniquePhases.length === 0) {
    throw new Error("At least one positive phase limit is required.");
  }
  return uniquePhases;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  return {
    baseUrl: (readOption(argv, "--base-url") ?? "https://app.hydria.click").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    timeoutMs: numberOption(argv, "--timeout-ms", 180000),
    delayMs: numberOption(argv, "--delay-ms", 500),
    phases: parseSemanticAnswerabilityPhases(readOption(argv, "--phases")),
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? "",
    continueOnFail: booleanOption(argv, "--continue-on-fail")
  };
}

export function phaseOutputPath(summaryOutput: string, limit: number) {
  const extensionIndex = summaryOutput.lastIndexOf(".");
  if (extensionIndex < 0) {
    return `${summaryOutput}-limit${limit}`;
  }
  return `${summaryOutput.slice(0, extensionIndex)}-limit${limit}${summaryOutput.slice(extensionIndex)}`;
}

function mergeIssueCounts(phases: PhaseSummary[]) {
  const issueCounts: Record<string, number> = {};
  for (const phase of phases) {
    for (const [issue, count] of Object.entries(phase.issueCounts)) {
      issueCounts[issue] = (issueCounts[issue] ?? 0) + count;
    }
  }
  return issueCounts;
}

export function buildSemanticAnswerabilityPhasedReport(args: Pick<Args, "baseUrl" | "phases">, phases: PhaseSummary[]) {
  const finalPhase = phases.at(-1);
  const failedPhases = phases.filter((phase) => phase.failed > 0);
  return {
    version: "production-semantic-answerability-phased-gate-v1",
    createdAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    requestedPhases: args.phases,
    completedPhases: phases.map((phase) => phase.limit),
    passed: failedPhases.length === 0 && phases.length === args.phases.length,
    finalLimit: finalPhase?.limit ?? 0,
    finalPassRate: finalPhase?.passRate ?? 0,
    finalAvgSemanticRelevanceScore: finalPhase?.avgSemanticRelevanceScore ?? 0,
    failedPhaseCount: failedPhases.length,
    totalDurationMs: phases.reduce((total, phase) => total + phase.durationMs, 0),
    issueCounts: mergeIssueCounts(phases),
    failures: phases.flatMap((phase) =>
      phase.failures.map((failure) => ({
        phaseLimit: phase.limit,
        ...failure
      }))
    ),
    phases
  };
}

export async function runProductionSemanticAnswerabilityPhasedGate(args = parseArgs()) {
  const phases: PhaseSummary[] = [];

  for (const limit of args.phases) {
    const output = phaseOutputPath(args.output, limit);
    const report = (await runProductionSemanticAnswerRelevanceGate({
      baseUrl: args.baseUrl,
      output,
      timeoutMs: args.timeoutMs,
      delayMs: args.delayMs,
      offset: 0,
      limit,
      caseIds: [],
      apiKey: args.apiKey
    })) as SemanticPhaseReport;

    phases.push({
      limit,
      output,
      completed: report.completed,
      passed: report.passed,
      failed: report.failed,
      passRate: report.passRate,
      avgSemanticRelevanceScore: report.avgSemanticRelevanceScore,
      avgDurationMs: report.avgDurationMs,
      durationMs: report.durationMs,
      issueCounts: report.issueCounts,
      failures: report.failures
    });

    if (report.failed > 0 && !args.continueOnFail) {
      break;
    }
  }

  const summary = buildSemanticAnswerabilityPhasedReport(args, phases);
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.passed) {
    process.exitCode = 1;
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  runProductionSemanticAnswerabilityPhasedGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChatCapabilityCoverageReport,
  runChatCapabilityCoverageGate,
  selectChatCapabilityCoverageCases,
  type ChatCapabilityCoverageCaseResult
} from "./runChatCapabilityCoverageGate.js";

type Args = {
  baseUrl: string;
  output: string;
  segmentsDir: string;
  timeoutMs: number;
  segmentSize: number;
  offset: number;
  limit: number | null;
  caseIds: string[];
  delayMs: number;
  resume: boolean;
  apiKey: string;
};

type SegmentSummary = {
  index: number;
  output: string;
  caseIds: string[];
  resumed: boolean;
  passed: boolean;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "chat-capability-coverage-gate-full-v1.json");
const defaultSegmentsDir = resolve(projectRoot, "storage", "training", "chat-capability-coverage-segments-v1");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function readOptions(argv: string[], name: string) {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
      continue;
    }
    const next = argv[index + 1];
    if (arg === name && next) {
      values.push(next);
    }
  }
  return values;
}

function readCsvOptions(argv: string[], names: string[]) {
  return names
    .flatMap((name) => readOptions(argv, name))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function numberOption(argv: string[], name: string, fallback: number) {
  const value = Number(readOption(argv, name));
  return Number.isFinite(value) ? value : fallback;
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const limit = readOption(argv, "--limit");
  return {
    baseUrl: (readOption(argv, "--base-url") ?? "https://app.hydria.click").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    segmentsDir: resolve(projectRoot, readOption(argv, "--segments-dir") ?? defaultSegmentsDir),
    timeoutMs: numberOption(argv, "--timeout-ms", 180000),
    segmentSize: Math.max(1, numberOption(argv, "--segment-size", 4)),
    offset: Math.max(0, numberOption(argv, "--offset", 0)),
    limit: limit ? Math.max(0, Number(limit)) : null,
    caseIds: readCsvOptions(argv, ["--case-id", "--case-ids"]),
    delayMs: Math.max(0, numberOption(argv, "--delay-ms", 1000)),
    resume: !argv.includes("--no-resume"),
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? ""
  };
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sanitizePathPart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 72);
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function segmentOutputPath(args: Args, index: number, caseIds: string[]) {
  const first = sanitizePathPart(caseIds[0] ?? "empty");
  const last = sanitizePathPart(caseIds[caseIds.length - 1] ?? "empty");
  return join(args.segmentsDir, `segment-${String(index + 1).padStart(2, "0")}-${first}-to-${last}.json`);
}

async function readReusableSegment(output: string, caseIds: string[]) {
  if (!existsSync(output)) {
    return null;
  }
  const parsed = JSON.parse(await readFile(output, "utf8")) as {
    passed?: boolean;
    results?: ChatCapabilityCoverageCaseResult[];
  };
  const resultIds = parsed.results?.map((result) => result.id) ?? [];
  if (!arraysEqual(resultIds, caseIds)) {
    return null;
  }
  return {
    passed: parsed.passed === true,
    results: parsed.results ?? []
  };
}

function sleep(ms: number) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function runSegmentedChatCapabilityCoverageGate(args = parseArgs()) {
  const startedAt = Date.now();
  const selectedCases = selectChatCapabilityCoverageCases({
    caseIds: args.caseIds,
    offset: args.offset,
    limit: args.limit
  });
  const selectedCaseIds = selectedCases.map((testCase) => testCase.id);
  const segments = chunk(selectedCaseIds, args.segmentSize);
  const results: ChatCapabilityCoverageCaseResult[] = [];
  const segmentSummaries: SegmentSummary[] = [];

  await mkdir(args.segmentsDir, { recursive: true });

  for (const [index, caseIds] of segments.entries()) {
    const output = segmentOutputPath(args, index, caseIds);
    const reusable = args.resume ? await readReusableSegment(output, caseIds) : null;

    if (reusable) {
      results.push(...reusable.results);
      segmentSummaries.push({
        index,
        output,
        caseIds,
        resumed: true,
        passed: reusable.passed
      });
      continue;
    }

    const segmentReport = await runChatCapabilityCoverageGate({
      baseUrl: args.baseUrl,
      output,
      timeoutMs: args.timeoutMs,
      offset: 0,
      limit: null,
      caseIds,
      apiKey: args.apiKey
    });
    results.push(...segmentReport.results);
    segmentSummaries.push({
      index,
      output,
      caseIds,
      resumed: false,
      passed: segmentReport.passed
    });

    if (args.delayMs > 0 && index < segments.length - 1) {
      await sleep(args.delayMs);
    }
  }

  const baseReport = buildChatCapabilityCoverageReport({
    baseUrl: args.baseUrl,
    results,
    startedAt
  });
  const report = {
    ...baseReport,
    runner: {
      mode: "segmented",
      segmentSize: args.segmentSize,
      segmentCount: segments.length,
      resumedSegments: segmentSummaries.filter((segment) => segment.resumed).length,
      selectedCaseIds,
      segmentsDir: args.segmentsDir,
      segments: segmentSummaries
    }
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  const args = parseArgs();
  runSegmentedChatCapabilityCoverageGate(args)
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            summary: report.summary,
            failedCaseIds: report.failedCaseIds,
            runner: report.runner,
            output: args.output
          },
          null,
          2
        )
      );
      process.exit(report.passed ? 0 : 1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

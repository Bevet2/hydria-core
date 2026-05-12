import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STABLE_FACTUAL_CHAT_EVAL_PACK, type StableFactualChatEvalCase } from "../data/stableFactualChatEvalPack.js";
import {
  buildStableFactualDiagnostics,
  buildStableFactualGateReport,
  evaluateStableFactualAnswer,
  type StableFactualCaseResult,
  type StableFactualEvaluationResult
} from "../services/evaluation/stableFactualChatEvaluator.js";

type Args = {
  baseUrl: string;
  output: string;
  diagnosticsOutput: string;
  timeoutMs: number;
  delayMs: number;
  limit: number | null;
  apiKey: string;
  allowFailures: boolean;
};

type ChatResponse = {
  durationMs?: number;
  usedRetry?: boolean;
  assistantMessage?: { content?: string };
  answer?: { answer?: string };
  conversationQuality?: { passed?: boolean; issues?: string[] };
  generation?: {
    provider?: string;
    model?: string;
    usedStaticFallback?: boolean;
    runtimeBudget?: {
      profile?: string;
    };
  };
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "stable-factual-chat-gate-v1.json");
const defaultDiagnosticsOutput = resolve(projectRoot, "storage", "training", "stable-factual-chat-diagnostics-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const limit = readOption(argv, "--limit");
  return {
    baseUrl: (readOption(argv, "--base-url") ?? "https://app.hydria.click").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    diagnosticsOutput: resolve(projectRoot, readOption(argv, "--diagnostics-output") ?? defaultDiagnosticsOutput),
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? "120000"),
    delayMs: Number(readOption(argv, "--delay-ms") ?? "1000"),
    limit: limit ? Number(limit) : null,
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? "",
    allowFailures: hasFlag(argv, "--allow-failures")
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function answerText(response: ChatResponse) {
  return response.assistantMessage?.content ?? response.answer?.answer ?? "";
}

async function postJson<T>(baseUrl: string, path: string, body: unknown, timeoutMs: number, apiKey = ""): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(apiKey ? { "x-hydria-api-key": apiKey } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

function failedEvaluation(message: string): StableFactualEvaluationResult {
  return {
    passed: false,
    score: 0,
    issues: [`request_error:${message}`],
    missingAnchors: [],
    forbiddenClaims: [],
    routeIssues: [`request_error:${message}`],
    languageIssue: null,
    genericFailure: false
  };
}

async function runCase(testCase: StableFactualChatEvalCase, args: Args): Promise<StableFactualCaseResult> {
  const startedAt = Date.now();
  const response = await postJson<ChatResponse>(
    args.baseUrl,
    "/api/chat/message",
    { message: testCase.prompt },
    args.timeoutMs,
    args.apiKey
  );
  const answer = answerText(response);
  const runtime = {
    provider: response.generation?.provider ?? "unknown",
    model: response.generation?.model ?? "unknown",
    budgetProfile: response.generation?.runtimeBudget?.profile ?? "unknown",
    usedRetry: Boolean(response.usedRetry),
    usedStaticFallback: Boolean(response.generation?.usedStaticFallback || response.generation?.provider === "fallback"),
    qualityPassed: response.conversationQuality?.passed !== false,
    latencyMs: response.durationMs ?? Date.now() - startedAt
  };
  return {
    id: testCase.id,
    domain: testCase.domain,
    language: testCase.language,
    prompt: testCase.prompt,
    answer,
    runtime,
    evaluation: evaluateStableFactualAnswer(testCase, answer, runtime)
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runStableFactualChatGate(args = parseArgs()) {
  const selectedCases = args.limit ? STABLE_FACTUAL_CHAT_EVAL_PACK.slice(0, args.limit) : STABLE_FACTUAL_CHAT_EVAL_PACK;
  const telemetrySince = new Date().toISOString();
  const results: StableFactualCaseResult[] = [];

  for (const [index, testCase] of selectedCases.entries()) {
    if (index > 0 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
    try {
      results.push(await runCase(testCase, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: testCase.id,
        domain: testCase.domain,
        language: testCase.language,
        prompt: testCase.prompt,
        answer: "",
        runtime: {
          provider: "error",
          model: "error",
          budgetProfile: "error",
          latencyMs: 0,
          usedRetry: false,
          usedStaticFallback: false,
          qualityPassed: false
        },
        evaluation: failedEvaluation(message)
      });
    }

    const partialReport = buildStableFactualGateReport({
      baseUrl: args.baseUrl,
      timeoutMs: args.timeoutMs,
      telemetrySince,
      plannedCaseCount: selectedCases.length,
      results
    });
    await writeJson(args.output, partialReport);
    await writeJson(args.diagnosticsOutput, buildStableFactualDiagnostics(partialReport));
  }

  const report = buildStableFactualGateReport({
    baseUrl: args.baseUrl,
    timeoutMs: args.timeoutMs,
    telemetrySince,
    plannedCaseCount: selectedCases.length,
    results
  });
  const diagnostics = buildStableFactualDiagnostics(report);
  await writeJson(args.output, report);
  await writeJson(args.diagnosticsOutput, diagnostics);

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        failedCaseIds: report.failedCaseIds,
        telemetrySince,
        output: args.output,
        diagnosticsOutput: args.diagnosticsOutput
      },
      null,
      2
    )
  );

  if (!report.passed && !args.allowFailures) {
    process.exitCode = 1;
  }
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runStableFactualChatGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}


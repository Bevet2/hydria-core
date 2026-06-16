import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type WarmupCase = {
  id: string;
  message: string;
  expectedModel: string | string[];
  expectedBudgetProfile: string | string[];
};

type ChatResponse = {
  sessionId?: string;
  durationMs?: number;
  assistantMessage?: { content?: string };
  generation?: {
    provider?: string;
    model?: string;
    runtimeBudget?: { profile?: string };
    usedStaticFallback?: boolean;
    attempts?: Array<{ model?: string; status?: string; error?: string }>;
  };
  orchestrationTrace?: {
    version?: string;
    disclosure?: string;
    steps?: Array<{ id?: string; status?: string; summary?: string }>;
  };
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  rounds: number;
  apiKey: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "chat-model-warmup-v1.json");

const warmupCases: WarmupCase[] = [
  {
    id: "time_tool_deterministic",
    message: "Quelle heure est-il a Paris ?",
    expectedModel: "time",
    expectedBudgetProfile: "fast_tool"
  },
  {
    id: "gemma_standard_light",
    message: "Explique simplement ce qu'est une API.",
    expectedModel: "gemma3n:e4b",
    expectedBudgetProfile: "standard_light_chat"
  },
  {
    id: "source_backed_stable_fact",
    message: "Qui est Marie Curie ?",
    expectedModel: "gemma3n:e4b",
    expectedBudgetProfile: "standard_light_chat"
  }
];

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

function parseArgs(argv = process.argv.slice(2)): Args {
  return {
    baseUrl: (readOption(argv, "--base-url") ?? "https://app.hydria.click").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    timeoutMs: numberOption(argv, "--timeout-ms", 180000),
    rounds: Math.max(1, Math.min(5, numberOption(argv, "--rounds", 1))),
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? ""
  };
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  apiKey = ""
): Promise<T> {
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

function includesExpected(value: string, expected: string | string[]) {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  return expectedValues.some((item) => item === value);
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export async function runChatModelWarmup(args = parseArgs()) {
  const startedAt = Date.now();
  const results = [];

  for (let round = 1; round <= args.rounds; round += 1) {
    for (const item of warmupCases) {
      const started = Date.now();
      try {
        const response = await postJson<ChatResponse>(
          args.baseUrl,
          "/api/chat/message",
          { message: item.message },
          args.timeoutMs,
          args.apiKey
        );
        const provider = response.generation?.provider ?? "unknown";
        const model = response.generation?.model ?? "unknown";
        const budgetProfile = response.generation?.runtimeBudget?.profile ?? "unknown";
        const issues = [
          response.orchestrationTrace?.version === "chat_orchestration_trace_v1" ? null : "missing_trace",
          response.generation?.usedStaticFallback ? "static_fallback" : null,
          provider !== "ollama" && provider !== "tool" ? `unexpected_provider:${provider}` : null,
          includesExpected(model, item.expectedModel) ? null : `unexpected_model:${model}`,
          includesExpected(budgetProfile, item.expectedBudgetProfile)
            ? null
            : `unexpected_budget_profile:${budgetProfile}`
        ].filter(Boolean) as string[];

        results.push({
          id: item.id,
          round,
          passed: issues.length === 0,
          issues,
          provider,
          model,
          budgetProfile,
          durationMs: response.durationMs ?? Date.now() - started,
          attempts: response.generation?.attempts ?? [],
          answerPreview: response.assistantMessage?.content?.slice(0, 180) ?? ""
        });
      } catch (error) {
        results.push({
          id: item.id,
          round,
          passed: false,
          issues: [error instanceof Error ? error.message : String(error)],
          provider: "error",
          model: "error",
          budgetProfile: "error",
          durationMs: Date.now() - started,
          attempts: [],
          answerPreview: ""
        });
      }
    }
  }

  const durations = results.map((result) => result.durationMs);
  const report = {
    version: "hydria-chat-model-warmup-v1",
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      rounds: args.rounds
    },
    passed: results.every((result) => result.passed),
    summary: {
      total: results.length,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed).length,
      p50LatencyMs: percentile(durations, 50),
      p95LatencyMs: percentile(durations, 95),
      maxLatencyMs: durations.length > 0 ? Math.max(...durations) : 0,
      durationMs: Date.now() - startedAt
    },
    failedCaseIds: results.filter((result) => !result.passed).map((result) => `${result.id}#${result.round}`),
    results
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        failedCaseIds: report.failedCaseIds,
        output: args.output
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
  runChatModelWarmup().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

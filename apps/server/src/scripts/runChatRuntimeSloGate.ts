import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Language = "fr" | "en";

type ChatRuntimeSloCase = {
  id: string;
  language: Language;
  conversation: string[];
  expectedTerms: string[];
  expectedTraceSteps?: string[];
};

type ChatResponse = {
  sessionId?: string;
  runtimeMode?: string;
  durationMs?: number;
  assistantMessage?: { content?: string };
  answer?: { answer?: string; confidence?: number };
  conversationQuality?: { passed?: boolean; issues?: string[] };
  generation?: {
    provider?: string;
    model?: string;
    usedStaticFallback?: boolean;
    runtimeBudget?: { profile?: string };
    validationIssues?: string[];
    attempts?: Array<{ model?: string; status?: string; error?: string }>;
  };
  tooling?: {
    route?: string;
    used?: boolean;
    verifiedFacts?: string[];
    routing?: {
      toolType?: string;
      intent?: string;
      toolRequired?: boolean;
      toolRecommended?: boolean;
    };
  };
  orchestrationTrace?: {
    version?: string;
    disclosure?: string;
    steps?: Array<{
      id?: string;
      label?: string;
      status?: string;
      summary?: string;
      details?: Record<string, unknown>;
    }>;
  };
  usedRetry?: boolean;
};

export type ChatRuntimeSloTurnResult = {
  prompt: string;
  answer: string;
  provider: string;
  model: string;
  budgetProfile: string;
  runtimeMode: string;
  durationMs: number;
  usedRetry: boolean;
  usedStaticFallback: boolean;
  cloudRuntime: boolean;
  wrongLanguage: boolean;
  qualityPassed: boolean;
  traceComplete: boolean;
  traceStepIds: string[];
  issues: string[];
};

export type ChatRuntimeSloCaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  turns: ChatRuntimeSloTurnResult[];
};

export type ChatRuntimeSloThresholds = {
  maxP95LatencyMs: number;
  maxRetryRate: number;
  maxStaticFallbackRate: number;
  maxCloudRuntimeRate: number;
  maxWrongLanguageRate: number;
  maxQualityFailureRate: number;
  minTraceCoverageRate: number;
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  limit: number | null;
  apiKey: string;
  thresholds: ChatRuntimeSloThresholds;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "chat-runtime-slo-gate-v1.json");

const defaultTraceSteps = [
  "language_context",
  "task_routing",
  "tool_routing",
  "model_selection",
  "quality_gate"
];

const cases: ChatRuntimeSloCase[] = [
  {
    id: "fr_tool_calculator",
    language: "fr",
    conversation: ["Calcule 12 * 37."],
    expectedTerms: ["444"]
  },
  {
    id: "fr_standard_light_api",
    language: "fr",
    conversation: ["Explique simplement ce qu'est une API."],
    expectedTerms: ["api"]
  },
  {
    id: "en_standard_light_docker",
    language: "en",
    conversation: ["What is Docker?"],
    expectedTerms: ["docker", "container"]
  },
  {
    id: "fr_stable_fact_marie_curie",
    language: "fr",
    conversation: ["Qui est Marie Curie ?"],
    expectedTerms: ["marie", "radio"]
  },
  {
    id: "en_memory_project",
    language: "en",
    conversation: ["My project is called Hydria Core.", "What is my project called?"],
    expectedTerms: ["hydria core"]
  },
  {
    id: "fr_context_brevity_constraint",
    language: "fr",
    conversation: [
      "Pour la suite reponds en moins de 12 mots.",
      "Explique PostgreSQL en respectant ma contrainte."
    ],
    expectedTerms: ["postgresql"]
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
  const limit = readOption(argv, "--limit");
  return {
    baseUrl: (readOption(argv, "--base-url") ?? "https://app.hydria.click").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    timeoutMs: numberOption(argv, "--timeout-ms", 180000),
    limit: limit ? Number(limit) : null,
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? "",
    thresholds: {
      maxP95LatencyMs: numberOption(argv, "--max-p95-ms", 60000),
      maxRetryRate: numberOption(argv, "--max-retry-rate", 10),
      maxStaticFallbackRate: numberOption(argv, "--max-static-fallback-rate", 0),
      maxCloudRuntimeRate: numberOption(argv, "--max-cloud-runtime-rate", 0),
      maxWrongLanguageRate: numberOption(argv, "--max-wrong-language-rate", 0),
      maxQualityFailureRate: numberOption(argv, "--max-quality-failure-rate", 0),
      minTraceCoverageRate: numberOption(argv, "--min-trace-coverage-rate", 100)
    }
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

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function answerText(response: ChatResponse) {
  return response.assistantMessage?.content ?? response.answer?.answer ?? "";
}

function languageLooksRight(answer: string, language: Language) {
  const normalized = normalize(answer);
  const frenchSignals = /\b(?:le|la|les|une|des|est|donc|pour|avec|choisis|recommande|reponse|priorite)\b/.test(
    normalized
  );
  const englishSignals = /\b(?:the|this|that|with|should|first|default|because|recommend|answer|priority)\b/.test(
    normalized
  );
  return language === "fr" ? frenchSignals || !englishSignals : englishSignals || !frenchSignals;
}

function isCloudRuntime(provider: string, model: string) {
  const normalizedModel = model.toLowerCase();
  if (provider !== "ollama" && provider !== "tool" && provider !== "fallback") {
    return true;
  }
  return /(?:openai|anthropic|qwen\/|google|mistralai|openrouter)\//i.test(normalizedModel);
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function rate(count: number, total: number) {
  return total === 0 ? 0 : Number(((count / total) * 100).toFixed(1));
}

function inspectTrace(response: ChatResponse, expectedTraceSteps: string[]) {
  const trace = response.orchestrationTrace;
  const stepIds = trace?.steps?.map((step) => step.id ?? "").filter(Boolean) ?? [];
  const issues: string[] = [];
  if (trace?.version !== "chat_orchestration_trace_v1") {
    issues.push("missing_trace_version");
  }
  if (trace?.disclosure !== "runtime_trace_no_private_chain_of_thought") {
    issues.push("missing_no_private_cot_disclosure");
  }
  for (const stepId of expectedTraceSteps) {
    if (!stepIds.includes(stepId)) {
      issues.push(`missing_trace_step:${stepId}`);
    }
  }
  const combinedTraceText = JSON.stringify(trace ?? {});
  if (/chain[- ]of[- ]thought|hidden prompt|system prompt/i.test(combinedTraceText)) {
    issues.push("unsafe_trace_disclosure");
  }
  return {
    traceComplete: issues.length === 0,
    stepIds,
    issues
  };
}

async function runCase(testCase: ChatRuntimeSloCase, args: Args): Promise<ChatRuntimeSloCaseResult> {
  let sessionId: string | undefined;
  const turns: ChatRuntimeSloTurnResult[] = [];
  const issues: string[] = [];
  const expectedTraceSteps = testCase.expectedTraceSteps ?? defaultTraceSteps;

  for (const prompt of testCase.conversation) {
    const response = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      sessionId ? { sessionId, message: prompt } : { message: prompt },
      args.timeoutMs,
      args.apiKey
    );
    sessionId = response.sessionId;
    const answer = answerText(response);
    const provider = response.generation?.provider ?? "unknown";
    const model = response.generation?.model ?? "unknown";
    const traceInspection = inspectTrace(response, expectedTraceSteps);
    const turnIssues = [...traceInspection.issues];
    const usedStaticFallback = provider === "fallback" || response.generation?.usedStaticFallback === true;
    const wrongLanguage = !languageLooksRight(answer, testCase.language);
    const cloudRuntime = isCloudRuntime(provider, model);
    const usedRetry =
      (response.generation?.attempts?.length ?? 0) > 1 ||
      response.generation?.attempts?.some((attempt) => attempt.status === "failed") === true;

    if (usedStaticFallback) {
      turnIssues.push("static_fallback");
    }
    if (cloudRuntime) {
      turnIssues.push(`cloud_runtime:${provider}/${model}`);
    }
    if (wrongLanguage) {
      turnIssues.push(`wrong_language:${testCase.language}`);
    }
    if (response.conversationQuality?.passed === false) {
      turnIssues.push(`quality_gate:${response.conversationQuality.issues?.join("|") ?? "failed"}`);
    }

    turns.push({
      prompt,
      answer,
      provider,
      model,
      budgetProfile: response.generation?.runtimeBudget?.profile ?? "n/a",
      runtimeMode: response.runtimeMode ?? "unknown",
      durationMs: response.durationMs ?? 0,
      usedRetry,
      usedStaticFallback,
      cloudRuntime,
      wrongLanguage,
      qualityPassed: response.conversationQuality?.passed !== false,
      traceComplete: traceInspection.traceComplete,
      traceStepIds: traceInspection.stepIds,
      issues: turnIssues
    });
  }

  const finalAnswer = turns[turns.length - 1]?.answer ?? "";
  const normalizedFinalAnswer = normalize(finalAnswer);
  for (const expectedTerm of testCase.expectedTerms) {
    if (!normalizedFinalAnswer.includes(normalize(expectedTerm))) {
      issues.push(`missing_expected_term:${expectedTerm}`);
    }
  }
  for (const turn of turns) {
    issues.push(...turn.issues);
  }

  return {
    id: testCase.id,
    passed: issues.length === 0,
    issues,
    turns
  };
}

export function buildChatRuntimeSloGateReport(args: {
  baseUrl: string;
  results: ChatRuntimeSloCaseResult[];
  thresholds: ChatRuntimeSloThresholds;
  startedAt: number;
}) {
  const turns = args.results.flatMap((result) => result.turns);
  const durations = turns.map((turn) => turn.durationMs);
  const staticFallbackCount = turns.filter((turn) => turn.usedStaticFallback).length;
  const cloudRuntimeCount = turns.filter((turn) => turn.cloudRuntime).length;
  const retryCount = turns.filter((turn) => turn.usedRetry).length;
  const wrongLanguageCount = turns.filter((turn) => turn.wrongLanguage).length;
  const qualityFailureCount = turns.filter((turn) => !turn.qualityPassed).length;
  const traceCompleteCount = turns.filter((turn) => turn.traceComplete).length;
  const summary = {
    totalCases: args.results.length,
    passedCases: args.results.filter((result) => result.passed).length,
    failedCases: args.results.filter((result) => !result.passed).length,
    totalTurns: turns.length,
    passRate: rate(args.results.filter((result) => result.passed).length, args.results.length),
    p50LatencyMs: percentile(durations, 50),
    p95LatencyMs: percentile(durations, 95),
    maxLatencyMs: durations.length > 0 ? Math.max(...durations) : 0,
    retryRate: rate(retryCount, turns.length),
    staticFallbackRate: rate(staticFallbackCount, turns.length),
    cloudRuntimeRate: rate(cloudRuntimeCount, turns.length),
    wrongLanguageRate: rate(wrongLanguageCount, turns.length),
    qualityFailureRate: rate(qualityFailureCount, turns.length),
    traceCoverageRate: rate(traceCompleteCount, turns.length),
    durationMs: Date.now() - args.startedAt
  };
  const blockers = [
    summary.failedCases > 0 ? `failed_cases:${summary.failedCases}` : null,
    summary.p95LatencyMs > args.thresholds.maxP95LatencyMs
      ? `p95_latency:${summary.p95LatencyMs}>${args.thresholds.maxP95LatencyMs}`
      : null,
    summary.retryRate > args.thresholds.maxRetryRate
      ? `retry_rate:${summary.retryRate}>${args.thresholds.maxRetryRate}`
      : null,
    summary.staticFallbackRate > args.thresholds.maxStaticFallbackRate
      ? `static_fallback_rate:${summary.staticFallbackRate}>${args.thresholds.maxStaticFallbackRate}`
      : null,
    summary.cloudRuntimeRate > args.thresholds.maxCloudRuntimeRate
      ? `cloud_runtime_rate:${summary.cloudRuntimeRate}>${args.thresholds.maxCloudRuntimeRate}`
      : null,
    summary.wrongLanguageRate > args.thresholds.maxWrongLanguageRate
      ? `wrong_language_rate:${summary.wrongLanguageRate}>${args.thresholds.maxWrongLanguageRate}`
      : null,
    summary.qualityFailureRate > args.thresholds.maxQualityFailureRate
      ? `quality_failure_rate:${summary.qualityFailureRate}>${args.thresholds.maxQualityFailureRate}`
      : null,
    summary.traceCoverageRate < args.thresholds.minTraceCoverageRate
      ? `trace_coverage_rate:${summary.traceCoverageRate}<${args.thresholds.minTraceCoverageRate}`
      : null
  ].filter(Boolean) as string[];

  return {
    version: "hydria-chat-runtime-slo-gate-v1",
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      thresholds: args.thresholds
    },
    passed: blockers.length === 0,
    summary,
    blockers,
    failedCaseIds: args.results.filter((result) => !result.passed).map((result) => result.id),
    results: args.results
  };
}

export async function runChatRuntimeSloGate(args = parseArgs()) {
  const startedAt = Date.now();
  const selectedCases = args.limit ? cases.slice(0, args.limit) : cases;
  const results: ChatRuntimeSloCaseResult[] = [];

  for (const testCase of selectedCases) {
    try {
      results.push(await runCase(testCase, args));
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        issues: [error instanceof Error ? error.message : String(error)],
        turns: []
      });
    }
  }

  const report = buildChatRuntimeSloGateReport({
    baseUrl: args.baseUrl,
    results,
    thresholds: args.thresholds,
    startedAt
  });

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        blockers: report.blockers,
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
  runChatRuntimeSloGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

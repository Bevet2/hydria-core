import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES,
  type GeneralKnowledgeReliabilityCase
} from "../data/generalKnowledgeReliabilityGatePack.js";
import {
  evaluateSourceAnswerRelevance,
  type SourceAnswerLanguage
} from "../services/quality/sourceAnswerRelevanceGate.js";
import type { ResearchSource } from "../types/arena.js";
import {
  normalizeGateText,
  selectProductionGeneralKnowledgeCases,
  sourceFamily
} from "./runProductionGeneralKnowledgeReliabilityGate.js";

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  delayMs: number;
  offset: number;
  limit: number | null;
  caseIds: string[];
  apiKey: string;
};

type ChatResponse = {
  durationMs?: number;
  assistantMessage?: { content?: string };
  answer?: { answer?: string };
  evidenceCapsule?: {
    answerabilityMode?: string;
    sourceBound?: boolean;
  };
  generation?: {
    provider?: string;
    model?: string;
    usedStaticFallback?: boolean;
  };
  tooling?: {
    used?: boolean;
    routing?: {
      toolType?: string;
      intent?: string;
    };
    verifiedFacts?: string[];
    sources?: ResearchSource[];
  };
};

type CaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  message: string;
  expectedLanguage: SourceAnswerLanguage;
  answer: string;
  provider: string;
  model: string;
  sourceCount: number;
  sourceFamilies: string[];
  semanticIntent: string;
  semanticRelevanceScore: number;
  durationMs: number;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "production-semantic-answer-relevance-gate-v1.json"
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
    timeoutMs: numberOption(argv, "--timeout-ms", 180000),
    delayMs: numberOption(argv, "--delay-ms", 0),
    offset: Math.max(0, numberOption(argv, "--offset", 0)),
    limit: limit ? Math.max(0, Number(limit)) : null,
    caseIds: readCsvOptions(argv, ["--case-id", "--case-ids"]),
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? ""
  };
}

function expectedLanguage(testCase: GeneralKnowledgeReliabilityCase): SourceAnswerLanguage {
  const id = testCase.id.toLowerCase();
  if (id.endsWith("_en") || id.includes("_en_")) {
    return "en";
  }
  const normalized = normalizeGateText(testCase.message);
  return /^(what|who|why|tell|explain|give|make|brainstorm|suggest|write)\b/.test(normalized) ? "en" : "fr";
}

function answerText(response: ChatResponse) {
  return response.assistantMessage?.content ?? response.answer?.answer ?? "";
}

async function postJson<T>(args: {
  baseUrl: string;
  path: string;
  body: unknown;
  timeoutMs: number;
  apiKey: string;
}) {
  const response = await fetch(`${args.baseUrl}${args.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(args.apiKey ? { "x-hydria-api-key": args.apiKey } : {})
    },
    body: JSON.stringify(args.body),
    signal: AbortSignal.timeout(args.timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${args.path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

function delay(ms: number) {
  return ms <= 0 ? Promise.resolve() : new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function rate(count: number, total: number) {
  return total === 0 ? 0 : Number(((count / total) * 100).toFixed(1));
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function inspectCase(testCase: GeneralKnowledgeReliabilityCase, response: ChatResponse): CaseResult {
  const answer = answerText(response);
  const sources = response.tooling?.sources ?? [];
  const expected = testCase.expected;
  const language = expectedLanguage(testCase);
  const relevance = evaluateSourceAnswerRelevance({
    question: testCase.message,
    subject: expected.term,
    answer,
    verifiedFacts: response.tooling?.verifiedFacts ?? [],
    language
  });
  const issues = relevance.issues.map((issue) => `semantic_${issue}`);

  if (response.evidenceCapsule?.answerabilityMode !== "source_backed") {
    issues.push(`answerability_mode:${response.evidenceCapsule?.answerabilityMode ?? "missing"}`);
  }
  if (response.tooling?.used !== true || response.tooling.routing?.toolType !== "research") {
    issues.push(`research_not_used:${response.tooling?.routing?.toolType ?? "none"}`);
  }
  if (response.evidenceCapsule?.sourceBound !== true) {
    issues.push("source_not_bound");
  }
  if (response.generation?.usedStaticFallback) {
    issues.push("static_fallback");
  }

  return {
    id: testCase.id,
    passed: issues.length === 0,
    issues,
    message: testCase.message,
    expectedLanguage: language,
    answer,
    provider: response.generation?.provider ?? "unknown",
    model: response.generation?.model ?? "unknown",
    sourceCount: sources.length,
    sourceFamilies: [...new Set(sources.map(sourceFamily))],
    semanticIntent: relevance.intent,
    semanticRelevanceScore: relevance.score,
    durationMs: response.durationMs ?? 0
  };
}

function semanticCases(args: Args) {
  if (args.caseIds.length > 0) {
    return selectProductionGeneralKnowledgeCases(args).filter(
      (testCase) =>
        testCase.expected.kind === "source_backed" ||
        (testCase.expected.kind === "tool_first" && testCase.expected.toolType === "research")
    );
  }
  const cases = GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.filter(
    (testCase) =>
      testCase.expected.kind === "source_backed" ||
      (testCase.expected.kind === "tool_first" && testCase.expected.toolType === "research")
  );
  const start = Math.max(0, args.offset);
  const end = args.limit === null ? undefined : start + Math.max(0, args.limit);
  return cases.slice(start, end);
}

export async function runProductionSemanticAnswerRelevanceGate(args = parseArgs()) {
  const startedAt = Date.now();
  const selectedCases = semanticCases(args);
  const results: CaseResult[] = [];

  for (const [index, testCase] of selectedCases.entries()) {
    try {
      const response = await postJson<ChatResponse>({
        baseUrl: args.baseUrl,
        path: "/api/chat/message",
        body: { message: testCase.message },
        timeoutMs: args.timeoutMs,
        apiKey: args.apiKey
      });
      results.push(inspectCase(testCase, response));
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        issues: [`request_failed:${error instanceof Error ? error.message : String(error)}`],
        message: testCase.message,
        expectedLanguage: expectedLanguage(testCase),
        answer: "",
        provider: "request_failed",
        model: "request_failed",
        sourceCount: 0,
        sourceFamilies: [],
        semanticIntent: "request_failed",
        semanticRelevanceScore: 0,
        durationMs: 0
      });
    }
    if (args.delayMs > 0 && index < selectedCases.length - 1) {
      await delay(args.delayMs);
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const issueCounts = countBy(results.flatMap((result) => result.issues.map((issue) => issue.split(":")[0] ?? issue)));
  const avgSemanticRelevanceScore =
    results.length === 0
      ? 0
      : Number(
          (results.reduce((total, result) => total + result.semanticRelevanceScore, 0) / results.length).toFixed(1)
        );
  const avgDurationMs =
    results.length === 0
      ? 0
      : Math.round(results.reduce((total, result) => total + result.durationMs, 0) / results.length);

  const report = {
    version: "production-semantic-answer-relevance-gate-v1",
    createdAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    caseCount: selectedCases.length,
    completed: results.length,
    passed,
    failed,
    passRate: rate(passed, results.length),
    avgSemanticRelevanceScore,
    subjectNotAnsweredCount: issueCounts.semantic_subject_not_answered ?? 0,
    missingCausalAnswerCount: issueCounts.semantic_missing_causal_answer ?? 0,
    missingMechanismAnswerCount: issueCounts.semantic_missing_mechanism_answer ?? 0,
    offTopicHybridVehicleCount: issueCounts.semantic_off_topic_hybrid_vehicle ?? 0,
    definitionInsteadOfCauseCount: issueCounts.semantic_definition_instead_of_cause ?? 0,
    avgDurationMs,
    durationMs: Date.now() - startedAt,
    issueCounts,
    failures: results
      .filter((result) => !result.passed)
      .map((result) => ({
        id: result.id,
        issues: result.issues,
        answer: result.answer.slice(0, 500),
        provider: result.provider,
        model: result.model,
        sourceFamilies: result.sourceFamilies
      })),
    results
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  runProductionSemanticAnswerRelevanceGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}


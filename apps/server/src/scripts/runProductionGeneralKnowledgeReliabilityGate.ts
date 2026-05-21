import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES,
  type GeneralKnowledgeReliabilityCase
} from "../data/generalKnowledgeReliabilityGatePack.js";
import { evaluateSourceAnswerRelevance } from "../services/quality/sourceAnswerRelevanceGate.js";
import type { ResearchSource } from "../types/arena.js";

type Language = "fr" | "en";

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
  sessionId?: string;
  runtimeMode?: string;
  category?: string;
  durationMs?: number;
  assistantMessage?: { content?: string };
  answer?: { answer?: string };
  conversationQuality?: { passed?: boolean; issues?: string[] };
  evidenceCapsule?: {
    answerabilityMode?: string;
    usedEvidence?: string[];
    missingEvidence?: string[];
    sourceBound?: boolean;
    reliabilityLevel?: string;
  };
  generation?: {
    provider?: string;
    model?: string;
    usedStaticFallback?: boolean;
    validationIssues?: string[];
  };
  tooling?: {
    used?: boolean;
    route?: string;
    routing?: {
      toolType?: string;
      intent?: string;
      toolRequired?: boolean;
      toolRecommended?: boolean;
      toolResultUsed?: boolean;
    };
    summary?: string[];
    verifiedFacts?: string[];
    sources?: ResearchSource[];
    failureReason?: string | null;
  };
  orchestrationTrace?: {
    steps?: Array<{ id?: string; status?: string; summary?: string }>;
  };
};

type CaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  message: string;
  expectedKind: GeneralKnowledgeReliabilityCase["expected"]["kind"];
  expectedTerm: string;
  expectedLanguage: Language;
  answer: string;
  answerabilityMode: string;
  provider: string;
  model: string;
  toolType: string;
  toolIntent: string;
  toolUsed: boolean;
  sourceCount: number;
  sourceFamilies: string[];
  semanticRelevanceScore: number;
  semanticIntent: string;
  durationMs: number;
  usedStaticFallback: boolean;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "production-general-knowledge-reliability-gate-v2.json"
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

export function selectProductionGeneralKnowledgeCases(args: Pick<Args, "caseIds" | "limit" | "offset">) {
  const cases =
    args.caseIds.length > 0
      ? args.caseIds.map((id) => {
          const testCase = GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.find((candidate) => candidate.id === id);
          if (!testCase) {
            throw new Error(`Unknown general knowledge reliability case id: ${id}`);
          }
          return testCase;
        })
      : GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES;
  const start = Math.max(0, args.offset);
  const end = args.limit === null ? undefined : start + Math.max(0, args.limit);
  return cases.slice(start, end);
}

export function normalizeGateText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expectedLanguage(testCase: GeneralKnowledgeReliabilityCase): Language {
  const id = testCase.id.toLowerCase();
  if (id.endsWith("_en") || id.includes("_en_")) {
    return "en";
  }
  const normalized = normalizeGateText(testCase.message);
  return /^(what|who|why|tell|explain|give|make|brainstorm|suggest|write)\b/.test(normalized) ? "en" : "fr";
}

function languageLooksRight(answer: string, language: Language) {
  const normalized = normalizeGateText(answer);
  const frenchSignals =
    /\b(?:le|la|les|une|des|est|sont|avec|pour|dans|voici|reponse|recette|selon|source|sources|il|elle)\b/.test(
      normalized
    );
  const englishSignals =
    /\b(?:the|this|that|with|for|because|answer|recipe|according|source|sources|it|they|was|were)\b/.test(
      normalized
    );
  return language === "fr" ? frenchSignals || !englishSignals : englishSignals || !frenchSignals;
}

export function sourceFamily(source: Pick<ResearchSource, "url" | "title" | "retrievalEngine">) {
  try {
    const host = new URL(source.url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith("wikipedia.org")) {
      return "wikipedia";
    }
    if (host.endsWith("wikidata.org")) {
      return "wikidata";
    }
    if (host.endsWith("britannica.com")) {
      return "britannica";
    }
    if (host.endsWith("open-meteo.com")) {
      return "open-meteo";
    }
    if (host.endsWith("coingecko.com")) {
      return "coingecko";
    }
    if (host.endsWith("stooq.com")) {
      return "stooq";
    }
    if (host.endsWith("nodejs.org")) {
      return "nodejs";
    }
    return host;
  } catch {
    return normalizeGateText(source.title || source.retrievalEngine || "unknown") || "unknown";
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function expectedTerm(testCase: GeneralKnowledgeReliabilityCase) {
  return testCase.expected.term;
}

function termLooksPresent(value: string, term: string) {
  const normalizedValue = normalizeGateText(value);
  const normalizedTerm = normalizeGateText(term);
  if (!normalizedTerm) {
    return true;
  }
  if (normalizedValue.includes(normalizedTerm)) {
    return true;
  }
  const tokens = normalizedTerm.split(" ").filter((token) => token.length > 1);
  return tokens.length > 0 && tokens.every((token) =>
    gateTermVariants(token).some((variant) => normalizedValue.includes(variant))
  );
}

function gateTermVariants(token: string) {
  if (token === "cleopatra" || token === "cleopatre") {
    return ["cleopatra", "cleopatre"];
  }
  return [token];
}

function sourceText(source: ResearchSource) {
  return [source.title, source.snippet, source.excerpt, source.url].filter(Boolean).join(" ");
}

function sourcesMatchExpectedTerm(sources: ResearchSource[], term: string) {
  return sources.some((source) => termLooksPresent(sourceText(source), term));
}

function answerText(response: ChatResponse) {
  return response.assistantMessage?.content ?? response.answer?.answer ?? "";
}

function isGenericFailure(answer: string) {
  return /\b(?:je n'ai pas reussi|could not generate|reformule|no reliable source|cannot verify|tool-dependent|i cannot verify|pas de source fiable|impossible de verifier)\b/i.test(
    answer
  );
}

function isBrokenAnswer(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) {
    return true;
  }
  if (/\.{3}$/.test(trimmed)) {
    return true;
  }
  const normalized = normalizeGateText(trimmed);
  return (
    /(?:[,;:]|\s[-–])$/.test(trimmed) ||
    /\b(?:a|à|de|du|des|of|to|from)\s+(?:il|elle|it|he|she|they|considered|considere|considéré)\b/.test(
      normalized
    ) ||
    /\b(?:a|à|de|du|des|le|la|les|un|une|et|en|of|to|the|and|with|from)$/.test(normalized)
  );
}

function hasAnswerabilityTrace(response: ChatResponse) {
  return response.orchestrationTrace?.steps?.some((step) => step.id === "answerability") === true;
}

function requiresMultiSourceResearch(testCase: GeneralKnowledgeReliabilityCase) {
  return (
    testCase.expected.kind === "source_backed" ||
    (testCase.expected.kind === "tool_first" && testCase.expected.toolType === "research")
  );
}

export function inspectProductionGeneralKnowledgeCase(
  testCase: GeneralKnowledgeReliabilityCase,
  response: ChatResponse
): CaseResult {
  const answer = answerText(response);
  const issues: string[] = [];
  const expected = testCase.expected;
  const term = expectedTerm(testCase);
  const language = expectedLanguage(testCase);
  const toolType = response.tooling?.routing?.toolType ?? "none";
  const toolIntent = response.tooling?.routing?.intent ?? "none";
  const toolUsed = response.tooling?.used === true;
  const provider = response.generation?.provider ?? "unknown";
  const model = response.generation?.model ?? "unknown";
  const sources = response.tooling?.sources ?? [];
  const families = unique(sources.map(sourceFamily));
  const answerabilityMode = response.evidenceCapsule?.answerabilityMode ?? "missing";

  if (!hasAnswerabilityTrace(response)) {
    issues.push("missing_answerability_trace");
  }
  if (response.evidenceCapsule?.missingEvidence && response.evidenceCapsule.missingEvidence.length > 0) {
    issues.push(`missing_evidence:${response.evidenceCapsule.missingEvidence.join("|")}`);
  }
  if (response.generation?.usedStaticFallback) {
    issues.push("static_fallback");
  }
  if (response.conversationQuality?.passed === false) {
    issues.push(`quality:${response.conversationQuality.issues?.join("|") ?? "failed"}`);
  }
  if (!languageLooksRight(answer, language)) {
    issues.push(`wrong_language:${language}`);
  }
  if (isGenericFailure(answer)) {
    issues.push("generic_failure_answer");
  }
  if (isBrokenAnswer(answer)) {
    issues.push("broken_answer");
  }
  if (!termLooksPresent(answer, term)) {
    issues.push(`missing_expected_term:${term}`);
  }

  if (expected.kind === "source_backed") {
    if (answerabilityMode !== "source_backed") {
      issues.push(`answerability_mode:${answerabilityMode}`);
    }
    if (!toolUsed || toolType !== "research") {
      issues.push(`research_not_used:${toolType}`);
    }
    if (!response.evidenceCapsule?.sourceBound) {
      issues.push("source_not_bound");
    }
  }

  if (expected.kind === "direct_model") {
    if (toolUsed || (toolType !== "none" && toolType !== "unknown")) {
      issues.push(`unexpected_tool_for_direct:${toolType}`);
    }
    if (provider === "tool") {
      issues.push("unexpected_tool_provider_for_direct");
    }
  }

  if (expected.kind === "tool_first") {
    if (!toolUsed) {
      issues.push("tool_expected_but_not_used");
    }
    if (toolType !== expected.toolType) {
      issues.push(`tool_type:${toolType}:expected:${expected.toolType}`);
    }
  }

  if (requiresMultiSourceResearch(testCase)) {
    if (sources.length < 2) {
      issues.push(`insufficient_source_count:${sources.length}`);
    }
    if (families.length < 2) {
      issues.push(`insufficient_source_families:${families.join("|") || "none"}`);
    }
    if (sources.length > 0 && !sourcesMatchExpectedTerm(sources, term)) {
      issues.push(`source_subject_mismatch:${term}`);
    }
  } else if (expected.kind === "tool_first" && expected.toolType === "web") {
    if (sources.length < 1) {
      issues.push(`missing_tool_source:${expected.toolType}`);
    }
  }

  const shouldCheckSemanticRelevance =
    expected.kind === "source_backed" ||
    (expected.kind === "tool_first" && expected.toolType === "research" && toolUsed);
  const semanticRelevance = shouldCheckSemanticRelevance
    ? evaluateSourceAnswerRelevance({
        question: testCase.message,
        subject: term,
        answer,
        verifiedFacts: response.tooling?.verifiedFacts ?? [],
        language
      })
    : null;
  if (semanticRelevance && !semanticRelevance.passed) {
    issues.push(...semanticRelevance.issues.map((issue) => `semantic_${issue}`));
  }

  return {
    id: testCase.id,
    passed: issues.length === 0,
    issues,
    message: testCase.message,
    expectedKind: expected.kind,
    expectedTerm: term,
    expectedLanguage: language,
    answer,
    answerabilityMode,
    provider,
    model,
    toolType,
    toolIntent,
    toolUsed,
    sourceCount: sources.length,
    sourceFamilies: families,
    semanticRelevanceScore: semanticRelevance?.score ?? 100,
    semanticIntent: semanticRelevance?.intent ?? "not_evaluated",
    durationMs: response.durationMs ?? 0,
    usedStaticFallback: response.generation?.usedStaticFallback === true
  };
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

export async function runProductionGeneralKnowledgeReliabilityGate(args = parseArgs()) {
  const startedAt = Date.now();
  const selectedCases = selectProductionGeneralKnowledgeCases(args);
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
      results.push(inspectProductionGeneralKnowledgeCase(testCase, response));
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        issues: [`request_failed:${error instanceof Error ? error.message : String(error)}`],
        message: testCase.message,
        expectedKind: testCase.expected.kind,
        expectedTerm: expectedTerm(testCase),
        expectedLanguage: expectedLanguage(testCase),
        answer: "",
        answerabilityMode: "request_failed",
        provider: "request_failed",
        model: "request_failed",
        toolType: "request_failed",
        toolIntent: "request_failed",
        toolUsed: false,
        sourceCount: 0,
        sourceFamilies: [],
        semanticRelevanceScore: 0,
        semanticIntent: "request_failed",
        durationMs: 0,
        usedStaticFallback: false
      });
    }

    if (args.delayMs > 0 && index < selectedCases.length - 1) {
      await delay(args.delayMs);
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const issueCounts = countBy(results.flatMap((result) => result.issues.map((issue) => issue.split(":")[0] ?? issue)));
  const sourceBackedResults = results.filter((result) => result.expectedKind === "source_backed");
  const directResults = results.filter((result) => result.expectedKind === "direct_model");
  const toolResults = results.filter((result) => result.expectedKind === "tool_first");
  const avgDurationMs =
    results.length === 0
      ? 0
      : Math.round(results.reduce((total, result) => total + result.durationMs, 0) / results.length);
  const report = {
    version: "production-general-knowledge-reliability-gate-v2",
    createdAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    caseCount: selectedCases.length,
    completed: results.length,
    passed,
    failed,
    passRate: rate(passed, results.length),
    sourceBackedPassRate: rate(
      sourceBackedResults.filter((result) => result.passed).length,
      sourceBackedResults.length
    ),
    directPassRate: rate(directResults.filter((result) => result.passed).length, directResults.length),
    toolPassRate: rate(toolResults.filter((result) => result.passed).length, toolResults.length),
    wrongLanguageCount: issueCounts.wrong_language ?? 0,
    staticFallbackCount: issueCounts.static_fallback ?? 0,
    genericFailureCount: issueCounts.generic_failure_answer ?? 0,
    missingResearchCount: issueCounts.research_not_used ?? 0,
    insufficientSourceCount: issueCounts.insufficient_source_count ?? 0,
    insufficientSourceFamilyCount: issueCounts.insufficient_source_families ?? 0,
    sourceSubjectMismatchCount: issueCounts.source_subject_mismatch ?? 0,
    semanticRelevanceFailureCount: Object.entries(issueCounts)
      .filter(([issue]) => issue.startsWith("semantic_"))
      .reduce((total, [, count]) => total + count, 0),
    qualityFailureCount: issueCounts.quality ?? 0,
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
        toolType: result.toolType,
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
  runProductionGeneralKnowledgeReliabilityGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

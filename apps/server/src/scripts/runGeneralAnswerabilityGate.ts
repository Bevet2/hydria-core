import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ExpectedProvider = "tool" | "ollama";

type AnswerabilityGateCase = {
  id: string;
  language: "fr" | "en";
  message: string;
  conversation?: string[];
  expectedMode:
    | "direct_model"
    | "tool_first"
    | "source_backed"
    | "knowledge_augmented"
    | "conversation_state"
    | "specialist_synthesis";
  expectedEvidence?: string;
  expectedProvider?: ExpectedProvider;
  expectedToolType?: string;
  expectedTerms: Array<string | string[]>;
  forbidden?: RegExp[];
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
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
    requiredEvidence?: string[];
    preferredEvidence?: string[];
    usedEvidence?: string[];
    missingEvidence?: string[];
    sourceBound?: boolean;
    abstainIfMissing?: boolean;
    reliabilityLevel?: string;
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
      toolRequired?: boolean;
      toolRecommended?: boolean;
    };
  };
  orchestrationTrace?: {
    version?: string;
    steps?: Array<{ id?: string; status?: string; summary?: string }>;
  };
};

type CaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  answer: string;
  mode: string;
  usedEvidence: string[];
  missingEvidence: string[];
  provider: string;
  model: string;
  toolType: string;
  durationMs: number;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "general-answerability-gate-v1.json");

export const generalAnswerabilityGateCases: AnswerabilityGateCase[] = [
  {
    id: "fr_recent_ai_requires_research",
    language: "fr",
    message: "Quelles sont les nouveautes IA cette semaine ?",
    expectedMode: "source_backed",
    expectedEvidence: "source_research",
    expectedProvider: "tool",
    expectedToolType: "research",
    expectedTerms: ["IA"]
  },
  {
    id: "fr_calculator_tool_first",
    language: "fr",
    message: "Combien font 245 + 389 ?",
    expectedMode: "tool_first",
    expectedEvidence: "tool_live",
    expectedProvider: "tool",
    expectedToolType: "calculator",
    expectedTerms: ["634"]
  },
  {
    id: "en_current_crypto_tool_first",
    language: "en",
    message: "What is the current Bitcoin price?",
    expectedMode: "tool_first",
    expectedEvidence: "tool_live",
    expectedToolType: "finance",
    expectedTerms: [["Bitcoin", "BTC"]]
  },
  {
    id: "fr_time_tool_first",
    language: "fr",
    message: "Quelle heure est-il a Paris maintenant ?",
    expectedMode: "tool_first",
    expectedEvidence: "tool_live",
    expectedProvider: "tool",
    expectedToolType: "time",
    expectedTerms: ["Paris"]
  },
  {
    id: "fr_weather_tool_first",
    language: "fr",
    message: "Quelle est la meteo actuelle a Paris ?",
    expectedMode: "tool_first",
    expectedEvidence: "tool_live",
    expectedProvider: "tool",
    expectedToolType: "weather",
    expectedTerms: ["Paris"]
  },
  {
    id: "fr_stable_fact_source_backed",
    language: "fr",
    message: "Qui est Marie Curie ?",
    expectedMode: "source_backed",
    expectedEvidence: "source_research",
    expectedToolType: "research",
    expectedTerms: ["marie", "curie"]
  },
  {
    id: "en_latest_ai_requires_research",
    language: "en",
    message: "What are the latest AI model releases this week?",
    expectedMode: "source_backed",
    expectedEvidence: "source_research",
    expectedProvider: "tool",
    expectedToolType: "research",
    expectedTerms: [["AI", "model"]]
  },
  {
    id: "en_stable_concept_source_backed",
    language: "en",
    message: "What is Docker?",
    expectedMode: "source_backed",
    expectedEvidence: "source_research",
    expectedToolType: "research",
    expectedTerms: ["docker"]
  },
  {
    id: "en_code_specialist",
    language: "en",
    message: "Debug a Docker build error where npm install fails.",
    expectedMode: "specialist_synthesis",
    expectedEvidence: "specialist_model",
    expectedProvider: "ollama",
    expectedTerms: ["docker", "npm"]
  },
  {
    id: "en_debug_api_502_specialist",
    language: "en",
    message: "Debug an API error that returns HTTP 502 after checkout.",
    expectedMode: "specialist_synthesis",
    expectedEvidence: "specialist_model",
    expectedProvider: "ollama",
    expectedTerms: ["502", "API"]
  },
  {
    id: "en_repo_analysis_concept_no_repo_tool",
    language: "en",
    message: "How should I analyze a repository efficiently if I have not provided a repo URL?",
    expectedMode: "specialist_synthesis",
    expectedEvidence: "specialist_model",
    expectedProvider: "ollama",
    expectedTerms: [["repo", "repository"]]
  },
  {
    id: "fr_recipe_direct_model",
    language: "fr",
    message: "Donne moi une recette de tiramisu.",
    expectedMode: "direct_model",
    expectedProvider: "ollama",
    expectedTerms: ["tiramisu", "mascarpone", ["cafe", "cacao"]]
  },
  {
    id: "fr_customer_delay_message_direct",
    language: "fr",
    message: "Redige un message court pour prevenir un client d'un retard de livraison.",
    expectedMode: "direct_model",
    expectedProvider: "ollama",
    expectedTerms: ["retard", "livraison"]
  },
  {
    id: "fr_strategy_specialist",
    language: "fr",
    message: "Budget bloque, deadline demain, on-prem uniquement. Tu recommandes quoi ?",
    expectedMode: "specialist_synthesis",
    expectedEvidence: "multi_specialist_synthesis",
    expectedProvider: "ollama",
    expectedTerms: ["on-prem", ["budget", "deadline", "demain"]],
    forbidden: [/microservices/i]
  },
  {
    id: "fr_realtime_streaming_not_weather",
    language: "fr",
    message: "Explique le traitement temps reel dans une architecture streaming.",
    expectedMode: "direct_model",
    expectedTerms: ["streaming"],
    forbidden: [/meteo|weather/i]
  },
  {
    id: "fr_migration_document_no_file_tool",
    language: "fr",
    message: "Comment structurer un document de migration technique ?",
    expectedMode: "direct_model",
    expectedProvider: "ollama",
    expectedTerms: ["migration"]
  },
  {
    id: "en_product_strategy_specialist",
    language: "en",
    message: "No budget for a broad launch, weak mid-market signal only. Should we launch broadly or narrow the beta?",
    expectedMode: "specialist_synthesis",
    expectedEvidence: "multi_specialist_synthesis",
    expectedProvider: "ollama",
    expectedTerms: ["beta", "mid-market"]
  },
  {
    id: "fr_hydria_knowledge_augmented",
    language: "fr",
    message: "Explique le role des watchers dans Hydria Core.",
    expectedMode: "knowledge_augmented",
    expectedEvidence: "governed_knowledge",
    expectedTerms: ["watcher", "Hydria"]
  },
  {
    id: "en_hydria_watchers_knowledge_augmented",
    language: "en",
    message: "Explain Hydria Core watchers and what they are for.",
    expectedMode: "knowledge_augmented",
    expectedEvidence: "governed_knowledge",
    expectedTerms: ["watcher", "Hydria"]
  },
  {
    id: "fr_conversation_memory_recall",
    language: "fr",
    message: "Comment s'appelle mon projet ?",
    conversation: [
      "Mon projet s'appelle Hydria Core.",
      "Comment s'appelle mon projet ?"
    ],
    expectedMode: "conversation_state",
    expectedEvidence: "conversation_memory",
    expectedProvider: "tool",
    expectedTerms: ["Hydria Core"]
  },
  {
    id: "en_stable_general_direct",
    language: "en",
    message: "Explain eventual consistency with a practical example.",
    expectedMode: "source_backed",
    expectedEvidence: "source_research",
    expectedTerms: [["consistency", "replica", "replicas"]]
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
    offset: Math.max(0, numberOption(argv, "--offset", 0)),
    limit: limit ? Math.max(0, Number(limit)) : null,
    caseIds: readCsvOptions(argv, ["--case-id", "--case-ids"]),
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? ""
  };
}

function selectCases(args: Pick<Args, "caseIds" | "limit" | "offset">) {
  const cases =
    args.caseIds.length > 0
      ? args.caseIds.map((id) => {
          const testCase = generalAnswerabilityGateCases.find((candidate) => candidate.id === id);
          if (!testCase) {
            throw new Error(`Unknown general answerability gate case id: ${id}`);
          }
          return testCase;
        })
      : generalAnswerabilityGateCases;
  const start = Math.max(0, args.offset);
  const end = args.limit === null ? undefined : start + Math.max(0, args.limit);
  return cases.slice(start, end);
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesExpected(actual: string, expected: string | string[]) {
  const values = Array.isArray(expected) ? expected : [expected];
  return values.some((value) => normalize(actual).includes(normalize(value)));
}

function languageLooksRight(answer: string, language: AnswerabilityGateCase["language"]) {
  const normalized = normalize(answer);
  const frenchSignals = /\b(?:le|la|les|une|des|est|donc|pour|avec|je|recommande|voici|recette|cafe)\b/.test(
    normalized
  );
  const englishSignals = /\b(?:the|this|that|with|should|because|recommend|docker|example)\b/.test(
    normalized
  );
  return language === "fr" ? frenchSignals || !englishSignals : englishSignals || !frenchSignals;
}

function hasGenericFailure(answer: string) {
  return /\b(?:je n'ai pas reussi|could not generate|reformule|no reliable source|cannot verify|tool-dependent|i cannot verify)\b/i.test(
    answer
  );
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

function answerText(response: ChatResponse) {
  return response.assistantMessage?.content ?? response.answer?.answer ?? "";
}

function conversationForCase(testCase: AnswerabilityGateCase) {
  return testCase.conversation && testCase.conversation.length > 0
    ? testCase.conversation
    : [testCase.message];
}

function inspectCase(testCase: AnswerabilityGateCase, response: ChatResponse): CaseResult {
  const answer = answerText(response);
  const issues: string[] = [];
  const evidence = response.evidenceCapsule;
  const provider = response.generation?.provider ?? "unknown";
  const model = response.generation?.model ?? "unknown";
  const toolType = response.tooling?.routing?.toolType ?? "none";
  const usedEvidence = evidence?.usedEvidence ?? [];
  const missingEvidence = evidence?.missingEvidence ?? [];

  if (!evidence) {
    issues.push("missing_evidence_capsule");
  } else {
    if (evidence.answerabilityMode !== testCase.expectedMode) {
      issues.push(`answerability_mode:${evidence.answerabilityMode}`);
    }
    if (testCase.expectedEvidence) {
      const required = evidence.requiredEvidence ?? [];
      const preferred = evidence.preferredEvidence ?? [];
      if (![...required, ...preferred].includes(testCase.expectedEvidence)) {
        issues.push(`missing_expected_evidence:${testCase.expectedEvidence}`);
      }
    }
    if (missingEvidence.length > 0 && evidence.abstainIfMissing) {
      issues.push(`missing_blocking_evidence:${missingEvidence.join("|")}`);
    }
  }

  if (testCase.expectedProvider && provider !== testCase.expectedProvider) {
    issues.push(`provider:${provider}`);
  }
  if (testCase.expectedToolType && toolType !== testCase.expectedToolType) {
    issues.push(`toolType:${toolType}`);
  }
  if (testCase.expectedToolType && response.tooling?.used !== true) {
    issues.push("tool_expected_but_not_used");
  }
  if (response.generation?.usedStaticFallback) {
    issues.push("static_fallback");
  }
  if (response.conversationQuality?.passed === false) {
    issues.push(`quality:${response.conversationQuality.issues?.join("|") ?? "failed"}`);
  }
  if (!response.orchestrationTrace?.steps?.some((step) => step.id === "answerability")) {
    issues.push("missing_answerability_trace");
  }
  if (!languageLooksRight(answer, testCase.language)) {
    issues.push(`wrong_language:${testCase.language}`);
  }
  if (hasGenericFailure(answer)) {
    issues.push("generic_failure_answer");
  }
  for (const expected of testCase.expectedTerms) {
    if (!includesExpected(answer, expected)) {
      issues.push(`missing_expected_term:${Array.isArray(expected) ? expected.join("|") : expected}`);
    }
  }
  if (testCase.forbidden?.some((pattern) => pattern.test(answer))) {
    issues.push("forbidden_pattern");
  }

  return {
    id: testCase.id,
    passed: issues.length === 0,
    issues,
    answer,
    mode: evidence?.answerabilityMode ?? "missing",
    usedEvidence,
    missingEvidence,
    provider,
    model,
    toolType,
    durationMs: response.durationMs ?? 0
  };
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

export async function runGeneralAnswerabilityGate(args = parseArgs()) {
  const startedAt = Date.now();
  const selectedCases = selectCases(args);
  const results: CaseResult[] = [];

  for (const testCase of selectedCases) {
    try {
      let sessionId: string | undefined;
      let response: ChatResponse | null = null;
      for (const message of conversationForCase(testCase)) {
        response = await postJson<ChatResponse>({
          baseUrl: args.baseUrl,
          path: "/api/chat/message",
          body: {
            message,
            ...(sessionId ? { sessionId } : {})
          },
          timeoutMs: args.timeoutMs,
          apiKey: args.apiKey
        });
        sessionId = response.sessionId ?? sessionId;
      }
      if (!response) {
        throw new Error("case did not execute any chat turn");
      }
      results.push(inspectCase(testCase, response));
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        issues: [error instanceof Error ? error.message : String(error)],
        answer: "",
        mode: "error",
        usedEvidence: [],
        missingEvidence: [],
        provider: "error",
        model: "error",
        toolType: "error",
        durationMs: 0
      });
    }
  }

  const failed = results.filter((result) => !result.passed);
  const report = {
    version: "hydria-general-answerability-gate-v1",
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl
    },
    passed: failed.length === 0,
    summary: {
      totalCases: results.length,
      passedCases: results.length - failed.length,
      failedCases: failed.length,
      passRate: rate(results.length - failed.length, results.length),
      missingEvidenceCapsuleRate: rate(results.filter((result) => result.issues.includes("missing_evidence_capsule")).length, results.length),
      toolExpectedButNotUsed: results.filter((result) => result.issues.includes("tool_expected_but_not_used")).length,
      wrongLanguageRate: rate(results.filter((result) => result.issues.some((issue) => issue.startsWith("wrong_language"))).length, results.length),
      genericFailureRate: rate(results.filter((result) => result.issues.includes("generic_failure_answer")).length, results.length),
      staticFallbackRate: rate(results.filter((result) => result.issues.includes("static_fallback")).length, results.length),
      durationMs: Date.now() - startedAt,
      byMode: countBy(results.map((result) => result.mode)),
      byProvider: countBy(results.map((result) => result.provider)),
      byToolType: countBy(results.map((result) => result.toolType))
    },
    failedCaseIds: failed.map((result) => result.id),
    results
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  const args = parseArgs();
  runGeneralAnswerabilityGate(args)
    .then((report) => {
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
      process.exit(report.passed ? 0 : 1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

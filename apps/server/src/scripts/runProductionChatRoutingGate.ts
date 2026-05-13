import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelRuntimeBudgetProfile } from "../services/models/modelRuntimeGovernor.js";

type ExpectedProvider = "ollama" | "tool";
type ExpectedToolType = "none" | "calculator" | "weather" | "finance" | "time" | "web";
type Language = "fr" | "en";

type TurnExpectation = {
  provider?: ExpectedProvider;
  model?: string | string[];
  budgetProfile?: ModelRuntimeBudgetProfile | ModelRuntimeBudgetProfile[];
  toolType?: ExpectedToolType;
  runtimeMode?: "direct" | "conversation";
  maxLatencyMs?: number;
  allowRetry?: boolean;
  allowFallback?: boolean;
  allowQualityFailure?: boolean;
};

type RoutingGateTurn = {
  message: string;
  expect?: TurnExpectation;
};

type RoutingGateCase = {
  id: string;
  description: string;
  routeFamily: string;
  language: Language;
  turns: RoutingGateTurn[];
  expectedFinalTerms?: string[];
  forbiddenFinalPatterns?: RegExp[];
};

type ChatResponse = {
  sessionId?: string;
  runtimeMode?: "direct" | "conversation";
  category?: string;
  durationMs?: number;
  usedRetry?: boolean;
  assistantMessage?: { content?: string };
  answer?: { answer?: string; confidence?: number };
  conversationQuality?: { passed?: boolean; issues?: string[] };
  generation?: {
    provider?: string;
    model?: string;
    usedStaticFallback?: boolean;
    validationIssues?: string[];
    runtimeBudget?: {
      profile?: string;
      timeoutMs?: number;
      maxLatencyMs?: number;
      maxOutputTokens?: number;
    };
    attempts?: Array<{
      model?: string;
      status?: string;
      latencyMs?: number;
      timeoutMs?: number;
      budgetProfile?: string;
      error?: string;
    }>;
    specialist?: {
      role?: string;
      capabilityId?: string;
      routingReason?: string;
    };
  };
  tooling?: {
    route?: string;
    used?: boolean;
    routing?: {
      toolRequired?: boolean;
      toolRecommended?: boolean;
      toolType?: string;
      intent?: string;
      toolResultUsed?: boolean;
    };
    failureReason?: string | null;
  };
};

type TurnResult = {
  index: number;
  message: string;
  passed: boolean;
  issues: string[];
  answer: string;
  provider: string;
  model: string;
  budgetProfile: string;
  runtimeMode: string;
  toolType: string;
  toolUsed: boolean;
  toolRequired: boolean;
  usedRetry: boolean;
  usedStaticFallback: boolean;
  qualityPassed: boolean;
  latencyMs: number;
  attempts: Array<{
    model: string;
    status: string;
    latencyMs: number;
    timeoutMs: number | null;
    budgetProfile: string;
    error: string | null;
  }>;
};

type CaseResult = {
  id: string;
  description: string;
  routeFamily: string;
  passed: boolean;
  issues: string[];
  finalAnswer: string;
  turns: TurnResult[];
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  delayMs: number;
  maxDurationMs: number;
  limit: number | null;
  apiKey: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "production-chat-routing-gate-v1.json");

const standardLightExpectation: TurnExpectation = {
  provider: "ollama",
  model: "qwen2.5:3b",
  budgetProfile: "standard_light_chat",
  maxLatencyMs: 45000
};

const conciseExpectation: TurnExpectation = {
  provider: "ollama",
  model: "qwen2.5:3b",
  budgetProfile: "concise_chat",
  maxLatencyMs: 35000
};

const contextAckExpectation: TurnExpectation = {
  provider: "tool",
  model: "context_ack",
  budgetProfile: "fast_tool",
  maxLatencyMs: 3000
};

const writingExpectation: TurnExpectation = {
  provider: "ollama",
  model: ["mistral:7b", "qwen2.5:3b"],
  budgetProfile: "writing_chat",
  maxLatencyMs: 70000
};

const stableFactExpectation: TurnExpectation = {
  provider: "ollama",
  model: ["mistral:7b", "qwen2.5:3b"],
  budgetProfile: "stable_fact_chat",
  maxLatencyMs: 90000,
  allowRetry: true
};

const codeExpectation: TurnExpectation = {
  provider: "ollama",
  model: "qwen2.5-coder:7b",
  budgetProfile: "code_chat",
  maxLatencyMs: 90000
};

const deepExpectation: TurnExpectation = {
  provider: "ollama",
  model: "qwen2.5:14b",
  budgetProfile: "deep_reasoning",
  maxLatencyMs: 150000
};

const cases: RoutingGateCase[] = [
  {
    id: "tool_calculator_fr_multiplication",
    description: "Exact arithmetic should bypass the model through the calculator tool.",
    routeFamily: "fast_tool",
    language: "fr",
    turns: [{ message: "Calcule 12 * 37.", expect: { provider: "tool", model: "calculator", budgetProfile: "fast_tool", toolType: "calculator", maxLatencyMs: 3000 } }],
    expectedFinalTerms: ["444"]
  },
  {
    id: "tool_calculator_en_division",
    description: "English arithmetic should stay deterministic.",
    routeFamily: "fast_tool",
    language: "en",
    turns: [{ message: "Calculate 144 / 12.", expect: { provider: "tool", model: "calculator", budgetProfile: "fast_tool", toolType: "calculator", maxLatencyMs: 3000 } }],
    expectedFinalTerms: ["12"]
  },
  {
    id: "tool_calculator_fr_addition",
    description: "Simple addition should not call a local LLM.",
    routeFamily: "fast_tool",
    language: "fr",
    turns: [{ message: "Combien font 245 + 389 ?", expect: { provider: "tool", model: "calculator", budgetProfile: "fast_tool", toolType: "calculator", maxLatencyMs: 3000 } }],
    expectedFinalTerms: ["634"]
  },
  {
    id: "concise_hydria_core_fr",
    description: "Hydria Core short product question should use the concise 3B path.",
    routeFamily: "concise_chat",
    language: "fr",
    turns: [{ message: "Reponds en une phrase courte : quel est le role de Hydria Core ?", expect: conciseExpectation }],
    expectedFinalTerms: ["Hydria Core", "runtime"]
  },
  {
    id: "concise_postgresql_fr",
    description: "Short stable technical explanation should use Qwen 3B.",
    routeFamily: "concise_chat",
    language: "fr",
    turns: [{ message: "Reponds en moins de 12 mots : explique PostgreSQL.", expect: conciseExpectation }],
    expectedFinalTerms: ["PostgreSQL"]
  },
  {
    id: "concise_api_en",
    description: "English brief answer should remain English and concise.",
    routeFamily: "concise_chat",
    language: "en",
    turns: [{ message: "Briefly explain what an API is.", expect: conciseExpectation }],
    expectedFinalTerms: ["API"]
  },
  {
    id: "concise_cache_en",
    description: "Under-N-words instruction should route to concise budget.",
    routeFamily: "concise_chat",
    language: "en",
    turns: [{ message: "Under 10 words: define caching.", expect: conciseExpectation }],
    expectedFinalTerms: ["cach"]
  },
  {
    id: "concise_docker_fr",
    description: "French short definition should stay in French.",
    routeFamily: "concise_chat",
    language: "fr",
    turns: [{ message: "Reponse courte : c'est quoi Docker ?", expect: conciseExpectation }],
    expectedFinalTerms: ["Docker"]
  },
  {
    id: "context_setup_fr_topic",
    description: "Lightweight context setup should not hit the heavy brain.",
    routeFamily: "context_setup",
    language: "fr",
    turns: [{ message: "On parle de bases de donnees.", expect: contextAckExpectation }],
    expectedFinalTerms: ["base"]
  },
  {
    id: "context_setup_en_topic",
    description: "English context setup should use the fast context route.",
    routeFamily: "context_setup",
    language: "en",
    turns: [{ message: "We are talking about incident response.", expect: contextAckExpectation }],
    expectedFinalTerms: ["incident"]
  },
  {
    id: "context_setup_then_brevity",
    description: "Context plus later brevity constraint should keep the same session and concise route.",
    routeFamily: "context_setup",
    language: "fr",
    turns: [
      { message: "On parle de bases de donnees.", expect: contextAckExpectation },
      { message: "Pour la suite, reponds en moins de 12 mots.", expect: { ...contextAckExpectation, runtimeMode: "conversation" } },
      { message: "Explique PostgreSQL en respectant ma contrainte.", expect: { ...conciseExpectation, runtimeMode: "conversation" } }
    ],
    expectedFinalTerms: ["PostgreSQL"]
  },
  {
    id: "standard_charlemagne_fr",
    description: "Stable biography should use the Mistral factual writing route, not the 3B definition route.",
    routeFamily: "stable_factual_chat",
    language: "fr",
    turns: [{ message: "Qui est Charlemagne ?", expect: stableFactExpectation }],
    expectedFinalTerms: ["Charlemagne"]
  },
  {
    id: "standard_eventual_consistency_en",
    description: "Short stable distributed-systems concept should use standard-light chat.",
    routeFamily: "standard_light_chat",
    language: "en",
    turns: [{ message: "What is eventual consistency?", expect: standardLightExpectation }],
    expectedFinalTerms: ["consistency"]
  },
  {
    id: "standard_rest_api_fr",
    description: "Conceptual REST API question should not route to code specialist or the 14B brain.",
    routeFamily: "standard_light_chat",
    language: "fr",
    turns: [{ message: "Explique ce qu'est une API REST.", expect: standardLightExpectation }],
    expectedFinalTerms: ["API"]
  },
  {
    id: "standard_idempotency_en",
    description: "Stable definition should use standard-light chat on CPU.",
    routeFamily: "standard_light_chat",
    language: "en",
    turns: [{ message: "Define idempotency in distributed systems.", expect: standardLightExpectation }],
    expectedFinalTerms: ["idempot"]
  },
  {
    id: "writing_client_delay_fr",
    description: "Operational writing should use the writing specialist.",
    routeFamily: "writing_chat",
    language: "fr",
    turns: [{ message: "Redige un mail pour annoncer un retard de livraison a un client enterprise.", expect: writingExpectation }],
    expectedFinalTerms: ["retard"]
  },
  {
    id: "writing_stakeholder_update_en",
    description: "Stakeholder update should use the writing route.",
    routeFamily: "writing_chat",
    language: "en",
    turns: [{ message: "Write a stakeholder update about a delayed database migration.", expect: writingExpectation }],
    expectedFinalTerms: ["migration"]
  },
  {
    id: "writing_summary_fr",
    description: "Summary writing should use the writing route.",
    routeFamily: "writing_chat",
    language: "fr",
    turns: [{ message: "Resume ce plan en trois points: audit, migration, verification.", expect: writingExpectation }],
    expectedFinalTerms: ["audit"]
  },
  {
    id: "writing_announcement_en",
    description: "Announcement draft should use writing route.",
    routeFamily: "writing_chat",
    language: "en",
    turns: [{ message: "Draft a migration announcement for internal teams.", expect: writingExpectation }],
    expectedFinalTerms: ["migration"]
  },
  {
    id: "code_typescript_api_en",
    description: "Debugging TypeScript API should use code specialist.",
    routeFamily: "code_chat",
    language: "en",
    turns: [{ message: "Debug this TypeScript API error from a failing repository test.", expect: codeExpectation }],
    expectedFinalTerms: ["TypeScript"]
  },
  {
    id: "code_python_stack_fr",
    description: "Python stack trace diagnostic should use code specialist.",
    routeFamily: "code_chat",
    language: "fr",
    turns: [{ message: "Explique comment debugger une stack trace Python dans une API.", expect: codeExpectation }],
    expectedFinalTerms: ["Python"]
  },
  {
    id: "code_node_tests_en",
    description: "Node API bug should use code specialist.",
    routeFamily: "code_chat",
    language: "en",
    turns: [{ message: "How should I structure tests for a Node API bug?", expect: codeExpectation }],
    expectedFinalTerms: ["test"]
  },
  {
    id: "code_sql_perf_en",
    description: "SQL performance issue should route to code/debug specialist.",
    routeFamily: "code_chat",
    language: "en",
    turns: [{ message: "Review this SQL query performance issue and suggest the first diagnostic step.", expect: codeExpectation }],
    expectedFinalTerms: ["SQL"]
  },
  {
    id: "deep_arch_onprem_fr",
    description: "Architecture conflict with explicit recommendation should use deep reasoner.",
    routeFamily: "deep_reasoning",
    language: "fr",
    turns: [{ message: "Architecture: on-prem obligatoire, deadline demain, budget bloque. Tu recommandes quoi ?", expect: deepExpectation }],
    expectedFinalTerms: ["on-prem"]
  },
  {
    id: "deep_incident_rollback_fr",
    description: "Incident rollback decision should use deep reasoner.",
    routeFamily: "deep_reasoning",
    language: "fr",
    turns: [{ message: "Incident prod: erreurs 500 apres deploy, impact paiement. Rollback ou attendre ? Decision critique.", expect: deepExpectation }],
    expectedFinalTerms: ["paiement"]
  },
  {
    id: "deep_tradeoff_en",
    description: "Explicit architecture tradeoff should use deep reasoner.",
    routeFamily: "deep_reasoning",
    language: "en",
    turns: [{ message: "Architecture tradeoff: auditability, low latency, one backend engineer. Pick the default and explain the compromise.", expect: deepExpectation }],
    expectedFinalTerms: ["audit"]
  },
  {
    id: "tool_weather_paris_fr",
    description: "Current weather should require and use the weather tool.",
    routeFamily: "live_tool",
    language: "fr",
    turns: [{ message: "Quel temps fait-il aujourd'hui a Paris ?", expect: { toolType: "weather", maxLatencyMs: 90000 } }],
    expectedFinalTerms: ["Paris"]
  },
  {
    id: "tool_time_paris_fr",
    description: "Current time should use time tool and fast-tool budget.",
    routeFamily: "live_tool",
    language: "fr",
    turns: [{ message: "Quelle est l'heure actuelle a Paris ?", expect: { provider: "tool", model: "time", budgetProfile: "fast_tool", toolType: "time", maxLatencyMs: 45000 } }],
    expectedFinalTerms: ["Paris"]
  },
  {
    id: "tool_bitcoin_price_en",
    description: "Current crypto price should use finance tooling.",
    routeFamily: "live_tool",
    language: "en",
    turns: [{ message: "What is the current Bitcoin price?", expect: { toolType: "finance", maxLatencyMs: 90000 } }],
    expectedFinalTerms: ["Bitcoin"]
  },
  {
    id: "tool_current_ceo_en",
    description: "Current CEO lookup should require web tooling.",
    routeFamily: "live_tool",
    language: "en",
    turns: [{ message: "Who is the current CEO of OpenAI?", expect: { toolType: "web", maxLatencyMs: 90000 } }],
    expectedFinalTerms: ["OpenAI"]
  },
  {
    id: "memory_name_fr",
    description: "Simple memory recall should not require cloud fallback.",
    routeFamily: "memory",
    language: "fr",
    turns: [
      { message: "Je m'appelle Marc et je travaille sur Hydria.", expect: { maxLatencyMs: 70000 } },
      { message: "Comment je m'appelle ?", expect: { maxLatencyMs: 70000, runtimeMode: "conversation" } }
    ],
    expectedFinalTerms: ["Marc"]
  },
  {
    id: "memory_project_en",
    description: "English memory recall should keep context.",
    routeFamily: "memory",
    language: "en",
    turns: [
      { message: "My project is called Hydria Core.", expect: { maxLatencyMs: 70000 } },
      { message: "What is my project called?", expect: { maxLatencyMs: 70000, runtimeMode: "conversation" } }
    ],
    expectedFinalTerms: ["Hydria Core"]
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

function parseArgs(argv = process.argv.slice(2)): Args {
  const limit = readOption(argv, "--limit");
  return {
    baseUrl: (readOption(argv, "--base-url") ?? "https://app.hydria.click").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? "180000"),
    delayMs: Number(readOption(argv, "--delay-ms") ?? "1000"),
    maxDurationMs: Number(readOption(argv, "--max-duration-ms") ?? "0"),
    limit: limit ? Number(limit) : null,
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? ""
  };
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

function includesExpected(actual: string | undefined, expected: string | string[] | undefined) {
  if (!expected) {
    return true;
  }
  const values = Array.isArray(expected) ? expected : [expected];
  return values.includes(actual ?? "");
}

function includesBudgetProfile(actual: string | undefined, expected: TurnExpectation["budgetProfile"]) {
  if (!expected) {
    return true;
  }
  const values = Array.isArray(expected) ? expected : [expected];
  return values.includes(actual as ModelRuntimeBudgetProfile);
}

function languageLooksRight(answer: string, language: Language) {
  const normalized = normalize(answer);
  const frenchSignals = /\b(?:le|la|les|une|des|est|donc|pour|avec|choisir|recommande|definition|donnees)\b/.test(
    normalized
  );
  const englishSignals = /\b(?:the|this|that|with|should|first|default|because|recommend|definition|is|are|a|an)\b/.test(
    normalized
  );
  return language === "fr" ? frenchSignals || !englishSignals : englishSignals || !frenchSignals;
}

function hasInternalLeak(value: string) {
  return /\b(?:ActiveConstraintCapsule|Answer policy|hidden instruction|system prompt|developer prompt|prompt policy|conversationQuality|answerMode|local specialist|runtimeBudget)\b/i.test(
    value
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function evaluateTurn(args: {
  turn: RoutingGateTurn;
  response: ChatResponse;
  answer: string;
  language: Language;
  durationMs: number;
  index: number;
}): TurnResult {
  const expectation = args.turn.expect ?? {};
  const provider = args.response.generation?.provider ?? "unknown";
  const model = args.response.generation?.model ?? "unknown";
  const budgetProfile = args.response.generation?.runtimeBudget?.profile ?? "unknown";
  const runtimeMode = args.response.runtimeMode ?? "unknown";
  const toolType = args.response.tooling?.routing?.toolType ?? "none";
  const toolUsed = Boolean(args.response.tooling?.used);
  const toolRequired = Boolean(args.response.tooling?.routing?.toolRequired);
  const usedStaticFallback = Boolean(args.response.generation?.usedStaticFallback || provider === "fallback");
  const usedModelRetry = (provider === "ollama" || provider === "fallback") && Boolean(args.response.usedRetry);
  const qualityPassed = args.response.conversationQuality?.passed !== false;
  const attempts =
    args.response.generation?.attempts?.map((attempt) => ({
      model: attempt.model ?? "unknown",
      status: attempt.status ?? "unknown",
      latencyMs: Math.max(0, Math.round(attempt.latencyMs ?? 0)),
      timeoutMs: typeof attempt.timeoutMs === "number" ? attempt.timeoutMs : null,
      budgetProfile: attempt.budgetProfile ?? "unknown",
      error: attempt.error ?? null
    })) ?? [];
  const issues: string[] = [];

  if (expectation.provider && provider !== expectation.provider) {
    issues.push(`provider:${provider}`);
  }
  if (!includesExpected(model, expectation.model)) {
    issues.push(`model:${model}`);
  }
  if (!includesBudgetProfile(budgetProfile, expectation.budgetProfile)) {
    issues.push(`budgetProfile:${budgetProfile}`);
  }
  if (expectation.toolType && toolType !== expectation.toolType) {
    issues.push(`toolType:${toolType}`);
  }
  if (expectation.toolType && expectation.toolType !== "none" && toolRequired && !toolUsed) {
    issues.push("tool_required_but_not_used");
  }
  if (expectation.runtimeMode && runtimeMode !== expectation.runtimeMode) {
    issues.push(`runtimeMode:${runtimeMode}`);
  }
  if (expectation.maxLatencyMs && args.durationMs > expectation.maxLatencyMs) {
    issues.push(`latency:${args.durationMs}`);
  }
  if (!expectation.allowFallback && usedStaticFallback) {
    issues.push("static_fallback");
  }
  if (!expectation.allowRetry && usedModelRetry) {
    issues.push("retry");
  }
  if (!expectation.allowQualityFailure && !qualityPassed) {
    issues.push(`quality:${args.response.conversationQuality?.issues?.join("|") ?? "failed"}`);
  }
  if (!languageLooksRight(args.answer, args.language)) {
    issues.push(`wrong_language:${args.language}`);
  }
  if (hasInternalLeak(args.answer)) {
    issues.push("internal_leak");
  }

  return {
    index: args.index,
    message: args.turn.message,
    passed: issues.length === 0,
    issues,
    answer: args.answer,
    provider,
    model,
    budgetProfile,
    runtimeMode,
    toolType,
    toolUsed,
    toolRequired,
    usedRetry: usedModelRetry,
    usedStaticFallback,
    qualityPassed,
    latencyMs: args.durationMs,
    attempts
  };
}

async function runCase(testCase: RoutingGateCase, args: Args): Promise<CaseResult> {
  let sessionId: string | undefined;
  const turns: TurnResult[] = [];
  const issues: string[] = [];
  let finalAnswer = "";

  for (const [index, turn] of testCase.turns.entries()) {
    if (index > 0 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
    const startedAt = Date.now();
    const response = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      sessionId ? { sessionId, message: turn.message } : { message: turn.message },
      args.timeoutMs,
      args.apiKey
    );
    sessionId = response.sessionId;
    finalAnswer = answerText(response);
    turns.push(
      evaluateTurn({
        turn,
        response,
        answer: finalAnswer,
        language: testCase.language,
        durationMs: response.durationMs ?? Date.now() - startedAt,
        index
      })
    );
  }

  const normalizedAnswer = normalize(finalAnswer);
  for (const term of testCase.expectedFinalTerms ?? []) {
    if (!normalizedAnswer.includes(normalize(term))) {
      issues.push(`missing_final_term:${term}`);
    }
  }
  if (testCase.forbiddenFinalPatterns?.some((pattern) => pattern.test(finalAnswer))) {
    issues.push("forbidden_final_pattern");
  }
  for (const turn of turns) {
    if (!turn.passed) {
      issues.push(`turn_${turn.index}:${turn.issues.join("|")}`);
    }
  }

  return {
    id: testCase.id,
    description: testCase.description,
    routeFamily: testCase.routeFamily,
    passed: issues.length === 0,
    issues,
    finalAnswer,
    turns
  };
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

function countBy<T extends string>(values: T[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export async function runProductionChatRoutingGate(args = parseArgs()) {
  const selectedCases = args.limit ? cases.slice(0, args.limit) : cases;
  const startedAt = Date.now();
  const telemetrySince = new Date(startedAt).toISOString();
  const results: CaseResult[] = [];
  let stoppedReason: string | null = null;

  const buildReport = () => {
    const allTurns = results.flatMap((result) => result.turns);
    const latencies = allTurns.map((turn) => turn.latencyMs);
    const failedCases = results.filter((result) => !result.passed);
    const failedTurns = allTurns.filter((turn) => !turn.passed);
    const toolRequiredTurns = allTurns.filter((turn) => turn.toolRequired);
    const completed = results.length === selectedCases.length && !stoppedReason;
    return {
      version: "hydria-production-chat-routing-gate-v1",
      generatedAt: new Date().toISOString(),
      target: {
        baseUrl: args.baseUrl,
        caseCount: selectedCases.length,
        timeoutMs: args.timeoutMs,
        delayMs: args.delayMs,
        maxDurationMs: args.maxDurationMs,
        telemetrySince
      },
      completed,
      stoppedReason,
      passed: completed && failedCases.length === 0,
      summary: {
        plannedCases: selectedCases.length,
        completedCases: results.length,
        passedCases: results.length - failedCases.length,
        failedCases: failedCases.length,
        totalTurns: allTurns.length,
        failedTurns: failedTurns.length,
        passRate: rate(results.length - failedCases.length, results.length),
        localOllamaRate: rate(allTurns.filter((turn) => turn.provider === "ollama").length, allTurns.length),
        toolProviderRate: rate(allTurns.filter((turn) => turn.provider === "tool").length, allTurns.length),
        staticFallbackRate: rate(allTurns.filter((turn) => turn.usedStaticFallback).length, allTurns.length),
        retryRate: rate(allTurns.filter((turn) => turn.usedRetry).length, allTurns.length),
        qualityFailureRate: rate(allTurns.filter((turn) => !turn.qualityPassed).length, allTurns.length),
        toolRequiredButNotUsed: toolRequiredTurns.filter((turn) => !turn.toolUsed).length,
        p50LatencyMs: percentile(latencies, 50),
        p95LatencyMs: percentile(latencies, 95),
        maxLatencyMs: Math.max(0, ...latencies),
        durationMs: Date.now() - startedAt,
        byRouteFamily: countBy(results.map((result) => result.routeFamily)),
        byProvider: countBy(allTurns.map((turn) => turn.provider)),
        byBudgetProfile: countBy(allTurns.map((turn) => turn.budgetProfile)),
        byModel: countBy(allTurns.map((turn) => turn.model))
      },
      failedCaseIds: failedCases.map((result) => result.id),
      results
    };
  };

  const writeReport = async () => {
    await mkdir(dirname(args.output), { recursive: true });
    const report = buildReport();
    await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  };

  for (const [index, testCase] of selectedCases.entries()) {
    if (args.maxDurationMs > 0 && Date.now() - startedAt > args.maxDurationMs) {
      stoppedReason = "max_duration_reached";
      break;
    }
    if (index > 0 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
    try {
      results.push(await runCase(testCase, args));
    } catch (error) {
      results.push({
        id: testCase.id,
        description: testCase.description,
        routeFamily: testCase.routeFamily,
        passed: false,
        issues: [error instanceof Error ? error.message : String(error)],
        finalAnswer: "",
        turns: []
      });
    }
    await writeReport();
  }

  return await writeReport();
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runProductionChatRoutingGate()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            summary: report.summary,
            failedCaseIds: report.failedCaseIds,
            telemetrySince: report.target.telemetrySince,
            output: parseArgs().output
          },
          null,
          2
        )
      );
      if (!report.passed) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

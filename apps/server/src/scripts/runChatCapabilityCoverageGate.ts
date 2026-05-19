import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Language = "fr" | "en";

type ExpectedProvider = "ollama" | "tool";

type CapabilityCase = {
  id: string;
  capability:
    | "calculator_tool"
    | "current_research_tool"
    | "time_tool"
    | "finance_tool"
    | "stable_factual"
    | "technical_concept"
    | "code_debug"
    | "practical_writing"
    | "memory"
    | "context_reasoning"
    | "strategic_decision";
  language: Language;
  conversation: string[];
  expectedTerms: Array<string | string[]>;
  expectedProvider?: ExpectedProvider;
  expectedModel?: string | string[];
  expectedToolType?: string;
  allowStaticFallback?: boolean;
  allowCloudRuntime?: boolean;
  forbidden?: RegExp[];
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
  };
  tooling?: {
    route?: string;
    used?: boolean;
    routing?: {
      toolType?: string;
      intent?: string;
      toolRequired?: boolean;
      toolRecommended?: boolean;
      toolResultUsed?: boolean;
    };
    failureReason?: string | null;
  };
};

type TurnResult = {
  index: number;
  message: string;
  answer: string;
  provider: string;
  model: string;
  budgetProfile: string;
  runtimeMode: string;
  toolType: string;
  toolUsed: boolean;
  toolRequired: boolean;
  qualityPassed: boolean;
  staticFallback: boolean;
  cloudRuntime: boolean;
  durationMs: number;
  attempts: number;
  issues: string[];
};

type CaseResult = {
  id: string;
  capability: CapabilityCase["capability"];
  passed: boolean;
  issues: string[];
  finalAnswer: string;
  turns: TurnResult[];
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  limit: number | null;
  apiKey: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "chat-capability-coverage-gate-v1.json");

const cases: CapabilityCase[] = [
  {
    id: "tool_calculator_fr",
    capability: "calculator_tool",
    language: "fr",
    conversation: ["Calcule 12 * 37."],
    expectedTerms: ["444"],
    expectedProvider: "tool",
    expectedToolType: "calculator"
  },
  {
    id: "tool_recent_ai_fr",
    capability: "current_research_tool",
    language: "fr",
    conversation: ["Quelles sont les nouveautes IA cette semaine ?"],
    expectedTerms: ["IA"],
    expectedProvider: "tool",
    expectedModel: "research_recent_updates",
    expectedToolType: "research"
  },
  {
    id: "tool_time_fr",
    capability: "time_tool",
    language: "fr",
    conversation: ["Quelle est l'heure actuelle a Paris ?"],
    expectedTerms: ["Paris"],
    expectedProvider: "tool",
    expectedToolType: "time"
  },
  {
    id: "tool_finance_en",
    capability: "finance_tool",
    language: "en",
    conversation: ["What is the current Bitcoin price?"],
    expectedTerms: [["Bitcoin", "BTC"]],
    expectedToolType: "finance"
  },
  {
    id: "stable_fact_charlemagne_fr",
    capability: "stable_factual",
    language: "fr",
    conversation: ["Qui est Charlemagne ?"],
    expectedTerms: ["charlemagne", ["franc", "france", "carolingien"], ["empereur", "empire", "roi"]],
    expectedProvider: "ollama",
    expectedToolType: "research"
  },
  {
    id: "stable_fact_marie_curie_fr",
    capability: "stable_factual",
    language: "fr",
    conversation: ["Qui est Marie Curie ?"],
    expectedTerms: [
      "marie",
      "curie",
      ["science", "scientifique", "physique", "physicienne", "chimie", "chimiste"],
      ["radioactivite", "radium", "polonium", "nobel"]
    ],
    expectedProvider: "ollama",
    expectedToolType: "research",
    forbidden: [/\bvar[eè]se\b/i]
  },
  {
    id: "concept_api_fr",
    capability: "technical_concept",
    language: "fr",
    conversation: ["Explique simplement ce qu'est une API."],
    expectedTerms: ["api", ["logiciels", "application", "interface"]],
    expectedProvider: "ollama"
  },
  {
    id: "concept_docker_en",
    capability: "technical_concept",
    language: "en",
    conversation: ["What is Docker?"],
    expectedTerms: ["docker", ["container", "containers"]],
    expectedProvider: "ollama"
  },
  {
    id: "code_docker_debug_en",
    capability: "code_debug",
    language: "en",
    conversation: ["Debug a Docker build error where npm install fails."],
    expectedTerms: ["docker", ["npm", "install"]],
    expectedProvider: "ollama",
    expectedModel: "qwen2.5-coder:7b"
  },
  {
    id: "writing_client_delay_fr",
    capability: "practical_writing",
    language: "fr",
    conversation: ["Redige un mail pour annoncer un retard de livraison a un client enterprise."],
    expectedTerms: ["retard", ["livraison", "client"]],
    expectedProvider: "ollama"
  },
  {
    id: "recipe_tiramisu_fr",
    capability: "practical_writing",
    language: "fr",
    conversation: ["Donne moi une recette de tiramisu."],
    expectedTerms: ["tiramisu", "mascarpone", ["cafe", "cacao"]],
    expectedProvider: "ollama"
  },
  {
    id: "memory_name_fr",
    capability: "memory",
    language: "fr",
    conversation: ["Je m'appelle Marc et je travaille sur Hydria.", "Comment je m'appelle ?"],
    expectedTerms: ["marc"]
  },
  {
    id: "memory_project_en",
    capability: "memory",
    language: "en",
    conversation: ["My project is called Hydria Core.", "What is my project called?"],
    expectedTerms: ["hydria core"]
  },
  {
    id: "context_correction_louis_ix_fr",
    capability: "context_reasoning",
    language: "fr",
    conversation: ["qui est louis 9", "tu ne connais pas louis 9 ou dit plutot saint louis"],
    expectedTerms: ["louis", "saint louis", ["france", "roi"]],
    expectedProvider: "ollama"
  },
  {
    id: "context_brevity_fr",
    capability: "context_reasoning",
    language: "fr",
    conversation: [
      "Pour la suite reponds en moins de 12 mots.",
      "Explique PostgreSQL en respectant ma contrainte."
    ],
    expectedTerms: ["postgresql"]
  },
  {
    id: "decision_onprem_budget_fr",
    capability: "strategic_decision",
    language: "fr",
    conversation: [
      "On doit choisir une architecture. Au depart je pensais AWS.",
      "Finalement contrainte stricte: on-prem uniquement, budget bloque, deadline demain.",
      "Tu recommandes quoi ?"
    ],
    expectedTerms: ["on-prem", ["recommande", "choisis"], ["budget", "deadline", "demain"]],
    expectedProvider: "ollama",
    forbidden: [/microservices/i]
  },
  {
    id: "incident_payment_rollback_fr",
    capability: "strategic_decision",
    language: "fr",
    conversation: [
      "Incident prod: erreurs 500 apres deploy, impact paiement.",
      "La direction veut attendre mais le risque client augmente.",
      "Decision maintenant ?"
    ],
    expectedTerms: [["rollback", "retour arriere", "retrograd"], "paiement"],
    expectedProvider: "ollama"
  },
  {
    id: "product_beta_en",
    capability: "strategic_decision",
    language: "en",
    conversation: [
      "We have weak signal from mid-market only and no budget for a broad launch.",
      "Should we launch broadly or narrow the beta?"
    ],
    expectedTerms: ["beta", "mid-market"],
    expectedProvider: "ollama"
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
    limit: limit ? Number(limit) : null,
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

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function answerText(response: ChatResponse) {
  return response.assistantMessage?.content ?? response.answer?.answer ?? "";
}

function includesExpected(actual: string, expected: string | string[]) {
  const values = Array.isArray(expected) ? expected : [expected];
  return values.some((value) => normalize(actual).includes(normalize(value)));
}

function includesExact(actual: string | undefined, expected: string | string[] | undefined) {
  if (!expected) {
    return true;
  }
  const values = Array.isArray(expected) ? expected : [expected];
  return values.includes(actual ?? "");
}

function languageLooksRight(answer: string, language: Language) {
  const normalized = normalize(answer);
  const frenchSignals = /\b(?:le|la|les|une|des|est|donc|pour|avec|choisir|recommande|voici|recette|retard|client)\b/.test(
    normalized
  );
  const englishSignals = /\b(?:the|this|that|with|should|first|because|recommend|answer|docker|container|debug)\b/.test(
    normalized
  );
  return language === "fr" ? frenchSignals || !englishSignals : englishSignals || !frenchSignals;
}

function hasGenericFailure(answer: string) {
  return /\b(?:je n'ai pas reussi|could not generate|reformule|no reliable source|cannot verify|tool-dependent|i cannot verify)\b/i.test(
    answer
  );
}

function hasInternalLeak(answer: string) {
  return /\b(?:ActiveConstraintCapsule|answer policy|runtimeBudget|hidden prompt|system prompt|chain-of-thought|local specialist)\b/i.test(
    answer
  );
}

function isCloudRuntime(provider: string, model: string) {
  if (provider !== "ollama" && provider !== "tool" && provider !== "fallback") {
    return true;
  }
  return /(?:openai|anthropic|openrouter|qwen\/|google|mistralai)\//i.test(model);
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
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

function inspectTurn(args: {
  testCase: CapabilityCase;
  response: ChatResponse;
  message: string;
  answer: string;
  index: number;
}): TurnResult {
  const provider = args.response.generation?.provider ?? "unknown";
  const model = args.response.generation?.model ?? "unknown";
  const budgetProfile = args.response.generation?.runtimeBudget?.profile ?? "unknown";
  const toolType = args.response.tooling?.routing?.toolType ?? "none";
  const toolUsed = Boolean(args.response.tooling?.used);
  const toolRequired = Boolean(args.response.tooling?.routing?.toolRequired);
  const qualityPassed = args.response.conversationQuality?.passed !== false;
  const staticFallback = provider === "fallback" || args.response.generation?.usedStaticFallback === true;
  const cloudRuntime = isCloudRuntime(provider, model);
  const issues: string[] = [];

  if (args.testCase.expectedProvider && provider !== args.testCase.expectedProvider) {
    issues.push(`provider:${provider}`);
  }
  if (!includesExact(model, args.testCase.expectedModel)) {
    issues.push(`model:${model}`);
  }
  if (args.testCase.expectedToolType && toolType !== args.testCase.expectedToolType) {
    issues.push(`toolType:${toolType}`);
  }
  if (args.testCase.expectedToolType && !toolUsed) {
    issues.push("tool_expected_but_not_used");
  }
  if (toolRequired && !toolUsed && args.testCase.expectedProvider === "tool") {
    issues.push("tool_required_but_not_used");
  }
  if (!args.testCase.allowStaticFallback && staticFallback) {
    issues.push("static_fallback");
  }
  if (!args.testCase.allowCloudRuntime && cloudRuntime) {
    issues.push(`cloud_runtime:${provider}/${model}`);
  }
  if (!qualityPassed) {
    issues.push(`quality:${args.response.conversationQuality?.issues?.join("|") ?? "failed"}`);
  }
  if (!languageLooksRight(args.answer, args.testCase.language)) {
    issues.push(`wrong_language:${args.testCase.language}`);
  }
  if (hasGenericFailure(args.answer)) {
    issues.push("generic_failure_answer");
  }
  if (hasInternalLeak(args.answer)) {
    issues.push("internal_leak");
  }

  return {
    index: args.index,
    message: args.message,
    answer: args.answer,
    provider,
    model,
    budgetProfile,
    runtimeMode: args.response.runtimeMode ?? "unknown",
    toolType,
    toolUsed,
    toolRequired,
    qualityPassed,
    staticFallback,
    cloudRuntime,
    durationMs: args.response.durationMs ?? 0,
    attempts: args.response.generation?.attempts?.length ?? 0,
    issues
  };
}

async function runCase(testCase: CapabilityCase, args: Args): Promise<CaseResult> {
  let sessionId: string | undefined;
  let finalAnswer = "";
  const turns: TurnResult[] = [];
  const issues: string[] = [];

  for (const [index, message] of testCase.conversation.entries()) {
    const response = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      sessionId ? { sessionId, message } : { message },
      args.timeoutMs,
      args.apiKey
    );
    sessionId = response.sessionId;
    finalAnswer = answerText(response);
    turns.push(
      inspectTurn({
        testCase,
        response,
        message,
        answer: finalAnswer,
        index
      })
    );
  }

  for (const expected of testCase.expectedTerms) {
    if (!includesExpected(finalAnswer, expected)) {
      const label = Array.isArray(expected) ? expected.join("|") : expected;
      issues.push(`missing_expected_term:${label}`);
    }
  }
  if (testCase.forbidden?.some((pattern) => pattern.test(finalAnswer))) {
    issues.push("forbidden_pattern");
  }
  for (const turn of turns) {
    if (turn.issues.length > 0) {
      issues.push(`turn_${turn.index}:${turn.issues.join("|")}`);
    }
  }

  return {
    id: testCase.id,
    capability: testCase.capability,
    passed: issues.length === 0,
    issues,
    finalAnswer,
    turns
  };
}

export function buildChatCapabilityCoverageReport(args: {
  baseUrl: string;
  results: CaseResult[];
  startedAt: number;
}) {
  const allTurns = args.results.flatMap((result) => result.turns);
  const failedCases = args.results.filter((result) => !result.passed);
  const durations = allTurns.map((turn) => turn.durationMs);
  const toolExpectedTurns = allTurns.filter((turn) => turn.toolRequired || turn.toolType !== "none");

  return {
    version: "hydria-chat-capability-coverage-gate-v1",
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      note: "Latency is reported for visibility only; it is not a pass/fail criterion in this gate."
    },
    passed: failedCases.length === 0,
    summary: {
      totalCases: args.results.length,
      passedCases: args.results.length - failedCases.length,
      failedCases: failedCases.length,
      passRate: rate(args.results.length - failedCases.length, args.results.length),
      totalTurns: allTurns.length,
      qualityFailureRate: rate(allTurns.filter((turn) => !turn.qualityPassed).length, allTurns.length),
      wrongLanguageRate: rate(allTurns.filter((turn) => turn.issues.some((issue) => issue.startsWith("wrong_language"))).length, allTurns.length),
      genericFailureRate: rate(allTurns.filter((turn) => turn.issues.includes("generic_failure_answer")).length, allTurns.length),
      staticFallbackRate: rate(allTurns.filter((turn) => turn.staticFallback).length, allTurns.length),
      cloudRuntimeRate: rate(allTurns.filter((turn) => turn.cloudRuntime).length, allTurns.length),
      toolExpectedButNotUsed: toolExpectedTurns.filter((turn) => !turn.toolUsed && turn.toolType !== "none").length,
      p50LatencyMs: percentile(durations, 50),
      p95LatencyMs: percentile(durations, 95),
      maxLatencyMs: Math.max(0, ...durations),
      durationMs: Date.now() - args.startedAt,
      byCapability: countBy(args.results.map((result) => result.capability)),
      byProvider: countBy(allTurns.map((turn) => turn.provider)),
      byModel: countBy(allTurns.map((turn) => turn.model)),
      byBudgetProfile: countBy(allTurns.map((turn) => turn.budgetProfile))
    },
    failedCaseIds: failedCases.map((result) => result.id),
    results: args.results
  };
}

export async function runChatCapabilityCoverageGate(args = parseArgs()) {
  const startedAt = Date.now();
  const selectedCases = args.limit ? cases.slice(0, args.limit) : cases;
  const results: CaseResult[] = [];

  for (const testCase of selectedCases) {
    try {
      results.push(await runCase(testCase, args));
    } catch (error) {
      results.push({
        id: testCase.id,
        capability: testCase.capability,
        passed: false,
        issues: [error instanceof Error ? error.message : String(error)],
        finalAnswer: "",
        turns: []
      });
    }
  }

  const report = buildChatCapabilityCoverageReport({
    baseUrl: args.baseUrl,
    results,
    startedAt
  });
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runChatCapabilityCoverageGate()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            summary: report.summary,
            failedCaseIds: report.failedCaseIds,
            output: parseArgs().output
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

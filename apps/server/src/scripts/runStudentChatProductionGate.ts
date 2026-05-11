import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Language = "fr" | "en";

type ChatGateCase = {
  id: string;
  language: Language;
  conversation: string[];
  expectedTerms: string[];
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
    validationIssues?: string[];
  };
};

type CaseResult = {
  id: string;
  passed: boolean;
  issues: string[];
  finalAnswer: string;
  finalRuntimeMode: string;
  turns: Array<{
    provider: string;
    model: string;
    durationMs: number;
    qualityPassed: boolean;
    issues: string[];
  }>;
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  limit: number | null;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "student-chat-production-gate-v1.json");

const cases: ChatGateCase[] = [
  {
    id: "fr_stable_history_charlemagne",
    language: "fr",
    conversation: ["qui est charlemagne"],
    expectedTerms: ["charlemagne", "franc", "empereur"]
  },
  {
    id: "fr_history_followup_biography",
    language: "fr",
    conversation: ["qui est charlemagne", "tu peux m'en dire plus", "donne moi sa biographie"],
    expectedTerms: ["charlemagne", "814", "empereur"]
  },
  {
    id: "fr_correction_louis_ix",
    language: "fr",
    conversation: ["qui est louis 9", "tu ne connais pas louis 9 ou dit plutot saint louis"],
    expectedTerms: ["louis", "saint louis", "france"]
  },
  {
    id: "fr_memory_name",
    language: "fr",
    conversation: ["Je m'appelle Marc et je travaille sur Hydria.", "Comment je m'appelle ?"],
    expectedTerms: ["marc"]
  },
  {
    id: "en_memory_project",
    language: "en",
    conversation: ["My project is called Hydria Core.", "What is my project called?"],
    expectedTerms: ["hydria core"]
  },
  {
    id: "en_code_promise",
    language: "en",
    conversation: ["Explain a JavaScript Promise in two short sentences."],
    expectedTerms: ["promise", "async"]
  },
  {
    id: "fr_arch_on_prem_change",
    language: "fr",
    conversation: [
      "On doit choisir une architecture. Au depart je pensais AWS.",
      "Finalement contrainte stricte: on-prem uniquement.",
      "Tu recommandes quoi ?"
    ],
    expectedTerms: ["on-prem", "recommande"]
  },
  {
    id: "en_debug_checkout",
    language: "en",
    conversation: [
      "My checkout became slow after a release. Budget is capped and only two engineers are available.",
      "What should we debug first?"
    ],
    expectedTerms: ["checkout", "measure"]
  },
  {
    id: "fr_incident_rollback",
    language: "fr",
    conversation: [
      "Incident prod: erreurs 500 apres deploy, impact paiement.",
      "La direction veut attendre mais le risque client augmente.",
      "Decision maintenant ?"
    ],
    expectedTerms: ["rollback", "paiement"]
  },
  {
    id: "en_product_strategy",
    language: "en",
    conversation: [
      "We have weak signal from mid-market only and no budget for a broad launch.",
      "Should we launch broadly or narrow the beta?"
    ],
    expectedTerms: ["beta", "mid-market"]
  },
  {
    id: "fr_constraint_brevity",
    language: "fr",
    conversation: [
      "Pour la suite reponds en moins de 12 mots.",
      "Explique PostgreSQL en respectant ma contrainte."
    ],
    expectedTerms: ["postgresql"]
  },
  {
    id: "en_context_revision",
    language: "en",
    conversation: [
      "Assume we have 10k users and AWS is allowed.",
      "Correction: we now expect 10M users and must stay on-prem.",
      "Revise the recommendation."
    ],
    expectedTerms: ["10m", "on-prem"]
  },
  {
    id: "fr_generic_question",
    language: "fr",
    conversation: ["Explique simplement ce qu'est une API."],
    expectedTerms: ["api", "application"]
  },
  {
    id: "en_decision_tradeoff",
    language: "en",
    conversation: [
      "We need auditability, low latency, and only one backend engineer.",
      "Pick the default architecture."
    ],
    expectedTerms: ["audit", "default"]
  },
  {
    id: "fr_no_unneeded_abstention",
    language: "fr",
    conversation: ["Donne une courte definition de la Renaissance carolingienne."],
    expectedTerms: ["carolingienne", "culture"]
  },
  {
    id: "en_followup_pronoun",
    language: "en",
    conversation: ["Who was Ada Lovelace?", "What was she known for?"],
    expectedTerms: ["ada", "computing"]
  },
  {
    id: "fr_user_preference",
    language: "fr",
    conversation: [
      "Je prefere une reponse actionnable, pas theorique.",
      "Mon app est lente au demarrage. Que faire ?"
    ],
    expectedTerms: ["mesure", "demarrage"]
  },
  {
    id: "en_ambiguous_actionable",
    language: "en",
    conversation: ["The app is slow, but I do not know where.", "Give me a practical first pass."],
    expectedTerms: ["measure", "latency"]
  },
  {
    id: "fr_contradiction_budget",
    language: "fr",
    conversation: [
      "On peut payer une solution externe.",
      "Finalement budget zero.",
      "Quelle option tu choisis ?"
    ],
    expectedTerms: ["budget", "interne"]
  },
  {
    id: "en_stable_fact_no_live_tool",
    language: "en",
    conversation: ["What is eventual consistency?"],
    expectedTerms: ["consistency", "replica"]
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
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? "120000"),
    limit: limit ? Number(limit) : null
  };
}

async function postJson<T>(baseUrl: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
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
  const frenchSignals = /\b(?:le|la|les|une|des|est|reponse|donc|pour|avec|choisis|recommande)\b/.test(normalized);
  const englishSignals = /\b(?:the|this|that|with|should|first|default|because|recommend)\b/.test(normalized);
  return language === "fr" ? frenchSignals || !englishSignals : englishSignals || !frenchSignals;
}

function hasGenericFailure(answer: string) {
  return /\b(?:je n'ai pas reussi|could not generate|reformule|no reliable source|cannot verify|tool-dependent)\b/i.test(answer);
}

async function runCase(testCase: ChatGateCase, args: Args): Promise<CaseResult> {
  let sessionId: string | undefined;
  const turns: CaseResult["turns"] = [];
  let finalAnswer = "";
  let finalRuntimeMode = "unknown";
  const issues: string[] = [];

  for (const message of testCase.conversation) {
    const response = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      sessionId ? { sessionId, message } : { message },
      args.timeoutMs
    );
    sessionId = response.sessionId;
    finalAnswer = answerText(response);
    finalRuntimeMode = response.runtimeMode ?? "unknown";
    turns.push({
      provider: response.generation?.provider ?? "unknown",
      model: response.generation?.model ?? "unknown",
      durationMs: response.durationMs ?? 0,
      qualityPassed: response.conversationQuality?.passed !== false,
      issues: response.conversationQuality?.issues ?? []
    });
  }

  const normalizedAnswer = normalize(finalAnswer);
  for (const expectedTerm of testCase.expectedTerms) {
    if (!normalizedAnswer.includes(normalize(expectedTerm))) {
      issues.push(`missing_expected_term:${expectedTerm}`);
    }
  }
  if (!languageLooksRight(finalAnswer, testCase.language)) {
    issues.push(`wrong_language:${testCase.language}`);
  }
  if (hasGenericFailure(finalAnswer)) {
    issues.push("generic_or_static_fallback_answer");
  }
  if (testCase.forbidden?.some((pattern) => pattern.test(finalAnswer))) {
    issues.push("forbidden_pattern");
  }
  for (const turn of turns) {
    if (turn.provider !== "ollama") {
      issues.push(`non_local_provider:${turn.provider}`);
    }
    if (!turn.qualityPassed) {
      issues.push(`quality_gate:${turn.issues.join("|")}`);
    }
  }

  return {
    id: testCase.id,
    passed: issues.length === 0,
    issues,
    finalAnswer,
    finalRuntimeMode,
    turns
  };
}

async function runStudentChatProductionGate(args = parseArgs()) {
  const selectedCases = args.limit ? cases.slice(0, args.limit) : cases;
  const startedAt = Date.now();
  const results: CaseResult[] = [];

  for (const testCase of selectedCases) {
    try {
      results.push(await runCase(testCase, args));
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        issues: [error instanceof Error ? error.message : String(error)],
        finalAnswer: "",
        finalRuntimeMode: "unknown",
        turns: []
      });
    }
  }

  const allTurns = results.flatMap((result) => result.turns);
  const localTurns = allTurns.filter((turn) => turn.provider === "ollama").length;
  const staticFallbackTurns = allTurns.filter((turn) => turn.provider === "fallback").length;
  const durations = allTurns.map((turn) => turn.durationMs).sort((left, right) => left - right);
  const percentile = (p: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] ?? 0;
  const report = {
    generatedAt: new Date().toISOString(),
    target: args.baseUrl,
    completed: results.length,
    passed: results.every((result) => result.passed),
    metrics: {
      passRate: results.length > 0 ? (results.filter((result) => result.passed).length / results.length) * 100 : 0,
      localOllamaRate: allTurns.length > 0 ? (localTurns / allTurns.length) * 100 : 0,
      staticFallbackRate: allTurns.length > 0 ? (staticFallbackTurns / allTurns.length) * 100 : 0,
      p50LatencyMs: percentile(0.5),
      p95LatencyMs: percentile(0.95),
      durationMs: Date.now() - startedAt
    },
    failedCaseIds: results.filter((result) => !result.passed).map((result) => result.id),
    results
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runStudentChatProductionGate()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            completed: report.completed,
            metrics: report.metrics,
            failedCaseIds: report.failedCaseIds,
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

export { runStudentChatProductionGate };

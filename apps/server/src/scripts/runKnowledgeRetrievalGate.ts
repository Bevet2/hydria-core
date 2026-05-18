import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type KnowledgeExpectation = {
  shouldUse: boolean;
  expectedTerms?: string[];
  forbiddenTerms?: string[];
};

type GateCase = {
  id: string;
  message: string;
  expectedAnswerTerms: string[];
  knowledge: KnowledgeExpectation;
  expectedToolType?: string;
};

type ChatResponse = {
  sessionId?: string;
  durationMs?: number;
  assistantMessage?: { content?: string };
  answer?: { answer?: string };
  tooling?: {
    used?: boolean;
    routing?: {
      toolType?: string;
      toolRequired?: boolean;
    };
  };
  knowledgeRetrieval?: {
    route?: string;
    used?: boolean;
    hitCount?: number;
    hits?: Array<{
      objectId?: string;
      title?: string;
      content?: string;
      sourceUris?: string[];
    }>;
  };
  orchestrationTrace?: {
    steps?: Array<{
      id?: string;
      status?: string;
      summary?: string;
    }>;
  };
};

type Args = {
  baseUrl: string;
  output: string;
  timeoutMs: number;
  delayMs: number;
  apiKey: string;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "knowledge-retrieval-gate-v1.json");

const cases: GateCase[] = [
  {
    id: "relational_model_source_hit",
    message: "What does Codd's relational model paper say about large shared data banks?",
    expectedAnswerTerms: ["relational"],
    knowledge: {
      shouldUse: true,
      expectedTerms: ["relational", "data", "banks"]
    }
  },
  {
    id: "recipe_no_retrieval",
    message: "Donne moi une recette simple de tiramisu.",
    expectedAnswerTerms: ["tiramisu"],
    knowledge: {
      shouldUse: false,
      forbiddenTerms: ["relational", "10.1145/362384.362685"]
    }
  },
  {
    id: "live_weather_tool_priority",
    message: "Quel temps fait-il aujourd'hui a Paris ?",
    expectedAnswerTerms: ["Paris"],
    expectedToolType: "weather",
    knowledge: {
      shouldUse: false
    }
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
  return {
    baseUrl: (readOption(argv, "--base-url") ?? "https://app.hydria.click").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? "180000"),
    delayMs: Number(readOption(argv, "--delay-ms") ?? "1000"),
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

async function runCase(testCase: GateCase, args: Args) {
  const startedAt = Date.now();
  const response = await postJson<ChatResponse>(
    args.baseUrl,
    "/api/chat/message",
    { message: testCase.message },
    args.timeoutMs,
    args.apiKey
  );
  const answer = answerText(response);
  const normalizedAnswer = normalize(answer);
  const hitText = normalize(
    (response.knowledgeRetrieval?.hits ?? [])
      .map((hit) => `${hit.title ?? ""} ${hit.content ?? ""} ${(hit.sourceUris ?? []).join(" ")}`)
      .join(" ")
  );
  const traceHasKnowledgeStep = Boolean(
    response.orchestrationTrace?.steps?.some((step) => step.id === "knowledge_retrieval")
  );
  const issues: string[] = [];

  for (const term of testCase.expectedAnswerTerms) {
    if (!normalizedAnswer.includes(normalize(term))) {
      issues.push(`missing_answer_term:${term}`);
    }
  }
  if (testCase.knowledge.shouldUse && response.knowledgeRetrieval?.used !== true) {
    issues.push(`knowledge_not_used:${response.knowledgeRetrieval?.route ?? "missing"}`);
  }
  if (!testCase.knowledge.shouldUse && response.knowledgeRetrieval?.used === true) {
    issues.push("unexpected_knowledge_injection");
  }
  for (const term of testCase.knowledge.expectedTerms ?? []) {
    if (!hitText.includes(normalize(term))) {
      issues.push(`missing_knowledge_term:${term}`);
    }
  }
  for (const term of testCase.knowledge.forbiddenTerms ?? []) {
    if (normalizedAnswer.includes(normalize(term)) || hitText.includes(normalize(term))) {
      issues.push(`forbidden_knowledge_term:${term}`);
    }
  }
  if (testCase.expectedToolType && response.tooling?.routing?.toolType !== testCase.expectedToolType) {
    issues.push(`toolType:${response.tooling?.routing?.toolType ?? "missing"}`);
  }
  if (!traceHasKnowledgeStep) {
    issues.push("missing_knowledge_trace_step");
  }

  return {
    id: testCase.id,
    passed: issues.length === 0,
    issues,
    message: testCase.message,
    answer,
    runtime: {
      latencyMs: response.durationMs ?? Date.now() - startedAt,
      toolType: response.tooling?.routing?.toolType ?? "none",
      toolUsed: Boolean(response.tooling?.used),
      knowledgeRoute: response.knowledgeRetrieval?.route ?? "missing",
      knowledgeUsed: Boolean(response.knowledgeRetrieval?.used),
      knowledgeHitCount: response.knowledgeRetrieval?.hitCount ?? 0
    },
    knowledgeHits: response.knowledgeRetrieval?.hits ?? []
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runKnowledgeRetrievalGate(args = parseArgs()) {
  const results = [];
  for (const [index, testCase] of cases.entries()) {
    if (index > 0 && args.delayMs > 0) {
      await sleep(args.delayMs);
    }
    try {
      results.push(await runCase(testCase, args));
    } catch (error) {
      results.push({
        id: testCase.id,
        passed: false,
        issues: [error instanceof Error ? error.message : String(error)],
        message: testCase.message,
        answer: "",
        runtime: {
          latencyMs: 0,
          toolType: "error",
          toolUsed: false,
          knowledgeRoute: "error",
          knowledgeUsed: false,
          knowledgeHitCount: 0
        },
        knowledgeHits: []
      });
    }
  }
  const failed = results.filter((result) => !result.passed);
  const report = {
    version: "hydria-knowledge-retrieval-gate-v1",
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      caseCount: cases.length,
      timeoutMs: args.timeoutMs
    },
    passed: failed.length === 0,
    summary: {
      caseCount: cases.length,
      passedCases: cases.length - failed.length,
      failedCases: failed.length,
      knowledgeUsedCases: results.filter((result) => result.runtime.knowledgeUsed).length,
      unexpectedKnowledgeCases: results.filter((result) =>
        result.issues.includes("unexpected_knowledge_injection")
      ).length,
      missingKnowledgeTraceCases: results.filter((result) =>
        result.issues.includes("missing_knowledge_trace_step")
      ).length
    },
    failedCaseIds: failed.map((result) => result.id),
    results
  };
  await writeJson(args.output, report);
  return report;
}

if (resolve(process.argv[1] ?? "") === currentFilePath) {
  runKnowledgeRetrievalGate()
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
      if (!report.passed) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

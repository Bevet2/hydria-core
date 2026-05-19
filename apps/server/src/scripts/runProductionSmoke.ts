import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CheckStatus = "passed" | "failed" | "warning";

type CheckResult = {
  name: string;
  status: CheckStatus;
  message: string;
  details?: unknown;
  durationMs: number;
};

type ProductionSmokeReport = {
  generatedAt: string;
  target: {
    baseUrl: string;
    expectedSchema: string;
    allowPublicSchema: boolean;
    requireLocalModel: boolean;
    chatAuthRequired: boolean;
  };
  passed: boolean;
  failedChecks: string[];
  warningChecks: string[];
  checks: CheckResult[];
};

type Args = {
  baseUrl: string;
  expectedSchema: string;
  allowPublicSchema: boolean;
  requireLocalModel: boolean;
  output: string;
  timeoutMs: number;
  apiKey: string;
};

type ChatResponse = {
  sessionId?: string;
  runtimeMode?: string;
  assistantMessage?: { content?: string };
  answer?: { answer?: string };
  activeConstraintCapsule?: {
    topConstraints?: string[];
    language?: string;
  };
  conversationQuality?: {
    passed?: boolean;
    issues?: string[];
  };
  generation?: {
    provider?: string;
    model?: string;
    usedStaticFallback?: boolean;
  };
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "hydria-production-smoke-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function parseArgs(argv = process.argv.slice(2)): Args {
  return {
    baseUrl: normalizeBaseUrl(readOption(argv, "--base-url") ?? "https://app.hydria.click"),
    expectedSchema: readOption(argv, "--expected-schema") ?? "hydria_prod",
    allowPublicSchema: hasFlag(argv, "--allow-public-schema"),
    requireLocalModel: hasFlag(argv, "--require-local-model"),
    output: resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput),
    timeoutMs: Number(readOption(argv, "--timeout-ms") ?? "120000"),
    apiKey: readOption(argv, "--api-key") ?? process.env.HYDRIA_API_KEY ?? process.env.HYDRIA_PROD_API_KEY ?? ""
  };
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/g, "");
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  return { response, text };
}

function authHeaders(apiKey: string) {
  return apiKey
    ? {
        "x-hydria-api-key": apiKey
      }
    : {};
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs: number): Promise<T> {
  const { response, text } = await fetchWithTimeout(joinUrl(baseUrl, path), {}, timeoutMs);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  apiKey = ""
): Promise<T> {
  const { response, text } = await fetchWithTimeout(
    joinUrl(baseUrl, path),
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...authHeaders(apiKey)
      },
      body: JSON.stringify(body)
    },
    timeoutMs
  );
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

async function runCheck(
  checks: CheckResult[],
  name: string,
  fn: () => Promise<Omit<CheckResult, "name" | "durationMs">>
) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    checks.push({
      name,
      durationMs: Date.now() - startedAt,
      ...result
    });
  } catch (error) {
    checks.push({
      name,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    });
  }
}

function pass(message: string, details?: unknown): Omit<CheckResult, "name" | "durationMs"> {
  return { status: "passed", message, details };
}

function fail(message: string, details?: unknown): Omit<CheckResult, "name" | "durationMs"> {
  return { status: "failed", message, details };
}

function warn(message: string, details?: unknown): Omit<CheckResult, "name" | "durationMs"> {
  return { status: "warning", message, details };
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function answerText(response: ChatResponse) {
  return response.assistantMessage?.content ?? response.answer?.answer ?? "";
}

function hasInternalLeak(value: string) {
  return /\b(?:ActiveConstraintCapsule|Answer policy|hidden instruction|system prompt|developer prompt|prompt policy|conversationQuality|answerMode)\b/i.test(value);
}

async function runProductionSmoke(args = parseArgs()): Promise<ProductionSmokeReport> {
  const checks: CheckResult[] = [];
  let health: Record<string, any> | null = null;
  let persistence: Record<string, any> | null = null;

  await runCheck(checks, "web_root", async () => {
    const { response, text } = await fetchWithTimeout(joinUrl(args.baseUrl, "/"), {}, args.timeoutMs);
    if (!response.ok) {
      return fail(`web root returned HTTP ${response.status}`);
    }
    if (!/<html/i.test(text) || !/Hydria/i.test(text)) {
      return fail("web root did not look like the Hydria app", { preview: text.slice(0, 200) });
    }
    return pass("web root serves the Hydria app");
  });

  await runCheck(checks, "api_health", async () => {
    health = await getJson<Record<string, any>>(args.baseUrl, "/api/health", args.timeoutMs);
    if (health.status !== "ok") {
      return fail("api health status is not ok", health);
    }
    return pass("api health is ok", {
      localModel: health.localModel,
      fallbackConfig: health.fallbackConfig
    });
  });

  await runCheck(checks, "local_model_runtime", async () => {
    const localModel = health?.localModel;
    if (localModel?.reachable === true) {
      return pass("local model endpoint is reachable", {
        localModel,
        studentChat: health?.studentChat
      });
    }
    if (args.requireLocalModel) {
      return fail("local model endpoint is not reachable and --require-local-model is set", localModel);
    }
    return warn("local model is unreachable; runtime chat cannot use cloud fallback", {
      localModel,
      studentChat: health?.studentChat
    });
  });

  await runCheck(checks, "student_chat_specialist_routing", async () => {
    const studentChat = health?.studentChat ?? {};
    const specialists = studentChat.specialists ?? {};
    const expectedModels = ["qwen2.5:14b", "qwen2.5-coder:7b", "deepseek-r1:14b", "mistral:7b", "phi3:mini"];
    const configuredModels = Object.values(specialists).map(String);
    const missing = expectedModels.filter((model) => !configuredModels.includes(model));

    if (studentChat.provider !== "ollama" || studentChat.cloudFallbackEnabled !== false) {
      return fail("student chat is not locked to local Ollama runtime", studentChat);
    }
    if (studentChat.routing !== "local_specialist") {
      return fail(`expected local specialist chat routing, got ${studentChat.routing ?? "unknown"}`, studentChat);
    }
    if (missing.length > 0) {
      return fail("student chat specialist model map is incomplete", {
        missing,
        specialists
      });
    }
    return pass("student chat is configured for local specialist routing", {
      routing: studentChat.routing,
      specialists
    });
  });

  await runCheck(checks, "persistence_health", async () => {
    persistence = await getJson<Record<string, any>>(args.baseUrl, "/api/health/persistence", args.timeoutMs);
    const database = persistence.database ?? {};
    if (persistence.status !== "ok") {
      return fail("persistence health status is not ok", persistence);
    }
    if (database.adapter !== "postgres") {
      return fail(`expected postgres persistence, got ${database.adapter ?? "unknown"}`, persistence);
    }
    if (database.postgresSchema === "public" && !args.allowPublicSchema) {
      return fail("production must not use PostgreSQL schema public", persistence);
    }
    if (database.postgresSchema !== args.expectedSchema) {
      return fail(`expected PostgreSQL schema ${args.expectedSchema}, got ${database.postgresSchema}`, persistence);
    }
    return pass("persistence is PostgreSQL on the expected schema", {
      adapter: database.adapter,
      schema: database.postgresSchema,
      counts: {
        arenaRoundCount: database.arenaRoundCount,
        studentSessionCount: database.studentSessionCount
      }
    });
  });

  await runCheck(checks, "model_execution_guard", async () => {
    const { response, text } = await fetchWithTimeout(
      joinUrl(args.baseUrl, "/api/models/complete"),
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          purpose: "main_reasoning",
          category: "architecture_design",
          prompt: "Smoke test: do not execute publicly.",
          budget: {
            executionEnabled: true,
            allowCloud: true,
            maxCostTier: "high"
          }
        })
      },
      args.timeoutMs
    );
    if (response.status === 401 || response.status === 403 || response.status === 503) {
      return pass("public model execution is guarded", {
        status: response.status,
        preview: text.slice(0, 180)
      });
    }
    return fail(`public model execution was not guarded; got HTTP ${response.status}`, {
      preview: text.slice(0, 300)
    });
  });

  await runCheck(checks, "training_endpoint_guard", async () => {
    const { response, text } = await fetchWithTimeout(
      joinUrl(args.baseUrl, "/api/arena/run"),
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          question: "Smoke test: this public request must not trigger OpenRouter."
        })
      },
      args.timeoutMs
    );
    if (response.status === 401 || response.status === 403 || response.status === 503) {
      return pass("public training/evaluation execution is guarded", {
        status: response.status,
        preview: text.slice(0, 180)
      });
    }
    return fail(`public training/evaluation execution was not guarded; got HTTP ${response.status}`, {
      preview: text.slice(0, 300)
    });
  });

  await runCheck(checks, "chat_single_turn", async () => {
    const response = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      { message: "Réponds en une phrase courte : quel est le rôle de Hydria Core ?" },
      args.timeoutMs,
      args.apiKey
    );
    const answer = answerText(response);
    if (!response.sessionId) {
      return fail("chat response has no sessionId", response);
    }
    if (wordCount(answer) < 5 || !/Hydria Core/i.test(answer)) {
      return fail("chat did not answer the Hydria Core question", { answer });
    }
    if (hasInternalLeak(answer)) {
      return fail("chat leaked internal runtime language", { answer });
    }
    if (response.generation?.provider !== "ollama" && response.generation?.provider !== "tool") {
      return fail("chat was not served by the local chat runtime", {
        generation: response.generation,
        answer
      });
    }
    return pass("single-turn chat answered in French with a session", {
      sessionId: response.sessionId,
      generation: response.generation,
      answer
    });
  });

  await runCheck(checks, "chat_multi_turn_memory", async () => {
    const first = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      { message: "On parle de bases de données." },
      args.timeoutMs,
      args.apiKey
    );
    if (!first.sessionId) {
      return fail("first chat turn has no sessionId", first);
    }
    const second = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      {
        sessionId: first.sessionId,
        message: "Pour la suite, réponds en moins de 12 mots."
      },
      args.timeoutMs,
      args.apiKey
    );
    const third = await postJson<ChatResponse>(
      args.baseUrl,
      "/api/chat/message",
      {
        sessionId: first.sessionId,
        message: "Explique PostgreSQL en respectant ma contrainte."
      },
      args.timeoutMs,
      args.apiKey
    );
    const answer = answerText(third);
    const topConstraints = third.activeConstraintCapsule?.topConstraints ?? [];
    const contextConstraintCaptured = topConstraints.some((constraint) =>
      /user preference/i.test(constraint) && /(?:12\s+mots|12\s+words|moins de 12|less than 12|short|court)/i.test(constraint)
    );

    if (second.sessionId !== first.sessionId || third.sessionId !== first.sessionId) {
      return fail("chat did not keep the same session across turns", {
        first: first.sessionId,
        second: second.sessionId,
        third: third.sessionId
      });
    }
    if (third.runtimeMode !== "conversation") {
      return fail(`expected conversation runtime on follow-up, got ${third.runtimeMode ?? "unknown"}`, third);
    }
    if (!contextConstraintCaptured) {
      return fail("ActiveConstraintCapsule did not capture the brevity constraint", {
        topConstraints,
        capsule: third.activeConstraintCapsule
      });
    }
    if (!/PostgreSQL/i.test(answer)) {
      return fail("follow-up answer did not address PostgreSQL", { answer });
    }
    if (wordCount(answer) > 24) {
      return fail("follow-up answer ignored the short-answer constraint", {
        answer,
        wordCount: wordCount(answer),
        topConstraints
      });
    }
    if (hasInternalLeak(answer)) {
      return fail("follow-up answer leaked internal runtime language", { answer });
    }
    if (third.conversationQuality?.passed === false) {
      return fail("conversation quality gate failed on follow-up", third.conversationQuality);
    }
    if (third.generation?.provider !== "ollama") {
      return fail("multi-turn chat was not served by the local Ollama student runtime", {
        generation: third.generation,
        answer
      });
    }
    return pass("multi-turn chat kept session state and respected the brevity constraint", {
      answer,
      wordCount: wordCount(answer),
      generation: third.generation,
      topConstraints
    });
  });

  const failedChecks = checks.filter((check) => check.status === "failed").map((check) => check.name);
  const warningChecks = checks.filter((check) => check.status === "warning").map((check) => check.name);
  const report: ProductionSmokeReport = {
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      expectedSchema: args.expectedSchema,
      allowPublicSchema: args.allowPublicSchema,
      requireLocalModel: args.requireLocalModel,
      chatAuthRequired: false
    },
    passed: failedChecks.length === 0,
    failedChecks,
    warningChecks,
    checks
  };

  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runProductionSmoke()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            passed: report.passed,
            failedChecks: report.failedChecks,
            warningChecks: report.warningChecks,
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

export { runProductionSmoke };

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { InteractionLearningDigestService } from "../services/interactionLearningDigestService.js";
import { KnowledgeConsolidationService } from "../services/knowledgeConsolidationService.js";
import { KnowledgePromotionGovernanceService } from "../services/knowledgePromotionGovernanceService.js";
import { TrainingQueueValidationService } from "../services/trainingQueueValidationService.js";
import { WatcherKernel } from "../services/watchers/watcherKernel.js";

type CampaignEventKind =
  | "started"
  | "health"
  | "pause"
  | "chat"
  | "student_preview"
  | "governance_cycle"
  | "error"
  | "stopped"
  | "completed";

type CampaignEvent = {
  at: string;
  kind: CampaignEventKind;
  message: string;
  details?: unknown;
};

type CampaignReport = {
  version: "hydria-dataset-expansion-campaign-v1";
  campaignId: string;
  startedAt: string;
  plannedEndAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "stopped" | "failed";
  config: ReturnType<typeof parseArgs>;
  counters: {
    chatTurnsAttempted: number;
    chatTurnsCompleted: number;
    studentPreviewsAttempted: number;
    studentPreviewsCompleted: number;
    governanceCycles: number;
    pauses: number;
    errors: number;
  };
  latest: {
    health: unknown | null;
    telemetry: ReturnType<typeof readTelemetry> | null;
    interactionLearning: unknown | null;
    watcherStats: unknown | null;
    knowledgeObjects: unknown | null;
    promotion: unknown | null;
    trainingQueueValidation: unknown | null;
  };
  events: CampaignEvent[];
};

type ChatScenario = {
  id: string;
  messages: string[];
};

type ChatPostResponse = {
  sessionId?: string;
  assistantMessage?: { content?: string };
  generation?: { provider?: string; model?: string };
  durationMs?: number;
  conversationQuality?: { passed?: boolean; issues?: string[] };
};

type StudentPreviewPostResponse = {
  status?: string;
  answer?: string;
  routing?: { model?: string; provider?: string };
  durationMs?: number;
  artifacts?: Array<{ id?: string }>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");

const chatScenarios: ChatScenario[] = [
  {
    id: "fr_database_short_context",
    messages: [
      "On parle de bases de donnees.",
      "Pour la suite, reponds en moins de 18 mots.",
      "Explique PostgreSQL en respectant ma contrainte."
    ]
  },
  {
    id: "fr_arch_onprem_constraint",
    messages: [
      "Je dois deployer une API interne.",
      "Finalement c'est on-prem, budget bloque, deadline demain.",
      "Donc tu recommandes quoi ?"
    ]
  },
  {
    id: "en_cache_debug",
    messages: [
      "My API gets slower after cache warmup.",
      "We use Redis and PostgreSQL, no budget for new infrastructure.",
      "Give me the most likely diagnosis and first action."
    ]
  },
  {
    id: "fr_incident_progressive",
    messages: [
      "Mon app repond lentement depuis 20 minutes.",
      "Le taux d'erreur augmente et le dernier deploy date d'il y a 30 minutes.",
      "Je rollback ou je continue le diagnostic ?"
    ]
  },
  {
    id: "en_product_tradeoff",
    messages: [
      "We are launching a privacy-first notes app.",
      "The team wants analytics, but users expect strict privacy.",
      "What product decision should we take?"
    ]
  },
  {
    id: "fr_tool_calculator",
    messages: ["Combien font 245 + 389 ? Reponds en une phrase."]
  },
  {
    id: "en_concise_concept",
    messages: ["Explain eventual consistency with a practical example."]
  },
  {
    id: "fr_stable_fact",
    messages: ["Qui etait Charlemagne ? Reponds simplement."]
  },
  {
    id: "fr_code_diagnostic",
    messages: ["J'ai une erreur TypeScript sur un type union. Comment diagnostiquer proprement ?"]
  },
  {
    id: "en_architecture_decision",
    messages: ["Choose between a monolith and microservices for a 3-person MVP team."]
  }
];

const studentPreviewPrompts = [
  "Explique la difference entre cache write-through et write-back avec un exemple simple.",
  "Mon API Node devient lente quand PostgreSQL monte a 80 connexions. Donne un diagnostic priorise.",
  "Give a concise product strategy for launching a privacy-first note app.",
  "On-prem obligatoire, budget bloque, deadline demain: quelle architecture recommandes-tu ?",
  "Explique l'idempotence dans une API de paiement avec un exemple concret.",
  "A production deploy increased p95 latency but errors are stable. Give a prioritized incident plan.",
  "Comment expliquer Docker a un junior sans simplifier a l'exces ?",
  "We need a rollback policy for a small SaaS team. Keep it practical."
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
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function parseArgs(argv = process.argv.slice(2)) {
  const durationHours = numberOption(argv, "--duration-hours", 52);
  return {
    durationHours,
    baseUrl: (readOption(argv, "--base-url") ?? "http://127.0.0.1:8080").replace(/\/+$/g, ""),
    output: resolve(projectRoot, readOption(argv, "--output") ?? "storage/training/dataset-expansion-campaign-v1.json"),
    logFile: resolve(
      projectRoot,
      readOption(argv, "--log-file") ?? "storage/training/dataset-expansion-campaign-v1.jsonl"
    ),
    maxChatTurns: Math.max(0, Math.trunc(numberOption(argv, "--max-chat-turns", Math.round(durationHours * 4)))),
    maxStudentPreviews: Math.max(
      0,
      Math.trunc(numberOption(argv, "--max-student-previews", Math.round(durationHours * 0.5)))
    ),
    tickMs: Math.max(10_000, Math.trunc(numberOption(argv, "--tick-ms", 60_000))),
    requestGapMs: Math.max(0, Math.trunc(numberOption(argv, "--request-gap-ms", 15_000))),
    requestTimeoutMs: Math.max(30_000, Math.trunc(numberOption(argv, "--request-timeout-ms", 180_000))),
    governanceEveryMs: Math.max(
      300_000,
      Math.trunc(numberOption(argv, "--governance-every-ms", 6 * 60 * 60 * 1000))
    ),
    interactionLimit: Math.max(50, Math.trunc(numberOption(argv, "--interaction-limit", 1000))),
    pauseMemoryPct: Math.max(1, numberOption(argv, "--pause-memory-pct", 85)),
    stopMemoryPct: Math.max(1, numberOption(argv, "--stop-memory-pct", 93)),
    pauseLoadRatio: Math.max(0.1, numberOption(argv, "--pause-load-ratio", 2.5)),
    maxConsecutivePauses: Math.max(1, Math.trunc(numberOption(argv, "--max-consecutive-pauses", 18))),
    pauseMs: Math.max(60_000, Math.trunc(numberOption(argv, "--pause-ms", 10 * 60 * 1000))),
    skipInitialGovernance: hasFlag(argv, "--skip-initial-governance"),
    skipFinalGovernance: hasFlag(argv, "--skip-final-governance")
  };
}

function campaignId(startedAt: string) {
  return `dataset-expansion-${startedAt.replace(/[:.]/g, "-")}`;
}

function readTelemetry() {
  const total = totalmem();
  const free = freemem();
  const usedPct = total > 0 ? Number((((total - free) / total) * 100).toFixed(1)) : 0;
  const cpuCount = Math.max(1, cpus().length);
  const load1 = loadavg()[0] ?? 0;
  return {
    memoryUsedPct: usedPct,
    memoryFreeGb: Number((free / 1024 / 1024 / 1024).toFixed(2)),
    load1: Number(load1.toFixed(2)),
    cpuCount,
    loadRatio: Number((load1 / cpuCount).toFixed(2))
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function postJson<T>(baseUrl: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetch(joinUrl(baseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

async function getJson<T>(baseUrl: string, path: string, timeoutMs: number): Promise<T> {
  const response = await fetch(joinUrl(baseUrl, path), {
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as T;
}

function compact(value: unknown, maxChars = 260) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

async function persistReport(report: CampaignReport) {
  await mkdir(dirname(report.config.output), { recursive: true });
  await writeFile(report.config.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function addEvent(report: CampaignReport, kind: CampaignEventKind, message: string, details?: unknown) {
  const event = {
    at: new Date().toISOString(),
    kind,
    message,
    ...(details === undefined ? {} : { details })
  };
  report.events.push(event);
  report.events = report.events.slice(-300);
  await mkdir(dirname(report.config.logFile), { recursive: true });
  await appendFile(report.config.logFile, `${JSON.stringify(event)}\n`, "utf8");
  await persistReport(report);
  console.log(JSON.stringify(event));
}

function shouldStopForTelemetry(report: CampaignReport) {
  const telemetry = readTelemetry();
  report.latest.telemetry = telemetry;
  if (telemetry.memoryUsedPct >= report.config.stopMemoryPct) {
    return {
      stop: true,
      pause: false,
      reason: `memory ${telemetry.memoryUsedPct}% >= stop threshold ${report.config.stopMemoryPct}%`,
      telemetry
    };
  }
  if (
    telemetry.memoryUsedPct >= report.config.pauseMemoryPct ||
    telemetry.loadRatio >= report.config.pauseLoadRatio
  ) {
    return {
      stop: false,
      pause: true,
      reason: `resource pressure: memory ${telemetry.memoryUsedPct}%, load ratio ${telemetry.loadRatio}`,
      telemetry
    };
  }
  return { stop: false, pause: false, reason: "ok", telemetry };
}

async function runGovernanceCycle(report: CampaignReport, reason: string) {
  const digestService = new InteractionLearningDigestService();
  const watcherKernel = new WatcherKernel();
  const consolidationService = new KnowledgeConsolidationService();
  const promotionService = new KnowledgePromotionGovernanceService();
  const queueValidationService = new TrainingQueueValidationService();

  const digest = await digestService.buildAndPersist({ limit: report.config.interactionLimit });
  const watcherResult = await watcherKernel.run({
    scope: "all",
    limit: report.config.interactionLimit,
    rebuildInteractionDigest: true
  });
  const consolidation = await consolidationService.buildAndPersist({
    rebuildInteractionDigest: true,
    limit: report.config.interactionLimit
  });
  const promotion = await promotionService.evaluateAndPersist({
    mode: "dry_run",
    validationMode: "none"
  });
  const validation = await queueValidationService.validateAndPersist();

  report.counters.governanceCycles += 1;
  report.latest.interactionLearning = digest.sourceStats;
  report.latest.watcherStats = watcherResult.state?.sourceStats ?? null;
  report.latest.knowledgeObjects = consolidation.file.sourceStats;
  report.latest.promotion = {
    sourceStats: promotion.sourceStats,
    trainingQueue: promotion.trainingQueue.sourceStats
  };
  report.latest.trainingQueueValidation = {
    gate: validation.gate,
    sourceStats: validation.sourceStats,
    trainingAuthorization: validation.trainingAuthorization
  };

  await addEvent(report, "governance_cycle", reason, {
    interactions: digest.sourceStats,
    knowledgeObjects: consolidation.file.sourceStats,
    trainingQueue: validation.sourceStats,
    trainingAuthorization: validation.trainingAuthorization
  });
}

async function runChatScenario(report: CampaignReport, scenario: ChatScenario) {
  let sessionId: string | null = null;
  for (const message of scenario.messages) {
    if (report.counters.chatTurnsAttempted >= report.config.maxChatTurns) {
      return;
    }
    report.counters.chatTurnsAttempted += 1;
    const response: ChatPostResponse = await postJson<ChatPostResponse>(
      report.config.baseUrl,
      "/api/chat/message",
      {
        message,
        ...(sessionId ? { sessionId } : {})
      },
      report.config.requestTimeoutMs
    );
    sessionId = response.sessionId ?? sessionId;
    report.counters.chatTurnsCompleted += 1;
    await addEvent(report, "chat", `chat ${scenario.id}`, {
      model: response.generation?.model ?? null,
      provider: response.generation?.provider ?? null,
      durationMs: response.durationMs ?? null,
      qualityPassed: response.conversationQuality?.passed ?? null,
      answer: compact(response.assistantMessage?.content ?? "")
    });
    if (report.config.requestGapMs > 0) {
      await sleep(report.config.requestGapMs);
    }
  }
}

async function runStudentPreview(report: CampaignReport, prompt: string) {
  report.counters.studentPreviewsAttempted += 1;
  const response: StudentPreviewPostResponse = await postJson<StudentPreviewPostResponse>(
    report.config.baseUrl,
    "/api/core/ask",
    {
      mode: "student_preview",
      question: prompt
    },
    report.config.requestTimeoutMs
  );
  report.counters.studentPreviewsCompleted += 1;
  await addEvent(report, "student_preview", "student preview completed", {
    status: response.status,
    model: response.routing?.model ?? null,
    provider: response.routing?.provider ?? null,
    durationMs: response.durationMs ?? null,
    artifactId: response.artifacts?.[0]?.id ?? null,
    answer: compact(response.answer ?? "")
  });
  if (report.config.requestGapMs > 0) {
    await sleep(report.config.requestGapMs);
  }
}

async function runCampaign(args = parseArgs()) {
  const startedAt = new Date();
  const plannedEnd = new Date(startedAt.getTime() + args.durationHours * 60 * 60 * 1000);
  const report: CampaignReport = {
    version: "hydria-dataset-expansion-campaign-v1",
    campaignId: campaignId(startedAt.toISOString()),
    startedAt: startedAt.toISOString(),
    plannedEndAt: plannedEnd.toISOString(),
    completedAt: null,
    status: "running",
    config: args,
    counters: {
      chatTurnsAttempted: 0,
      chatTurnsCompleted: 0,
      studentPreviewsAttempted: 0,
      studentPreviewsCompleted: 0,
      governanceCycles: 0,
      pauses: 0,
      errors: 0
    },
    latest: {
      health: null,
      telemetry: null,
      interactionLearning: null,
      watcherStats: null,
      knowledgeObjects: null,
      promotion: null,
      trainingQueueValidation: null
    },
    events: []
  };

  let nextChatAt = startedAt.getTime();
  let nextPreviewAt = startedAt.getTime() + Math.min(20 * 60 * 1000, args.durationHours * 60 * 60 * 1000);
  let nextGovernanceAt = args.skipInitialGovernance
    ? startedAt.getTime() + args.governanceEveryMs
    : startedAt.getTime();
  const chatInterval =
    args.maxChatTurns > 0
      ? Math.max(args.tickMs, Math.floor((plannedEnd.getTime() - startedAt.getTime()) / args.maxChatTurns))
      : Number.POSITIVE_INFINITY;
  const previewInterval =
    args.maxStudentPreviews > 0
      ? Math.max(args.tickMs, Math.floor((plannedEnd.getTime() - startedAt.getTime()) / args.maxStudentPreviews))
      : Number.POSITIVE_INFINITY;
  let chatIndex = 0;
  let previewIndex = 0;
  let consecutivePauses = 0;

  await addEvent(report, "started", "dataset expansion campaign started", {
    startedAt: report.startedAt,
    plannedEndAt: report.plannedEndAt,
    maxChatTurns: args.maxChatTurns,
    maxStudentPreviews: args.maxStudentPreviews
  });

  while (Date.now() < plannedEnd.getTime()) {
    try {
      const pressure = shouldStopForTelemetry(report);
      if (pressure.stop) {
        report.status = "stopped";
        await addEvent(report, "stopped", pressure.reason, pressure.telemetry);
        break;
      }
      if (pressure.pause) {
        consecutivePauses += 1;
        report.counters.pauses += 1;
        await addEvent(report, "pause", pressure.reason, pressure.telemetry);
        if (consecutivePauses >= args.maxConsecutivePauses) {
          report.status = "stopped";
          await addEvent(report, "stopped", "too many consecutive resource-pressure pauses");
          break;
        }
        await sleep(args.pauseMs);
        continue;
      }
      consecutivePauses = 0;

      const now = Date.now();
      if (now >= nextGovernanceAt) {
        report.latest.health = await getJson(args.baseUrl, "/api/health", args.requestTimeoutMs);
        await addEvent(report, "health", "health check passed", {
          telemetry: pressure.telemetry
        });
        await runGovernanceCycle(report, "periodic governed learning refresh");
        nextGovernanceAt = now + args.governanceEveryMs;
      }

      if (now >= nextChatAt && report.counters.chatTurnsAttempted < args.maxChatTurns) {
        const scenario = chatScenarios[chatIndex % chatScenarios.length]!;
        chatIndex += 1;
        await runChatScenario(report, scenario);
        nextChatAt += chatInterval;
      }

      if (now >= nextPreviewAt && report.counters.studentPreviewsAttempted < args.maxStudentPreviews) {
        const prompt = studentPreviewPrompts[previewIndex % studentPreviewPrompts.length]!;
        previewIndex += 1;
        await runStudentPreview(report, prompt);
        nextPreviewAt += previewInterval;
      }

      if (
        report.counters.chatTurnsAttempted >= args.maxChatTurns &&
        report.counters.studentPreviewsAttempted >= args.maxStudentPreviews
      ) {
        report.status = "completed";
        await addEvent(report, "completed", "campaign budgets exhausted before planned end");
        break;
      }

      await sleep(args.tickMs);
    } catch (error) {
      report.counters.errors += 1;
      await addEvent(report, "error", error instanceof Error ? error.message : String(error));
      await sleep(args.pauseMs);
    }
  }

  if (report.status === "running") {
    report.status = "completed";
    await addEvent(report, "completed", "planned duration reached");
  }

  if (!args.skipFinalGovernance) {
    try {
      await runGovernanceCycle(report, "final governed learning refresh");
    } catch (error) {
      report.counters.errors += 1;
      report.status = report.status === "completed" ? "failed" : report.status;
      await addEvent(
        report,
        "error",
        `final governance cycle failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  report.completedAt = new Date().toISOString();
  await persistReport(report);
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runCampaign()
    .then((report) => {
      console.log(
        JSON.stringify(
          {
            status: report.status,
            campaignId: report.campaignId,
            startedAt: report.startedAt,
            plannedEndAt: report.plannedEndAt,
            completedAt: report.completedAt,
            counters: report.counters,
            latest: report.latest,
            output: report.config.output,
            logFile: report.config.logFile
          },
          null,
          2
        )
      );
      if (report.status === "failed") {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { runCampaign };

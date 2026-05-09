import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  LOCAL_STUDENT_EXTENDED_EVAL_PACK_ID,
  LOCAL_STUDENT_EXTENDED_LIVE_EVAL_PACK,
  LOCAL_STUDENT_EXTENDED_STABILITY_EVAL_PACK,
  LOCAL_STUDENT_EXTENDED_TOOL_ROUTING_EVAL_PACK
} from "../data/localStudentExtendedEvalPack.js";
import { ToolRoutingEvalService, type ToolRoutingEvalReport } from "../services/toolRoutingEvalService.js";
import { LocalModelService } from "../services/localModel.js";
import { LocalStudentLiveEvalService } from "../services/training/localStudentLiveEvalService.js";
import { LocalStudentStabilityEvalService } from "../services/training/localStudentStabilityEvalService.js";
import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";
import type {
  LocalStudentLiveEvalSummary,
  LocalStudentStabilitySummary
} from "../types/training.js";
import { env, projectRoot } from "../utils/env.js";

type ExtendedBenchmarkRun = {
  index: number;
  startedAt: string;
  completedAt: string;
  toolRouting: ToolRoutingEvalReport;
  stability: LocalStudentStabilitySummary;
  live: LocalStudentLiveEvalSummary | null;
};

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseArgs(argv: string[]) {
  const args = {
    runs: 3,
    variantId: undefined as string | undefined,
    modelName: undefined as string | undefined,
    liveLimit: LOCAL_STUDENT_EXTENDED_LIVE_EVAL_PACK.length,
    stabilityLimit: LOCAL_STUDENT_EXTENDED_STABILITY_EVAL_PACK.length,
    toolLimit: LOCAL_STUDENT_EXTENDED_TOOL_ROUTING_EVAL_PACK.length,
    skipLive: false,
    output: resolve(projectRoot, "storage", "training", "student-local-extended-benchmark-v1.json")
  };

  for (const arg of argv) {
    if (arg.startsWith("--runs=")) {
      args.runs = parsePositiveInteger(arg.slice("--runs=".length), args.runs);
    }
    if (arg.startsWith("--variant-id=")) {
      args.variantId = arg.slice("--variant-id=".length).trim() || undefined;
    }
    if (arg.startsWith("--model-name=")) {
      args.modelName = arg.slice("--model-name=".length).trim() || undefined;
    }
    if (arg.startsWith("--live-limit=")) {
      args.liveLimit = Math.min(
        LOCAL_STUDENT_EXTENDED_LIVE_EVAL_PACK.length,
        parsePositiveInteger(arg.slice("--live-limit=".length), args.liveLimit)
      );
    }
    if (arg.startsWith("--stability-limit=")) {
      args.stabilityLimit = Math.min(
        LOCAL_STUDENT_EXTENDED_STABILITY_EVAL_PACK.length,
        parsePositiveInteger(arg.slice("--stability-limit=".length), args.stabilityLimit)
      );
    }
    if (arg.startsWith("--tool-limit=")) {
      args.toolLimit = Math.min(
        LOCAL_STUDENT_EXTENDED_TOOL_ROUTING_EVAL_PACK.length,
        parsePositiveInteger(arg.slice("--tool-limit=".length), args.toolLimit)
      );
    }
    if (arg === "--skip-live") {
      args.skipLive = true;
    }
    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (value) {
        args.output = resolve(value);
      }
    }
  }

  return args;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function unique(values: Array<string | number | boolean | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "null")))];
}

function summarizeStability(runs: ExtendedBenchmarkRun[]) {
  const itemsById = new Map<string, Array<LocalStudentStabilitySummary["items"][number]>>();
  for (const run of runs) {
    for (const item of run.stability.items) {
      itemsById.set(item.id, [...(itemsById.get(item.id) ?? []), item]);
    }
  }

  return [...itemsById.entries()]
    .map(([id, items]) => ({
      id,
      question: items[0]?.question ?? id,
      parseModes: unique(items.map((item) => item.parseMode)),
      retryCount: items.filter((item) => item.usedRetry).length,
      degradedCount: items.filter((item) => item.degraded).length,
      errorCount: items.filter((item) => item.error !== null).length,
      minAnswerWordCount: Math.min(...items.map((item) => item.answerWordCount)),
      averageDurationMs: average(items.map((item) => item.durationMs))
    }))
    .filter(
      (item) =>
        item.parseModes.some((mode) => mode !== "strict") ||
        item.retryCount > 0 ||
        item.degradedCount > 0 ||
        item.errorCount > 0
    );
}

function summarizeLive(runs: ExtendedBenchmarkRun[]) {
  const liveRuns = runs.flatMap((run) => run.live?.items ?? []);
  const itemsById = new Map<string, typeof liveRuns>();
  for (const item of liveRuns) {
    itemsById.set(item.id, [...(itemsById.get(item.id) ?? []), item]);
  }

  return [...itemsById.entries()]
    .map(([id, items]) => ({
      id,
      question: items[0]?.question ?? id,
      verdicts: unique(items.map((item) => item.verdict)),
      worthIt: unique(items.map((item) => item.worthIt)),
      toolUsedRate: average(items.map((item) => (item.toolUsed ? 100 : 0))),
      minSessionScore: Math.min(...items.map((item) => item.sessionScore ?? 0)),
      averageSessionScore: average(items.map((item) => item.sessionScore ?? 0)),
      minDeltaOverall: Math.min(...items.map((item) => item.deltaOverall ?? 0)),
      errorCount: items.filter((item) => item.error !== null).length
    }))
    .filter(
      (item) =>
        item.verdicts.length > 1 ||
        item.worthIt.length > 1 ||
        item.verdicts.some((verdict) => verdict === "needs_work" || verdict === "regressed" || verdict === "null") ||
        item.minSessionScore < 75 ||
        item.errorCount > 0
    );
}

function summarizeToolRouting(runs: ExtendedBenchmarkRun[]) {
  return runs.flatMap((run) =>
    run.toolRouting.items
      .filter((item) => !item.passed)
      .map((item) => ({
        run: run.index,
        id: item.id,
        question: item.question,
        failures: item.failures,
        observed: item.observed
      }))
  );
}

function buildRecommendations(args: {
  toolFailures: unknown[];
  stabilityRisks: unknown[];
  liveRisks: unknown[];
}) {
  const recommendations: string[] = [];
  if (args.toolFailures.length > 0) {
    recommendations.push("Fix tool routing failures before collecting new training examples.");
  }
  if (args.stabilityRisks.length > 0) {
    recommendations.push("Turn stability retries/fallbacks into repair examples for the next SFT pack.");
  }
  if (args.liveRisks.length > 0) {
    recommendations.push("Collect raw live sessions for unstable prompts and create targeted runtime + repair examples.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Keep the active variant and continue monitoring; no immediate v10 training is justified by this run.");
  }

  return recommendations;
}

async function resolveModel(args: ReturnType<typeof parseArgs>) {
  if (args.modelName) {
    return {
      variantId: args.variantId ?? args.modelName,
      modelName: args.modelName,
      variantState: null as string | null
    };
  }

  const registry = new LocalStudentVariantRegistry();
  if (args.variantId) {
    const variant = await registry.getVariant(args.variantId);
    if (variant) {
      return {
        variantId: variant.id,
        modelName: variant.servedModelName,
        variantState: variant.state
      };
    }
  }

  const activeVariants = await registry.listVariants(["active"]);
  const selected =
    activeVariants
      .filter((variant) => variant.id !== "student-local-base")
      .sort((a, b) => b.confidenceScore - a.confidenceScore || b.updatedAt.localeCompare(a.updatedAt))[0] ??
    activeVariants.sort((a, b) => b.confidenceScore - a.confidenceScore)[0];

  return {
    variantId: selected?.id ?? "env-local-model",
    modelName: selected?.servedModelName ?? env.LOCAL_MODEL_NAME,
    variantState: selected?.state ?? null
  };
}

const args = parseArgs(process.argv.slice(2));
const model = await resolveModel(args);
const localModelService = new LocalModelService({ modelName: model.modelName });
const runs: ExtendedBenchmarkRun[] = [];

for (let index = 1; index <= args.runs; index++) {
  const startedAt = new Date().toISOString();
  console.log(`[extended-benchmark] run ${index}/${args.runs}: tool routing`);
  const toolRouting = new ToolRoutingEvalService().run({
    cases: LOCAL_STUDENT_EXTENDED_TOOL_ROUTING_EVAL_PACK,
    limit: args.toolLimit
  });

  console.log(`[extended-benchmark] run ${index}/${args.runs}: stability`);
  const stability = await new LocalStudentStabilityEvalService(localModelService).run({
    prompts: LOCAL_STUDENT_EXTENDED_STABILITY_EVAL_PACK,
    limit: args.stabilityLimit
  });

  console.log(`[extended-benchmark] run ${index}/${args.runs}: live`);
  const live = args.skipLive
    ? null
    : await new LocalStudentLiveEvalService(localModelService).run({
        prompts: LOCAL_STUDENT_EXTENDED_LIVE_EVAL_PACK,
        limit: args.liveLimit
      });

  runs.push({
    index,
    startedAt,
    completedAt: new Date().toISOString(),
    toolRouting,
    stability,
    live
  });
}

const toolFailures = summarizeToolRouting(runs);
const stabilityRisks = summarizeStability(runs);
const liveRisks = summarizeLive(runs);
const report = {
  version: "hydria-local-student-extended-benchmark-v1",
  runId: randomUUID(),
  packId: LOCAL_STUDENT_EXTENDED_EVAL_PACK_ID,
  createdAt: new Date().toISOString(),
  variantId: model.variantId,
  modelName: model.modelName,
  variantState: model.variantState,
  requestedRuns: args.runs,
  limits: {
    tool: args.toolLimit,
    stability: args.stabilityLimit,
    live: args.skipLive ? 0 : args.liveLimit
  },
  aggregate: {
    toolRoutingAccuracyPct: average(runs.map((run) => run.toolRouting.accuracyPct)),
    stabilityStrictRate: average(runs.map((run) => run.stability.strictRate)),
    stabilityRetryRate: average(runs.map((run) => run.stability.retryRate)),
    stabilityFallbackRate: average(runs.map((run) => run.stability.fallbackRate)),
    liveAverageSessionScore: average(
      runs.map((run) => run.live?.averageSessionScore ?? 0).filter((value) => value > 0)
    ),
    liveImprovedRate: average(
      runs.map((run) => run.live?.improvedRate ?? 0).filter((value) => value > 0)
    ),
    liveWorthItRate: average(
      runs.map((run) => run.live?.worthItRate ?? 0).filter((value) => value > 0)
    )
  },
  risks: {
    toolFailures,
    stabilityRisks,
    liveRisks
  },
  recommendations: buildRecommendations({
    toolFailures,
    stabilityRisks,
    liveRisks
  }),
  runs
};

await mkdir(dirname(args.output), { recursive: true });
await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      output: args.output,
      variantId: report.variantId,
      modelName: report.modelName,
      aggregate: report.aggregate,
      riskCounts: {
        toolFailures: toolFailures.length,
        stabilityRisks: stabilityRisks.length,
        liveRisks: liveRisks.length
      },
      recommendations: report.recommendations
    },
    null,
    2
  )
);

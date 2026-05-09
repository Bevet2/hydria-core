import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_RUNTIME_MINI_BENCHMARK_ID,
  CONVERSATION_RUNTIME_MINI_BENCHMARK_PACK,
  type ConversationRuntimeMiniBenchmarkCause
} from "../data/conversationRuntimeMiniBenchmarkPack.js";
import { KnowledgeInjectionService } from "../services/knowledgeInjectionService.js";
import { LocalModelService } from "../services/localModel.js";
import {
  buildConversationReasoningDiagnostics,
  type ConversationReasoningCaseResult
} from "../services/reasoning/conversationReasoningEvaluator.js";
import { StudentStrategySelectorService } from "../services/studentStrategySelector.js";
import { ToolRoutingService } from "../services/tools/toolRoutingService.js";
import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";
import { env, projectRoot } from "../utils/env.js";
import {
  runConversationReasoningCase,
  summarizeConversationReasoningItems
} from "./runConversationReasoningBenchmark.js";

const currentFile = fileURLToPath(import.meta.url);
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "conversation-runtime-mini-benchmark-v1.json"
);
const defaultDiagnosticsOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "conversation-runtime-mini-diagnostics-v1.json"
);

type MiniBenchmarkItem = ConversationReasoningCaseResult & {
  targetCause: ConversationRuntimeMiniBenchmarkCause;
  causePassed: boolean;
  firstPassPassed: boolean;
  causeIssues: string[];
};

type MiniBenchmarkReport = {
  version: "hydria-conversation-runtime-mini-benchmark-v1";
  gateId: typeof CONVERSATION_RUNTIME_MINI_BENCHMARK_ID;
  runId: string;
  createdAt: string;
  completedAt: string;
  model: {
    variantId: string;
    modelName: string;
    variantState: string | null;
  };
  requested: {
    totalCases: number;
    executedCases: number;
    cause: ConversationRuntimeMiniBenchmarkCause | "all";
    limit: number | null;
  };
  summary: ReturnType<typeof summarizeConversationReasoningItems> & {
    causePassRate: number;
    firstPassRate: number;
    byCause: Record<
      string,
      {
        total: number;
        passed: number;
        firstPassPassed: number;
      }
    >;
  };
  items: MiniBenchmarkItem[];
};

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseArgs(argv: string[]) {
  const args = {
    output: defaultOutput,
    diagnosticsOutput: defaultDiagnosticsOutput,
    limit: Number.POSITIVE_INFINITY,
    cause: "all" as ConversationRuntimeMiniBenchmarkCause | "all",
    modelName: undefined as string | undefined,
    variantId: undefined as string | undefined
  };

  for (const arg of argv) {
    if (arg.startsWith("--output=")) {
      args.output = resolve(arg.slice("--output=".length).trim());
    } else if (arg.startsWith("--diagnostics-output=")) {
      args.diagnosticsOutput = resolve(arg.slice("--diagnostics-output=".length).trim());
    } else if (arg.startsWith("--limit=")) {
      args.limit = parsePositiveInteger(arg.slice("--limit=".length), args.limit);
    } else if (arg.startsWith("--cause=")) {
      const cause = arg.slice("--cause=".length).trim();
      if (
        cause === "context_loss" ||
        cause === "repeated_previous_answer" ||
        cause === "wrong_language" ||
        cause === "all"
      ) {
        args.cause = cause;
      }
    } else if (arg.startsWith("--model-name=")) {
      args.modelName = arg.slice("--model-name=".length).trim() || undefined;
    } else if (arg.startsWith("--variant-id=")) {
      args.variantId = arg.slice("--variant-id=".length).trim() || undefined;
    }
  }

  return args;
}

function percentage(count: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return Math.round((count / total) * 1000) / 10;
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
  const requestedVariant = args.variantId ? await registry.getVariant(args.variantId) : null;
  const preferredV10 = await registry.getVariant("student-local-1p5b-toolbench-lora-v10-light");
  const selected =
    requestedVariant ??
    (preferredV10?.state === "active" ? preferredV10 : null) ??
    (await registry.listVariants(["active"])).find((variant) => variant.id !== "student-local-base");

  return {
    variantId: selected?.id ?? "env-local-model",
    modelName: selected?.servedModelName ?? env.LOCAL_MODEL_NAME,
    variantState: selected?.state ?? null
  };
}

function hasIssue(item: ConversationReasoningCaseResult, issue: string) {
  return (
    item.evaluation.issues.includes(issue) ||
    item.responses.some((response) => response.conversationQuality?.issues.includes(issue))
  );
}

function firstPassPassed(item: ConversationReasoningCaseResult) {
  return !item.responses.some((response) => response.retriedForConversationQuality || response.usedRetry);
}

function evaluateTargetCause(item: ConversationReasoningCaseResult, targetCause: ConversationRuntimeMiniBenchmarkCause) {
  const causeIssues: string[] = [];
  const firstPass = firstPassPassed(item);

  if (targetCause === "context_loss") {
    if (hasIssue(item, "context_tracking_weak") || hasIssue(item, "ignored_context_change")) {
      causeIssues.push("context_loss");
    }
    if (item.evaluation.contextTrackingScore < 80) {
      causeIssues.push("low_context_tracking_score");
    }
    if (item.evaluation.adaptationScore < 75) {
      causeIssues.push("low_adaptation_score");
    }
  }

  if (targetCause === "repeated_previous_answer") {
    if (hasIssue(item, "repeated_previous_answer")) {
      causeIssues.push("repeated_previous_answer");
    }
    if (!firstPass) {
      causeIssues.push("needed_repair_or_model_retry");
    }
    if (item.evaluation.consistencyScore < 70) {
      causeIssues.push("low_consistency_score");
    }
  }

  if (targetCause === "wrong_language") {
    if (hasIssue(item, "language_consistency_weak")) {
      causeIssues.push("language_consistency_weak");
    }
    if (hasIssue(item, "wrong_language_expected_fr") || hasIssue(item, "wrong_language_expected_en")) {
      causeIssues.push("conversation_quality_wrong_language");
    }
    if (item.evaluation.languageConsistencyScore < 80) {
      causeIssues.push("low_language_consistency_score");
    }
  }

  return {
    causePassed: causeIssues.length === 0,
    firstPassPassed: firstPass,
    causeIssues
  };
}

function summarizeMini(items: MiniBenchmarkItem[]): MiniBenchmarkReport["summary"] {
  const base = summarizeConversationReasoningItems(items);
  const byCause: MiniBenchmarkReport["summary"]["byCause"] = {};

  for (const item of items) {
    byCause[item.targetCause] ??= {
      total: 0,
      passed: 0,
      firstPassPassed: 0
    };
    const bucket = byCause[item.targetCause]!;
    bucket.total += 1;
    bucket.passed += item.causePassed ? 1 : 0;
    bucket.firstPassPassed += item.firstPassPassed ? 1 : 0;
  }

  return {
    ...base,
    causePassRate: percentage(items.filter((item) => item.causePassed).length, items.length),
    firstPassRate: percentage(items.filter((item) => item.firstPassPassed).length, items.length),
    byCause
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedCases = CONVERSATION_RUNTIME_MINI_BENCHMARK_PACK.filter((item) =>
    args.cause === "all" ? true : item.targetCause === args.cause
  ).slice(0, args.limit);
  const model = await resolveModel(args);
  const localModelService = new LocalModelService({ modelName: model.modelName });
  const knowledgeInjectionService = new KnowledgeInjectionService();
  const strategySelectorService = new StudentStrategySelectorService();
  const toolRoutingService = new ToolRoutingService();
  const items: MiniBenchmarkItem[] = [];

  for (const [index, testCase] of selectedCases.entries()) {
    console.log(`[conversation-runtime-mini] ${index + 1}/${selectedCases.length}: ${testCase.id}`);
    const result = await runConversationReasoningCase({
      testCase,
      localModelService,
      knowledgeInjectionService,
      strategySelectorService,
      toolRoutingService
    });
    const causeEvaluation = evaluateTargetCause(result, testCase.targetCause);
    items.push({
      ...result,
      targetCause: testCase.targetCause,
      ...causeEvaluation
    });
  }

  const report: MiniBenchmarkReport = {
    version: "hydria-conversation-runtime-mini-benchmark-v1",
    gateId: CONVERSATION_RUNTIME_MINI_BENCHMARK_ID,
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    model,
    requested: {
      totalCases: CONVERSATION_RUNTIME_MINI_BENCHMARK_PACK.length,
      executedCases: selectedCases.length,
      cause: args.cause,
      limit: Number.isFinite(args.limit) ? args.limit : null
    },
    summary: summarizeMini(items),
    items
  };
  const diagnostics = buildConversationReasoningDiagnostics(report);

  await writeJson(args.output, report);
  await writeJson(args.diagnosticsOutput, diagnostics);

  console.log(
    JSON.stringify(
      {
        output: args.output,
        diagnosticsOutput: args.diagnosticsOutput,
        model,
        summary: report.summary,
        diagnostics: {
          rates: diagnostics.rates,
          counts: diagnostics.counts
        }
      },
      null,
      2
    )
  );
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STRATEGIC_COHERENCE_FINE_EVAL_PACK,
  STRATEGIC_COHERENCE_FINE_GATE_ID
} from "../data/strategicCoherenceFineEvalPack.js";
import { KnowledgeInjectionService } from "../services/knowledgeInjectionService.js";
import { LocalModelService } from "../services/localModel.js";
import {
  buildConversationReasoningDiagnostics,
  type ConversationReasoningCaseResult
} from "../services/reasoning/conversationReasoningEvaluator.js";
import { StudentStrategySelectorService } from "../services/studentStrategySelector.js";
import { ToolRoutingService } from "../services/tools/toolRoutingService.js";
import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";
import {
  runConversationReasoningCase,
  summarizeConversationReasoningItems
} from "./runConversationReasoningBenchmark.js";
import { env, projectRoot } from "../utils/env.js";

const currentFile = fileURLToPath(import.meta.url);
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "strategic-coherence-fine-benchmark-v1.json"
);
const defaultDiagnosticsOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "strategic-coherence-fine-diagnostics-v1.json"
);

type StrategicCoherenceFineReport = {
  version: "hydria-strategic-coherence-fine-benchmark-v1";
  gateId: string;
  runId: string;
  createdAt: string;
  completedAt?: string;
  status: "completed";
  model: {
    variantId: string;
    modelName: string;
    variantState: string | null;
  };
  requested: {
    totalCases: number;
    executedCases: number;
    limit: number | null;
  };
  summary: ReturnType<typeof summarizeConversationReasoningItems>;
  fineCoherenceSummary: {
    strategicTurns: number;
    unresolvedStrategicConflictCount: number;
    missingRevisionConditionCount: number;
    overRigidStrategicAnswerCount: number;
    ignoredAddedConstraintCount: number;
    ignoredContextChangeCount: number;
    fineCoherenceIssueCount: number;
    fineCoherencePassRate: number;
  };
  items: ConversationReasoningCaseResult[];
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
    activeVariants.find((variant) => variant.id === "student-local-1p5b-toolbench-lora-v10-light") ??
    activeVariants
      .filter((variant) => variant.id !== "student-local-base")
      .sort((left, right) => right.confidenceScore - left.confidenceScore || right.updatedAt.localeCompare(left.updatedAt))[0] ??
    activeVariants.sort((left, right) => right.confidenceScore - left.confidenceScore)[0];

  return {
    variantId: selected?.id ?? "env-local-model",
    modelName: selected?.servedModelName ?? env.LOCAL_MODEL_NAME,
    variantState: selected?.state ?? null
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildFineCoherenceSummary(items: ConversationReasoningCaseResult[]): StrategicCoherenceFineReport["fineCoherenceSummary"] {
  const completed = items.filter((item) => !item.error);
  const turns = completed.flatMap((item) => item.responses);
  const strategicTurns = turns.filter(
    (turn) => turn.answerPolicy?.strategicCoherencePolicy.hasStrategicCoherenceRequirement
  ).length;
  const unresolvedStrategicConflictCount = turns.filter((turn) =>
    turn.conversationQuality?.issues.includes("strategic_conflict_not_resolved")
  ).length;
  const missingRevisionConditionCount = turns.filter((turn) =>
    turn.conversationQuality?.issues.includes("missing_strategic_revision_condition")
  ).length;
  const overRigidStrategicAnswerCount = turns.filter((turn) =>
    turn.conversationQuality?.issues.includes("over_rigid_strategic_answer")
  ).length;
  const ignoredAddedConstraintCount = turns.filter((turn) =>
    turn.conversationQuality?.issues.includes("ignored_added_constraint")
  ).length;
  const ignoredContextChangeCount = turns.filter((turn) =>
    turn.conversationQuality?.issues.includes("ignored_context_change")
  ).length;
  const fineCoherenceIssueCount =
    unresolvedStrategicConflictCount +
    missingRevisionConditionCount +
    overRigidStrategicAnswerCount +
    ignoredAddedConstraintCount +
    ignoredContextChangeCount;

  return {
    strategicTurns,
    unresolvedStrategicConflictCount,
    missingRevisionConditionCount,
    overRigidStrategicAnswerCount,
    ignoredAddedConstraintCount,
    ignoredContextChangeCount,
    fineCoherenceIssueCount,
    fineCoherencePassRate: percentage(strategicTurns - fineCoherenceIssueCount, strategicTurns)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedCases = STRATEGIC_COHERENCE_FINE_EVAL_PACK.slice(0, args.limit);
  const model = await resolveModel(args);
  const localModelService = new LocalModelService({ modelName: model.modelName });
  const knowledgeInjectionService = new KnowledgeInjectionService();
  const strategySelectorService = new StudentStrategySelectorService();
  const toolRoutingService = new ToolRoutingService();
  const items: ConversationReasoningCaseResult[] = [];
  const runId = randomUUID();

  for (const [index, testCase] of selectedCases.entries()) {
    console.log(`[strategic-coherence-fine] ${index + 1}/${selectedCases.length}: ${testCase.id}`);
    items.push(
      await runConversationReasoningCase({
        testCase,
        localModelService,
        knowledgeInjectionService,
        strategySelectorService,
        toolRoutingService
      })
    );
  }

  const report: StrategicCoherenceFineReport = {
    version: "hydria-strategic-coherence-fine-benchmark-v1",
    gateId: STRATEGIC_COHERENCE_FINE_GATE_ID,
    runId,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: "completed",
    model,
    requested: {
      totalCases: STRATEGIC_COHERENCE_FINE_EVAL_PACK.length,
      executedCases: selectedCases.length,
      limit: Number.isFinite(args.limit) ? args.limit : null
    },
    summary: summarizeConversationReasoningItems(items),
    fineCoherenceSummary: buildFineCoherenceSummary(items),
    items
  };
  const diagnostics = {
    ...buildConversationReasoningDiagnostics(report),
    fineCoherenceSummary: report.fineCoherenceSummary
  };

  await writeJson(args.output, report);
  await writeJson(args.diagnosticsOutput, diagnostics);

  console.log(
    JSON.stringify(
      {
        output: args.output,
        diagnosticsOutput: args.diagnosticsOutput,
        model,
        summary: report.summary,
        fineCoherenceSummary: report.fineCoherenceSummary
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

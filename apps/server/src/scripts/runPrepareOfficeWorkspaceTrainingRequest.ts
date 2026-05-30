import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalStudentTrainingEnvService } from "../services/training/localStudentTrainingEnvService.js";
import { LocalStudentTrainingRequestService } from "../services/training/localStudentTrainingRequestService.js";
import { runHydriaOsOfficeWorkspaceActionGate } from "./runHydriaOsOfficeWorkspaceActionGate.js";

type OfficeWorkspaceSeedExample = {
  exampleId?: string;
  workspaceFamily?: string;
  task?: string;
  messages?: Array<{ role?: string; content?: string }>;
  targetAnswer?: string;
  target?: {
    proposedActions?: Array<{
      type?: string;
      dryRun?: boolean;
      target?: {
        workObjectId?: string | null;
        entryPath?: string | null;
      };
    }>;
  };
};

type SeedValidation = {
  passed: boolean;
  issues: string[];
  exampleCount: number;
  spreadsheetCount: number;
  documentCount: number;
  dryRunActionCount: number;
  updateActionCount: number;
  createArtifactActionCount: number;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultTrainFile = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-os-office-workspace-action-sft-seed-v1.jsonl"
);
const defaultGateOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "hydria-os-office-workspace-action-gate-v1.json"
);
const candidateVariantId = "student-local-1p5b-toolbench-lora-v11-office-workspace-light";
const defaultTrainingRequestOutput = resolve(
  projectRoot,
  "storage",
  "training",
  `${candidateVariantId}-training-request-v1.json`
);
const defaultTrainingReportOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "v11-office-workspace-light-training-report.json"
);

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    trainFile: resolve(projectRoot, readOption(argv, "--train-file") ?? defaultTrainFile),
    gateOutput: resolve(projectRoot, readOption(argv, "--gate-output") ?? defaultGateOutput),
    trainingRequestOutput: resolve(
      projectRoot,
      readOption(argv, "--training-request-output") ?? defaultTrainingRequestOutput
    ),
    trainingReportOutput: resolve(
      projectRoot,
      readOption(argv, "--training-report-output") ?? defaultTrainingReportOutput
    ),
    skipGate: argv.includes("--skip-gate"),
    skipEnv: argv.includes("--skip-env")
  };
}

async function readSeedExamples(trainFile: string) {
  const raw = await readFile(trainFile, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OfficeWorkspaceSeedExample);
}

function validateSeedExamples(examples: OfficeWorkspaceSeedExample[]): SeedValidation {
  const issues: string[] = [];
  const actionLists = examples.map((example) => example.target?.proposedActions ?? []);
  const actions = actionLists.flat();
  const spreadsheetCount = examples.filter((example) => example.workspaceFamily === "data_spreadsheet").length;
  const documentCount = examples.filter((example) => example.workspaceFamily === "document_knowledge").length;
  const dryRunActionCount = actions.filter((action) => action.dryRun === true).length;
  const updateActionCount = actions.filter((action) => action.type === "update_work_object").length;
  const createArtifactActionCount = actions.filter((action) => action.type === "create_artifact").length;

  if (examples.length < 10) {
    issues.push(`not_enough_seed_examples:${examples.length}<10`);
  }
  if (spreadsheetCount < 4) {
    issues.push(`not_enough_spreadsheet_examples:${spreadsheetCount}<4`);
  }
  if (documentCount < 5) {
    issues.push(`not_enough_document_examples:${documentCount}<5`);
  }
  if (dryRunActionCount !== actions.length) {
    issues.push("non_dry_run_action_present");
  }
  if (updateActionCount < 4) {
    issues.push(`not_enough_update_actions:${updateActionCount}<4`);
  }
  if (createArtifactActionCount < 2) {
    issues.push(`not_enough_create_artifact_actions:${createArtifactActionCount}<2`);
  }

  examples.forEach((example, index) => {
    if (!example.exampleId) {
      issues.push(`example_${index}_missing_id`);
    }
    if (example.task !== "workspace_action_planning") {
      issues.push(`example_${example.exampleId ?? index}_wrong_task`);
    }
    if (!example.targetAnswer || !example.targetAnswer.includes("proposedActions")) {
      issues.push(`example_${example.exampleId ?? index}_missing_target_answer`);
    }
    if (!Array.isArray(example.messages) || example.messages.length < 2) {
      issues.push(`example_${example.exampleId ?? index}_missing_messages`);
    }
    if ((example.target?.proposedActions ?? []).length !== 1) {
      issues.push(`example_${example.exampleId ?? index}_expected_single_action`);
    }
  });

  return {
    passed: issues.length === 0,
    issues,
    exampleCount: examples.length,
    spreadsheetCount,
    documentCount,
    dryRunActionCount,
    updateActionCount,
    createArtifactActionCount
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function runPrepareOfficeWorkspaceTrainingRequest(args = parseArgs()) {
  const gate = args.skipGate
    ? null
    : await runHydriaOsOfficeWorkspaceActionGate({
        output: args.gateOutput,
        trainingOutput: args.trainFile
      });
  const seedExamples = await readSeedExamples(args.trainFile);
  const validation = validateSeedExamples(seedExamples);
  const envReport = args.skipEnv ? null : await new LocalStudentTrainingEnvService().check();
  const executionRecipe =
    envReport?.recommendedMethod === "lora_full" ? "lora_full" : "qlora_4bit";
  const perDeviceTrainBatchSize = envReport?.recommendedPerDeviceTrainBatchSize ?? 1;
  const epochs = 5;
  const gradientAccumulationSteps = 1;
  const maxSeqLength =
    envReport?.recommendedMaxSeqLength ?? (executionRecipe === "lora_full" ? 1024 : 2048);

  const service = new LocalStudentTrainingRequestService();
  const { request, outputFile } = await service.buildAndPersist({
    baseVariantId: "student-local-1p5b-toolbench-lora-v10-light",
    candidateVariantId,
    runtimeModelName: "student-local-1p5b-toolbench-lora-v10-light:latest",
    trainingBaseModel: "Qwen/Qwen2.5-1.5B-Instruct",
    executionRecipe,
    trainFile: args.trainFile,
    outputFile: args.trainingRequestOutput,
    outputDir: resolve(projectRoot, "outputs", candidateVariantId),
    epochs,
    perDeviceTrainBatchSize,
    gradientAccumulationSteps,
    maxSeqLength
  });

  const trainingAllowed = Boolean((gate?.passed ?? true) && validation.passed);
  const trainingExecutionReady = envReport ? envReport.readiness === "ready" : null;
  const report = {
    version: "hydria-v11-office-workspace-light-training-report-v1",
    generatedAt: new Date().toISOString(),
    trainingAllowed,
    trainingExecutionReady,
    executedTraining: false,
    reason: trainingAllowed
      ? "The Office workspace seed and gate are valid. The LoRA run is prepared but remains an external execution step."
      : "Training is blocked until the Office workspace seed/gate issues are fixed.",
    gate: gate
      ? {
          passed: gate.passed,
          summary: gate.summary
        }
      : {
          skipped: true
        },
    seedValidation: validation,
    environment: envReport
      ? {
          readiness: envReport.readiness,
          recommendedMethod: envReport.recommendedMethod,
          cudaAvailable: envReport.cudaAvailable,
          gpuName: envReport.gpuName,
          gpuMemoryGb: envReport.gpuMemoryGb,
          missingPackages: envReport.missingPackages,
          notes: envReport.notes
        }
      : {
          skipped: true
        },
    request,
    files: {
      trainFile: args.trainFile,
      trainingRequestFile: outputFile,
      trainingReportFile: args.trainingReportOutput
    },
    promotionRules: [
      "Run the Office workspace gate before and after training.",
      "Run public API workspace action tests.",
      "Use the focused small-pack recipe: 5 epochs and gradient accumulation 1, then evaluate direct model JSON output.",
      "Do not promote if source-sensitive Word requests start using the deterministic fast path.",
      "Do not promote if proposedActions stop being dry-run.",
      "Do not replace v10-light until A/B gates pass."
    ]
  };

  await writeJson(args.trainingReportOutput, report);
  console.log(
    JSON.stringify(
      {
        trainingAllowed: report.trainingAllowed,
        trainingExecutionReady: report.trainingExecutionReady,
        executedTraining: report.executedTraining,
        seedValidation: report.seedValidation,
        trainingRequestFile: outputFile,
        trainingReportFile: args.trainingReportOutput,
        command: request.command
      },
      null,
      2
    )
  );

  if (!report.trainingAllowed) {
    process.exitCode = 1;
  }

  return report;
}

if (resolve(process.argv[1] ?? "") === currentFilePath) {
  runPrepareOfficeWorkspaceTrainingRequest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

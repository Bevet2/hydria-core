import { resolve } from "node:path";
import { LocalStudentTrainingRequestService } from "../services/training/localStudentTrainingRequestService.js";
import { LocalStudentTrainingEnvService } from "../services/training/localStudentTrainingEnvService.js";

function parseArgs(argv: string[]) {
  const args = {
    baseVariantId: "student-local-base",
    candidateVariantId: "student-local-lora-v1",
    runtimeModelName: undefined as string | undefined,
    trainingBaseModel: undefined as string | undefined,
    executionRecipe: undefined as "qlora_4bit" | "lora_full" | undefined,
    outputFile: undefined as string | undefined,
    trainFile: undefined as string | undefined,
    outputDir: undefined as string | undefined,
    perDeviceTrainBatchSize: undefined as number | undefined,
    gradientAccumulationSteps: undefined as number | undefined,
    maxSeqLength: undefined as number | undefined,
    auto: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--base-variant-id=")) {
      args.baseVariantId = arg.slice("--base-variant-id=".length).trim() || args.baseVariantId;
    }
    if (arg.startsWith("--candidate-variant-id=")) {
      args.candidateVariantId =
        arg.slice("--candidate-variant-id=".length).trim() || args.candidateVariantId;
    }
    if (arg.startsWith("--runtime-model-name=")) {
      const value = arg.slice("--runtime-model-name=".length).trim();
      if (value) {
        args.runtimeModelName = value;
      }
    }
    if (arg.startsWith("--training-base-model=")) {
      const value = arg.slice("--training-base-model=".length).trim();
      if (value) {
        args.trainingBaseModel = value;
      }
    }
    if (arg.startsWith("--execution-recipe=")) {
      const value = arg.slice("--execution-recipe=".length).trim();
      if (value === "qlora_4bit" || value === "lora_full") {
        args.executionRecipe = value;
      }
    }
    if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length).trim();
      if (value) {
        args.outputFile = resolve(value);
      }
    }
    if (arg.startsWith("--train-file=")) {
      const value = arg.slice("--train-file=".length).trim();
      if (value) {
        args.trainFile = resolve(value);
      }
    }
    if (arg.startsWith("--output-dir=")) {
      const value = arg.slice("--output-dir=".length).trim();
      if (value) {
        args.outputDir = resolve(value);
      }
    }
    if (arg.startsWith("--per-device-train-batch-size=")) {
      const value = Number(arg.slice("--per-device-train-batch-size=".length).trim());
      if (Number.isFinite(value) && value > 0) {
        args.perDeviceTrainBatchSize = value;
      }
    }
    if (arg.startsWith("--gradient-accumulation-steps=")) {
      const value = Number(arg.slice("--gradient-accumulation-steps=".length).trim());
      if (Number.isFinite(value) && value > 0) {
        args.gradientAccumulationSteps = value;
      }
    }
    if (arg.startsWith("--max-seq-length=")) {
      const value = Number(arg.slice("--max-seq-length=".length).trim());
      if (Number.isFinite(value) && value > 0) {
        args.maxSeqLength = value;
      }
    }
    if (arg === "--auto") {
      args.auto = true;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.auto) {
  const envReport = await new LocalStudentTrainingEnvService().check();
  args.baseVariantId = envReport.recommendedVariantId;
  args.candidateVariantId = envReport.recommendedCandidateVariantId;
  args.runtimeModelName = envReport.recommendedRuntimeModelName;
  args.trainingBaseModel = envReport.recommendedTrainingBaseModel;
  args.executionRecipe =
    envReport.recommendedMethod === "lora_full" ? "lora_full" : "qlora_4bit";
  args.perDeviceTrainBatchSize = envReport.recommendedPerDeviceTrainBatchSize ?? undefined;
  args.gradientAccumulationSteps =
    envReport.recommendedGradientAccumulationSteps ?? undefined;
  args.maxSeqLength = envReport.recommendedMaxSeqLength ?? undefined;
}

const service = new LocalStudentTrainingRequestService();
const result = await service.buildAndPersist(args);

console.log(
  JSON.stringify(
    {
      outputFile: result.outputFile,
      request: result.request
    },
    null,
    2
  )
);

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  localStudentTrainingRequestSchema,
  type LocalStudentTrainingRequest
} from "../../types/training.js";
import { env, projectRoot } from "../../utils/env.js";

type BuildLocalStudentTrainingRequestArgs = {
  baseVariantId?: string;
  candidateVariantId?: string;
  runtimeModelName?: string;
  trainingBaseModel?: string;
  executionRecipe?: "qlora_4bit" | "lora_full";
  outputFile?: string;
  trainFile?: string;
  outputDir?: string;
  epochs?: number;
  learningRate?: number;
  perDeviceTrainBatchSize?: number;
  gradientAccumulationSteps?: number;
  maxSeqLength?: number;
};

function defaultOutputFile(candidateVariantId: string) {
  return resolve(projectRoot, "storage", "training", `${candidateVariantId}-training-request-v1.json`);
}

function defaultTrainFile() {
  // v12 is the combined stable-knowledge gold dataset; the finetune orchestrator
  // merges multiple JSONL files — this default is used only for standalone requests.
  const v12 = resolve(projectRoot, "storage", "datasets", "student-local-sft-v12-stable-knowledge.jsonl");
  const v1 = resolve(projectRoot, "storage", "datasets", "student-local-sft-v1.jsonl");
  return existsSync(v12) ? v12 : v1;
}

function defaultOutputDir(candidateVariantId: string) {
  return resolve(projectRoot, "outputs", candidateVariantId);
}

function defaultTrainingBaseModel(runtimeModelName: string) {
  const normalized = runtimeModelName.toLowerCase();
  if (normalized.includes("1.5b")) {
    return "Qwen/Qwen2.5-1.5B-Instruct";
  }
  if (normalized.includes("3b")) {
    return "Qwen/Qwen2.5-3B-Instruct";
  }
  if (normalized.includes("7b")) {
    return "Qwen/Qwen2.5-7B-Instruct";
  }
  return "Qwen/Qwen2.5-3B-Instruct";
}

function normalizeServedModelName(value: string) {
  return value
    .replace(/[:/\\]/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}

function defaultSuggestedServedModelName(runtimeModelName: string, candidateVariantId: string) {
  const runtime = normalizeServedModelName(runtimeModelName);
  const candidate = normalizeServedModelName(candidateVariantId);

  if (runtime.toLowerCase().startsWith("student-local-")) {
    return candidate;
  }

  return `${runtime}-${candidate}`.slice(0, 160);
}

export class LocalStudentTrainingRequestService {
  build(args: BuildLocalStudentTrainingRequestArgs = {}): LocalStudentTrainingRequest {
    const baseVariantId = args.baseVariantId ?? "student-local-base";
    const candidateVariantId = args.candidateVariantId ?? "student-local-lora-v1";
    const runtimeModelName = args.runtimeModelName ?? env.LOCAL_MODEL_NAME;
    const trainingBaseModel = args.trainingBaseModel ?? defaultTrainingBaseModel(runtimeModelName);
    const executionRecipe = args.executionRecipe ?? "qlora_4bit";
    const trainFile = args.trainFile ? resolve(args.trainFile) : defaultTrainFile();
    const outputDir = args.outputDir ? resolve(args.outputDir) : defaultOutputDir(candidateVariantId);
    const epochs = args.epochs ?? 1;
    const learningRate = args.learningRate ?? 2e-4;
    const perDeviceTrainBatchSize = args.perDeviceTrainBatchSize ?? 1;
    const gradientAccumulationSteps = args.gradientAccumulationSteps ?? 16;
    const maxSeqLength = args.maxSeqLength ?? 1536;
    const suggestedServedModelName = defaultSuggestedServedModelName(runtimeModelName, candidateVariantId);

    const command = [
      "python scripts/train_lora.py",
      `--base_model ${JSON.stringify(trainingBaseModel)}`,
      `--train_file ${JSON.stringify(trainFile)}`,
      `--output_dir ${JSON.stringify(outputDir)}`,
      `--num_train_epochs ${epochs}`,
      `--learning_rate ${learningRate}`,
      `--per_device_train_batch_size ${perDeviceTrainBatchSize}`,
      `--gradient_accumulation_steps ${gradientAccumulationSteps}`,
      `--max_seq_length ${maxSeqLength}`,
      ...(executionRecipe === "qlora_4bit" ? ["--load_in_4bit"] : []),
      "--gradient_checkpointing",
      "--lora_r 16",
      "--lora_alpha 32",
      "--lora_dropout 0.05"
    ].join(" ");

    return localStudentTrainingRequestSchema.parse({
      version: "hydria-local-student-training-request-v1",
      createdAt: new Date().toISOString(),
      baseVariantId,
      candidateVariantId,
      baseModelName: runtimeModelName,
      trainingBaseModel,
      suggestedServedModelName,
      trainFile,
      outputDir,
      method: "lora_sft",
      executionRecipe,
      epochs,
      learningRate,
      perDeviceTrainBatchSize,
      gradientAccumulationSteps,
      maxSeqLength,
      loadIn4Bit: executionRecipe === "qlora_4bit",
      loraR: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
      command,
      executorBoundary: "external",
      note: "Hydria Core prepares the supervised LoRA run but does not execute it directly."
    });
  }

  async buildAndPersist(
    args: BuildLocalStudentTrainingRequestArgs = {}
  ): Promise<{ request: LocalStudentTrainingRequest; outputFile: string }> {
    const request = this.build(args);
    const outputFile = args.outputFile
      ? resolve(args.outputFile)
      : defaultOutputFile(request.candidateVariantId);

    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, `${JSON.stringify(request, null, 2)}\n`, "utf8");

    return { request, outputFile };
  }
}

export type { BuildLocalStudentTrainingRequestArgs };

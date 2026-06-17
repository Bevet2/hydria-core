/**
 * runLocalStudentFinetune.ts
 *
 * End-to-end orchestrator for local student LoRA fine-tuning.
 *
 * Steps:
 *   1. Check Python + CUDA environment
 *   2. Merge the SFT datasets (v1 base + v12 stable-knowledge) into a combined training file
 *   3. Generate a training request (hyperparams based on detected GPU)
 *   4. Run scripts/train_lora.py
 *   5. Run scripts/merge_lora.py (merge adapter + write Modelfile)
 *   6. Run `ollama create` to register the new model
 *   7. Register the variant in the Hydria database
 *
 * Options:
 *   --dry-run          Check env and prepare datasets only, skip actual training
 *   --skip-merge       Skip the merge/GGUF step (useful if ollama supports adapters directly)
 *   --llama-cpp-dir    Path to llama.cpp for GGUF conversion
 *   --candidate-id     Variant ID to register (default: student-local-lora-v1)
 */

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { projectRoot } from "../utils/env.js";
import { LocalStudentTrainingEnvService } from "../services/training/localStudentTrainingEnvService.js";
import { LocalStudentTrainingRequestService } from "../services/training/localStudentTrainingRequestService.js";
import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";

const execFile = promisify(execFileCallback);

// ─── CLI args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const skipMerge = argv.includes("--skip-merge");
const llamaCppDir = argv.find((a) => a.startsWith("--llama-cpp-dir="))?.split("=")[1] ?? null;
const candidateId = argv.find((a) => a.startsWith("--candidate-id="))?.split("=")[1] ?? "student-local-lora-v1";

// ─── Paths ───────────────────────────────────────────────────────────────────

const datasetsDir = join(projectRoot, "storage", "datasets");
const trainingDir = join(projectRoot, "storage", "training");
const outputsDir = join(projectRoot, "outputs", candidateId);
const mergedDir = join(outputsDir, "merged");

const combinedDatasetPath = join(trainingDir, `${candidateId}-combined-sft.jsonl`);
const modelfilePath = join(mergedDir, "Modelfile");
const mergeReportPath = join(outputsDir, "merge-report.json");
const trainReportPath = join(outputsDir, "train-report.json");

const TRAIN_DATASETS = [
  join(datasetsDir, "student-local-sft-v1.jsonl"),
  join(datasetsDir, "student-local-sft-v12-stable-knowledge.jsonl"),
  join(datasetsDir, "student-local-sft-v11-light-multiturn-first-pass.jsonl"),
  join(datasetsDir, "student-local-sft-v10-light-language-stability.jsonl"),
];

// ─── Utilities ───────────────────────────────────────────────────────────────

function log(stage: string, message: string) {
  console.log(`[finetune:${stage}] ${message}`);
}

function warn(stage: string, message: string) {
  console.warn(`[finetune:${stage}] WARN: ${message}`);
}

async function runPython(args: string[], timeoutMs = 1_800_000) {
  const pythonCmds = ["python", "py"];
  for (const cmd of pythonCmds) {
    try {
      const { stdout, stderr } = await execFile(cmd, args, {
        windowsHide: true,
        timeout: timeoutMs
      });
      if (stderr) process.stderr.write(stderr);
      return stdout;
    } catch (err: unknown) {
      const msg = String((err as { message?: string }).message ?? err);
      if (msg.includes("ENOENT") || msg.includes("not found")) continue;
      throw err;
    }
  }
  throw new Error("Python not found. Install Python 3.10+ and try again.");
}

// ─── Steps ───────────────────────────────────────────────────────────────────

async function step1CheckEnv() {
  log("env", "Checking Python + CUDA environment...");
  const service = new LocalStudentTrainingEnvService();
  const report = await service.check();

  log("env", `Readiness: ${report.readiness}`);
  log("env", `GPU: ${report.gpuName ?? "none"} | VRAM: ${report.gpuMemoryGb ?? "?"} GB`);
  log("env", `CUDA: ${report.cudaAvailable ? "yes" : "no"} | Torch: ${report.torchVersion ?? "missing"}`);
  log("env", `Recommended method: ${report.recommendedMethod} | Model: ${report.recommendedTrainingBaseModel}`);
  for (const note of report.notes) log("env", `  ↳ ${note}`);

  if (report.readiness === "unsupported") {
    throw new Error(
      "Training environment is unsupported. A CUDA GPU with ≥6 GB VRAM is required for LoRA fine-tuning.\n" +
      report.notes.join("\n")
    );
  }

  if (report.readiness === "needs_setup") {
    const missing = report.missingPackages.join(", ");
    throw new Error(
      `Training environment needs setup. Missing: ${missing}\n` +
      `Install with: pip install ${missing}\n` +
      report.notes.join("\n")
    );
  }

  return report;
}

async function step2CombineDatasets() {
  log("dataset", "Combining SFT datasets...");
  await mkdir(trainingDir, { recursive: true });

  let totalLines = 0;
  const lines: string[] = [];

  for (const datasetPath of TRAIN_DATASETS) {
    if (!existsSync(datasetPath)) {
      warn("dataset", `Dataset not found, skipping: ${datasetPath}`);
      continue;
    }
    const content = await readFile(datasetPath, "utf8");
    const datasetLines = content.split("\n").filter((l) => l.trim());
    lines.push(...datasetLines);
    totalLines += datasetLines.length;
    log("dataset", `  + ${datasetPath.split(/[\\/]/).pop()} → ${datasetLines.length} examples`);
  }

  if (lines.length === 0) {
    throw new Error("No training examples found across all dataset files.");
  }

  await writeFile(combinedDatasetPath, lines.join("\n") + "\n", "utf8");
  log("dataset", `Combined dataset: ${totalLines} examples → ${combinedDatasetPath}`);
  return totalLines;
}

async function step3BuildRequest(envReport: Awaited<ReturnType<LocalStudentTrainingEnvService["check"]>>) {
  log("request", "Building training request...");
  const service = new LocalStudentTrainingRequestService();
  const { request, outputFile } = await service.buildAndPersist({
    candidateVariantId: candidateId,
    runtimeModelName: envReport.recommendedRuntimeModelName,
    trainingBaseModel: envReport.recommendedTrainingBaseModel,
    executionRecipe: envReport.recommendedMethod === "lora_full" ? "lora_full" : "qlora_4bit",
    trainFile: combinedDatasetPath,
    outputDir: outputsDir,
    perDeviceTrainBatchSize: envReport.recommendedPerDeviceTrainBatchSize ?? 1,
    gradientAccumulationSteps: envReport.recommendedGradientAccumulationSteps ?? 16,
    maxSeqLength: envReport.recommendedMaxSeqLength ?? 1536,
  });
  log("request", `Request written to ${outputFile}`);
  log("request", `Command: ${request.command}`);
  return request;
}

async function step4Train(request: Awaited<ReturnType<LocalStudentTrainingRequestService["build"]>>) {
  log("train", `Starting LoRA training: ${request.trainingBaseModel}`);
  log("train", `Dataset: ${request.trainFile}`);
  log("train", `Output: ${request.outputDir}`);
  log("train", "This may take 20-90 minutes depending on GPU speed...");

  await mkdir(outputsDir, { recursive: true });

  const pythonArgs = [
    "scripts/train_lora.py",
    "--base_model", request.trainingBaseModel,
    "--train_file", request.trainFile,
    "--output_dir", request.outputDir,
    "--num_train_epochs", String(request.epochs),
    "--learning_rate", String(request.learningRate),
    "--per_device_train_batch_size", String(request.perDeviceTrainBatchSize),
    "--gradient_accumulation_steps", String(request.gradientAccumulationSteps),
    "--max_seq_length", String(request.maxSeqLength),
    "--lora_r", String(request.loraR),
    "--lora_alpha", String(request.loraAlpha),
    "--lora_dropout", String(request.loraDropout),
    "--gradient_checkpointing",
    "--expand_weighted_samples",
    "--report_file", trainReportPath,
    ...(request.loadIn4Bit ? ["--load_in_4bit"] : []),
  ];

  const stdout = await runPython(pythonArgs, 5_400_000); // 90 min timeout
  process.stdout.write(stdout);

  // Read report
  if (existsSync(trainReportPath)) {
    const reportRaw = await readFile(trainReportPath, "utf8");
    const report = JSON.parse(reportRaw) as { trainLoss?: number; globalSteps?: number };
    log("train", `Training complete — loss: ${report.trainLoss?.toFixed(4) ?? "?"}, steps: ${report.globalSteps ?? "?"}`);
  } else {
    log("train", "Training complete (no report file found)");
  }
}

async function step5Merge(
  request: Awaited<ReturnType<LocalStudentTrainingRequestService["build"]>>,
  ollamaModelName: string
) {
  if (skipMerge) {
    log("merge", "Skipping merge step (--skip-merge)");
    return null;
  }

  log("merge", "Merging LoRA adapter into base model...");
  await mkdir(mergedDir, { recursive: true });

  const pythonArgs = [
    "scripts/merge_lora.py",
    "--base_model", request.trainingBaseModel,
    "--adapter_path", request.outputDir,
    "--merged_output_dir", mergedDir,
    "--modelfile_path", modelfilePath,
    "--ollama_model_name", ollamaModelName,
    "--report_file", mergeReportPath,
    ...(llamaCppDir ? ["--llama_cpp_dir", llamaCppDir, "--gguf_output_path", join(mergedDir, "model.gguf")] : []),
  ];

  const stdout = await runPython(pythonArgs, 1_800_000); // 30 min
  process.stdout.write(stdout);

  return modelfilePath;
}

async function step6OllamaCreate(ollamaModelName: string) {
  if (!existsSync(modelfilePath)) {
    warn("ollama", `Modelfile not found at ${modelfilePath} — skipping ollama create`);
    return false;
  }

  // Check if the Modelfile FROM line is commented out (GGUF not yet available)
  const modelfileContent = await readFile(modelfilePath, "utf8");
  if (modelfileContent.includes("# FROM")) {
    warn("ollama", "Modelfile has a commented FROM line — GGUF conversion is still needed.");
    log("ollama", `Complete the GGUF conversion and then run:\n  ollama create ${ollamaModelName} -f "${modelfilePath}"`);
    return false;
  }

  log("ollama", `Running: ollama create ${ollamaModelName} -f "${modelfilePath}"`);
  try {
    const { stdout, stderr } = await execFile(
      "ollama",
      ["create", ollamaModelName, "-f", modelfilePath],
      { windowsHide: true, timeout: 300_000 }
    );
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    log("ollama", `Model registered: ${ollamaModelName}`);
    return true;
  } catch (err) {
    warn("ollama", `ollama create failed: ${String(err)}\nYou can run it manually:\n  ollama create ${ollamaModelName} -f "${modelfilePath}"`);
    return false;
  }
}

async function step7RegisterVariant(ollamaModelName: string, ollamaReady: boolean) {
  log("registry", `Registering variant: ${candidateId}`);
  const registry = new LocalStudentVariantRegistry();
  const variant = await registry.registerVariant({
    id: candidateId,
    name: `Hydria Student LoRA ${new Date().toISOString().slice(0, 10)}`,
    description: `LoRA fine-tuned student variant from combined SFT datasets (v1 + v12). Training: 1 epoch QLoRA on ${ollamaModelName}.`,
    servedModelName: ollamaModelName,
    adapterPath: outputsDir,
    state: "candidate",
    notes: [
      `Training output: ${outputsDir}`,
      `Modelfile: ${modelfilePath}`,
      ollamaReady ? "Registered in Ollama — ready for A/B comparison." : "GGUF conversion pending — run ollama create manually.",
    ],
  });
  log("registry", `Variant registered: ${variant.id} (state: ${variant.state})`);
  return variant;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log("start", `Hydria local student fine-tuning | candidate: ${candidateId} | dry-run: ${dryRun}`);

  const envReport = await step1CheckEnv();
  const totalExamples = await step2CombineDatasets();
  const request = await step3BuildRequest(envReport);

  if (dryRun) {
    log("dry-run", `Environment ready. Dataset: ${totalExamples} examples.`);
    log("dry-run", `Training command: ${request.command}`);
    log("dry-run", "Re-run without --dry-run to execute training.");
    return;
  }

  await step4Train(request);

  const ollamaModelName = request.suggestedServedModelName;
  await step5Merge(request, ollamaModelName);
  const ollamaReady = await step6OllamaCreate(ollamaModelName);
  await step7RegisterVariant(ollamaModelName, ollamaReady);

  log("done", "Fine-tuning pipeline complete.");
  if (ollamaReady) {
    log("done", `Run A/B comparison: npm run student:variant-ab`);
  } else {
    log("done", `Complete the Ollama registration, then run: npm run student:variant-ab`);
  }
}

main().catch((err) => {
  console.error("[finetune] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

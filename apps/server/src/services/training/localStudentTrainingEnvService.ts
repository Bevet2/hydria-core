import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  localStudentTrainingEnvironmentReportSchema,
  type LocalStudentTrainingEnvironmentReport,
  type LocalStudentTrainingPackageStatus
} from "../../types/training.js";
import { env } from "../../utils/env.js";

const execFile = promisify(execFileCallback);

type PythonProbeResult = {
  pythonVersion: string | null;
  torchVersion: string | null;
  cudaAvailable: boolean;
  packageStatus: LocalStudentTrainingPackageStatus;
};

type OllamaProbeResult = {
  runtimeModelInstalled: boolean;
};

type TrainingEnvSignals = {
  pythonVersion: string | null;
  torchVersion: string | null;
  cudaAvailable: boolean;
  gpuName: string | null;
  gpuMemoryGb: number | null;
  runtimeModelInstalled: boolean;
  packageStatus: LocalStudentTrainingPackageStatus;
  platform?: string;
};

const DEFAULT_PACKAGE_STATUS: LocalStudentTrainingPackageStatus = {
  torch: false,
  transformers: false,
  peft: false,
  datasets: false,
  accelerate: false,
  bitsandbytes: false
};

const PYTHON_PROBE = [
  "import importlib.util, json, sys",
  "names = ['torch','transformers','peft','datasets','accelerate','bitsandbytes']",
  "status = {name: importlib.util.find_spec(name) is not None for name in names}",
  "torch_version = None",
  "cuda_available = False",
  "if status['torch']: import torch; torch_version = getattr(torch, '__version__', None); cuda_available = bool(torch.cuda.is_available())",
  "print(json.dumps({'pythonVersion': sys.version.splitlines()[0], 'torchVersion': torch_version, 'cudaAvailable': cuda_available, 'packageStatus': status}))"
].join("\n");

export class LocalStudentTrainingEnvService {
  async check(): Promise<LocalStudentTrainingEnvironmentReport> {
    const python = await this.probePython();
    const gpu = await this.probeGpu();
    const ollama = await this.probeOllama();
    return LocalStudentTrainingEnvService.recommendFromSignals({
      pythonVersion: python.pythonVersion,
      torchVersion: python.torchVersion,
      cudaAvailable: python.cudaAvailable,
      gpuName: gpu.gpuName,
      gpuMemoryGb: gpu.gpuMemoryGb,
      runtimeModelInstalled: ollama.runtimeModelInstalled,
      packageStatus: python.packageStatus,
      platform: process.platform
    });
  }

  private async probePython(): Promise<PythonProbeResult> {
    const tempDir = await mkdtemp(join(tmpdir(), "hydria-python-probe-"));
    const scriptPath = join(tempDir, "probe.py");
    await writeFile(scriptPath, `${PYTHON_PROBE}\n`, "utf8");

    try {
      for (const [command, args] of [
        ["python", [scriptPath]],
        ["py", ["-3.10", scriptPath]],
        ["py", ["-3", scriptPath]]
      ] as const) {
        try {
          const { stdout } = await execFile(command, [...args], {
            windowsHide: true,
            timeout: 30_000
          });
          const parsed = JSON.parse(stdout) as PythonProbeResult;
          return {
            pythonVersion: parsed.pythonVersion ?? null,
            torchVersion: parsed.torchVersion ?? null,
            cudaAvailable: Boolean(parsed.cudaAvailable),
            packageStatus: {
              ...DEFAULT_PACKAGE_STATUS,
              ...parsed.packageStatus
            }
          };
        } catch {
          continue;
        }
      }

      return {
        pythonVersion: null,
        torchVersion: null,
        cudaAvailable: false,
        packageStatus: DEFAULT_PACKAGE_STATUS
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async probeGpu(): Promise<{ gpuName: string | null; gpuMemoryGb: number | null }> {
    try {
      const { stdout } = await execFile(
        "nvidia-smi",
        ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
        {
          windowsHide: true,
          timeout: 15_000
        }
      );
      const firstLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (!firstLine) {
        return { gpuName: null, gpuMemoryGb: null };
      }

      const [rawName, rawMemory] = firstLine.split(",").map((part) => part.trim());
      const memoryMiB = Number(rawMemory);
      return {
        gpuName: rawName || null,
        gpuMemoryGb: Number.isFinite(memoryMiB) ? Math.round((memoryMiB / 1024) * 10) / 10 : null
      };
    } catch {
      return { gpuName: null, gpuMemoryGb: null };
    }
  }

  private async probeOllama(): Promise<OllamaProbeResult> {
    try {
      const response = await fetch(`${env.LOCAL_MODEL_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) {
        return { runtimeModelInstalled: false };
      }

      const payload = (await response.json()) as {
        models?: Array<{ name?: string }>;
      };
      const installed = (payload.models ?? [])
        .map((model) => model.name)
        .filter((name): name is string => Boolean(name));
      return {
        runtimeModelInstalled: installed.includes(env.LOCAL_MODEL_NAME)
      };
    } catch {
      return { runtimeModelInstalled: false };
    }
  }

  static recommendFromSignals(signals: TrainingEnvSignals): LocalStudentTrainingEnvironmentReport {
    const checkedAt = new Date().toISOString();
    const missingPackages = Object.entries(signals.packageStatus)
      .filter(([, installed]) => !installed)
      .map(([name]) => name);
    const platform = signals.platform ?? process.platform;

    let recommendedMethod: LocalStudentTrainingEnvironmentReport["recommendedMethod"] = "none";
    let recommendedRuntimeModelName = env.LOCAL_MODEL_NAME;
    let recommendedTrainingBaseModel = "Qwen/Qwen2.5-1.5B-Instruct";
    let recommendedVariantId = "student-local-base-1p5b";
    let recommendedCandidateVariantId = "student-local-1p5b-lora-v1";
    let recommendedPerDeviceTrainBatchSize: number | null = null;
    let recommendedGradientAccumulationSteps: number | null = null;
    let recommendedMaxSeqLength: number | null = null;
    let readiness: LocalStudentTrainingEnvironmentReport["readiness"] = "unsupported";
    const notes: string[] = [];

    const gpuMemoryGb = signals.gpuMemoryGb ?? 0;
    if (!signals.gpuName || gpuMemoryGb < 6) {
      readiness = "unsupported";
      notes.push("A CUDA GPU with at least 6 GB VRAM is recommended for a short local LoRA run.");
    } else if (gpuMemoryGb < 10) {
      recommendedRuntimeModelName = "qwen2.5:1.5b";
      recommendedTrainingBaseModel = "Qwen/Qwen2.5-1.5B-Instruct";
      recommendedVariantId = "student-local-base-1p5b";
      recommendedCandidateVariantId = "student-local-1p5b-lora-v1";
      recommendedPerDeviceTrainBatchSize = 1;
      if (platform === "win32") {
        recommendedMethod = "lora_full";
        recommendedGradientAccumulationSteps = 8;
        recommendedMaxSeqLength = 1024;
        notes.push(
          "On Windows with 8 GB VRAM, a short 1.5B full LoRA with gradient checkpointing is currently more reliable than 4-bit QLoRA."
        );
      } else {
        recommendedMethod = "qlora_4bit";
        recommendedGradientAccumulationSteps = 16;
        recommendedMaxSeqLength = 1536;
        notes.push("8 GB VRAM is better suited to a short 1.5B QLoRA than to a 7B adapter run.");
      }
    } else if (gpuMemoryGb < 14) {
      recommendedMethod = "qlora_4bit";
      recommendedRuntimeModelName = "qwen2.5:3b";
      recommendedTrainingBaseModel = "Qwen/Qwen2.5-3B-Instruct";
      recommendedVariantId = "student-local-base-3b";
      recommendedCandidateVariantId = "student-local-3b-lora-v1";
      recommendedPerDeviceTrainBatchSize = 1;
      recommendedGradientAccumulationSteps = 12;
      recommendedMaxSeqLength = 2048;
      notes.push("This machine can plausibly run a short 3B QLoRA, but 7B remains risky.");
    } else {
      recommendedMethod = "qlora_4bit";
      recommendedRuntimeModelName = "qwen2.5:7b";
      recommendedTrainingBaseModel = "Qwen/Qwen2.5-7B-Instruct";
      recommendedVariantId = "student-local-base";
      recommendedCandidateVariantId = "student-local-lora-v1";
      recommendedPerDeviceTrainBatchSize = 1;
      recommendedGradientAccumulationSteps = 8;
      recommendedMaxSeqLength = 2048;
      notes.push("This machine has enough VRAM to attempt the governed 7B QLoRA recipe.");
    }

    if (recommendedMethod !== "none") {
      if (!signals.pythonVersion) {
        readiness = "needs_setup";
        notes.push("Python was not detected. Install Python 3.10+ before training.");
      } else if (!signals.cudaAvailable) {
        readiness = "needs_setup";
        notes.push("Torch CUDA is not available yet. Install a CUDA-enabled torch build.");
      } else {
        const requiredForQloRa = ["torch", "transformers", "peft", "datasets", "accelerate", "bitsandbytes"];
        const missingRequired = requiredForQloRa.filter(
          (name) => !signals.packageStatus[name as keyof LocalStudentTrainingPackageStatus]
        );
        if (missingRequired.length > 0) {
          readiness = "needs_setup";
          notes.push(
            `Install the training stack before running LoRA: ${missingRequired.join(", ")}.`
          );
        } else {
          readiness = "ready";
          notes.push("The local training stack appears ready for a short governed LoRA run.");
        }
      }
    }

    if (!signals.runtimeModelInstalled) {
      notes.push(
        `The recommended runtime model ${recommendedRuntimeModelName} is not installed in Ollama yet.`
      );
    }

    return localStudentTrainingEnvironmentReportSchema.parse({
      version: "hydria-local-student-training-env-v1",
      checkedAt,
      pythonVersion: signals.pythonVersion,
      torchVersion: signals.torchVersion,
      cudaAvailable: signals.cudaAvailable,
      gpuName: signals.gpuName,
      gpuMemoryGb: signals.gpuMemoryGb,
      runtimeModelInstalled: signals.runtimeModelInstalled,
      packageStatus: signals.packageStatus,
      missingPackages,
      readiness,
      recommendedMethod,
      recommendedRuntimeModelName,
      recommendedTrainingBaseModel,
      recommendedVariantId,
      recommendedCandidateVariantId,
      recommendedPerDeviceTrainBatchSize,
      recommendedGradientAccumulationSteps,
      recommendedMaxSeqLength,
      notes
    });
  }
}

export type { TrainingEnvSignals };

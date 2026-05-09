import test from "node:test";
import assert from "node:assert/strict";
import { LocalStudentTrainingEnvService } from "../services/training/localStudentTrainingEnvService.js";

test("training env service recommends a 1.5B qlora recipe on an 8 GB GPU", () => {
  const report = LocalStudentTrainingEnvService.recommendFromSignals({
    pythonVersion: "3.10.11",
    torchVersion: "2.7.0",
    cudaAvailable: true,
    gpuName: "NVIDIA GeForce RTX 2070",
    gpuMemoryGb: 8,
    runtimeModelInstalled: false,
    platform: "win32",
    packageStatus: {
      torch: false,
      transformers: false,
      peft: false,
      datasets: false,
      accelerate: false,
      bitsandbytes: false
    }
  });

  assert.equal(report.recommendedMethod, "lora_full");
  assert.equal(report.recommendedRuntimeModelName, "qwen2.5:1.5b");
  assert.equal(report.recommendedTrainingBaseModel, "Qwen/Qwen2.5-1.5B-Instruct");
  assert.equal(report.recommendedVariantId, "student-local-base-1p5b");
  assert.equal(report.recommendedCandidateVariantId, "student-local-1p5b-lora-v1");
  assert.equal(report.readiness, "needs_setup");
});

test("training env service reports ready only when the full qlora stack is present", () => {
  const report = LocalStudentTrainingEnvService.recommendFromSignals({
    pythonVersion: "3.10.11",
    torchVersion: "2.7.0",
    cudaAvailable: true,
    gpuName: "NVIDIA RTX 4090",
    gpuMemoryGb: 24,
    runtimeModelInstalled: true,
    platform: "linux",
    packageStatus: {
      torch: true,
      transformers: true,
      peft: true,
      datasets: true,
      accelerate: true,
      bitsandbytes: true
    }
  });

  assert.equal(report.readiness, "ready");
  assert.equal(report.recommendedRuntimeModelName, "qwen2.5:7b");
  assert.equal(report.recommendedCandidateVariantId, "student-local-lora-v1");
});

import test from "node:test";
import assert from "node:assert/strict";
import { LocalStudentTrainingRequestService } from "../services/training/localStudentTrainingRequestService.js";

test("local student training request service builds a short external LoRA request", () => {
  const service = new LocalStudentTrainingRequestService();
  const request = service.build({
    runtimeModelName: "qwen2.5:1.5b"
  });

  assert.equal(request.method, "lora_sft");
  assert.equal(request.executionRecipe, "qlora_4bit");
  assert.equal(request.epochs, 1);
  assert.equal(request.candidateVariantId, "student-local-lora-v1");
  assert.equal(request.suggestedServedModelName, "qwen2.5-1.5b-student-local-lora-v1");
  assert.equal(request.loadIn4Bit, true);
  assert.match(request.command, /scripts[\\/]+train_lora\.py/);
  assert.match(request.command, /--load_in_4bit/);
  assert.match(request.command, /--gradient_checkpointing/);
  assert.match(request.command, /--num_train_epochs 1/);
  assert.match(request.command, /Qwen\/Qwen2\.5-1\.5B-Instruct/);
  assert.equal(request.executorBoundary, "external");
});

test("local student training request service does not prefix a candidate with the previous student variant", () => {
  const service = new LocalStudentTrainingRequestService();
  const request = service.build({
    runtimeModelName: "student-local-1p5b-toolbench-lora-v9",
    candidateVariantId: "student-local-1p5b-toolbench-lora-v10-light"
  });

  assert.equal(
    request.suggestedServedModelName,
    "student-local-1p5b-toolbench-lora-v10-light"
  );
});

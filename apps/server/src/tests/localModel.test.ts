import test from "node:test";
import assert from "node:assert/strict";
import { LocalModelService } from "../services/localModel.js";

test("local model observation parser repairs array-shaped payloads", () => {
  const service = new LocalModelService();
  const parsed = (service as any).parseLocalObservationResponse(`[
    {
      "modelRole": "local_student",
      "student_answer": "Prefer phased rollout with rollback checkpoints.",
      "student_summary": "The round favors incremental delivery with rollback safety.",
      "learning_notes": ["Keep rollback checkpoints.", "Prefer phased rollout."]
    }
  ]`);

  assert.equal(parsed.parseMode, "repaired");
  assert.equal(parsed.output.modelRole, "local_student");
  assert.match(parsed.output.student_summary, /incremental delivery/i);
  assert.ok(parsed.output.learning_notes.length >= 2);
});

test("local model observation parser derives missing summary and learning notes", () => {
  const service = new LocalModelService();
  const parsed = (service as any).parseLocalObservationResponse(`{
    "student_answer": "Use retries only with idempotency keys and deduplication so repeated work stays safe."
  }`);

  assert.notEqual(parsed.parseMode, "strict");
  assert.equal(parsed.output.modelRole, "local_student");
  assert.match(parsed.output.student_summary, /retries/i);
  assert.ok(parsed.output.learning_notes.length >= 1);
});

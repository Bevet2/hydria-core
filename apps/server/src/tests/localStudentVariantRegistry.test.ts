import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HydriaStateDatabase } from "../services/storage/hydriaStateDatabase.js";
import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";

test("local student variant registry persists and updates governed variants", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-local-variant-"));
  const database = new HydriaStateDatabase(join(tempRoot, "hydria-state.sqlite"));
  const registry = new LocalStudentVariantRegistry(database);

  try {
    const base = await registry.ensureBaseVariant();
    assert.equal(base.id, "student-local-base");

    const candidate = await registry.registerVariant({
      id: "student-local-lora-v1",
      name: "Student Local LoRA v1",
      description: "Candidate variant",
      servedModelName: "qwen2.5-3b-student-local-lora-v1"
    });
    assert.equal(candidate.state, "candidate");

    const active = await registry.updateVariantState("student-local-lora-v1", "active", {
      confidenceScore: 0.78,
      comparisonFile: "comparison.json"
    });
    assert.equal(active?.state, "active");
    assert.equal(active?.confidenceScore, 0.78);

    const listed = await registry.listVariants(["active"]);
    assert.ok(listed.some((entry) => entry.id === "student-local-lora-v1"));
  } finally {
    database.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

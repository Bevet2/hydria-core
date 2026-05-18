import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KnowledgeObjectStore } from "../services/knowledgeObjectStore.js";
import { KnowledgePromotionGovernanceService } from "../services/knowledgePromotionGovernanceService.js";
import type { KnowledgeObject } from "../types/knowledgeObjects.js";

const now = "2026-05-13T10:00:00.000Z";

function object(overrides: Partial<KnowledgeObject>): KnowledgeObject {
  return {
    objectId: "ko::test::base",
    title: "Base object",
    type: "pattern",
    knowledgeClass: "experimental",
    state: "candidate",
    domain: "technical_explanation",
    category: "technical_explanation",
    content: "Use a precise explanation pattern.",
    summary: "Precise explanation pattern.",
    tags: ["test"],
    confidence: 0.7,
    riskLevel: "low",
    evidenceCount: 2,
    sources: [
      {
        sourceType: "interaction_learning",
        sourceId: "interaction::test",
        sourceUri: null,
        evidenceRecordIds: ["11111111-1111-4111-8111-111111111111"]
      }
    ],
    relations: [],
    decay: {
      policy: "standard",
      validFrom: now,
      expiresAt: null,
      rationale: "test"
    },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

async function withService(objects: KnowledgeObject[]) {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-promotion-"));
  const store = new KnowledgeObjectStore(
    join(tempRoot, "knowledge-objects.json"),
    join(tempRoot, "vault")
  );
  await store.save(objects);
  const service = new KnowledgePromotionGovernanceService({
    knowledgeObjectStore: store,
    reportFile: join(tempRoot, "promotion.json"),
    trainingQueueFile: join(tempRoot, "queue.json")
  });

  return { tempRoot, store, service };
}

test("knowledge promotion validates stable candidates but does not activate without non-regression gate", async () => {
  const { tempRoot, service, store } = await withService([
    object({
      objectId: "ko::stable::candidate",
      confidence: 0.72,
      evidenceCount: 2
    })
  ]);

  try {
    const report = await service.evaluateAndPersist({ mode: "apply", validationMode: "none" });
    const stored = await store.load();

    assert.equal(report.gate.passed, true);
    assert.equal(report.sourceStats.validatedPromotionCount, 1);
    assert.equal(report.sourceStats.activePromotionCount, 0);
    assert.equal(stored?.objects[0]?.state, "validated");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("knowledge promotion only activates validated low-risk objects after explicit passed validation", async () => {
  const { tempRoot, service, store } = await withService([
    object({
      objectId: "ko::validated::ready",
      state: "validated",
      confidence: 0.84,
      evidenceCount: 4
    })
  ]);

  try {
    const report = await service.evaluateAndPersist({ mode: "apply", validationMode: "passed" });
    const stored = await store.load();

    assert.equal(report.gate.passed, true);
    assert.equal(report.sourceStats.activePromotionCount, 1);
    assert.equal(report.sourceStats.appliedChangeCount, 1);
    assert.equal(stored?.objects[0]?.state, "active");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("knowledge promotion blocks dynamic watcher candidates and queues repair signals", async () => {
  const { tempRoot, service, store } = await withService([
    object({
      objectId: "ko::watcher::dynamic",
      title: "AI model release watcher",
      type: "fact",
      knowledgeClass: "dynamic",
      state: "candidate",
      domain: "ai",
      category: "technical_explanation",
      confidence: 0.42,
      evidenceCount: 0,
      tags: ["watcher", "external-watcher", "source-pack", "live"],
      sources: [
        {
          sourceType: "watcher",
          sourceId: "watcher-candidate::external",
          sourceUri: "storage/learning/hydria-watchers-v1.json",
          evidenceRecordIds: []
        }
      ],
      decay: {
        policy: "fast",
        validFrom: now,
        expiresAt: null,
        rationale: "dynamic"
      }
    }),
    object({
      objectId: "ko::watcher::repair",
      title: "Repair signal",
      type: "failure_pattern",
      knowledgeClass: "guarded",
      state: "guarded",
      domain: "technical_explanation",
      confidence: 0.65,
      riskLevel: "high",
      evidenceCount: 3,
      sources: [
        {
          sourceType: "watcher",
          sourceId: "watcher-candidate::repair",
          sourceUri: "storage/learning/hydria-watchers-v1.json",
          evidenceRecordIds: ["22222222-2222-4222-8222-222222222222"]
        }
      ]
    })
  ]);

  try {
    const report = await service.evaluateAndPersist({ mode: "dry_run", validationMode: "passed" });
    const queue = await service.loadTrainingQueue();
    const stored = await store.load();

    assert.equal(report.sourceStats.blockedCount, 1);
    assert.equal(report.sourceStats.trainingCandidateCount, 1);
    assert.equal(queue?.sourceStats.readyCount, 1);
    assert.equal(queue?.sourceStats.blockedCount, 1);
    assert.equal(
      queue?.items.find((item) => item.sourceObjectId === "ko::watcher::dynamic")?.target,
      "retrieval_knowledge"
    );
    assert.equal(stored?.objects.find((entry) => entry.objectId === "ko::watcher::dynamic")?.state, "candidate");
    assert.ok(
      report.decisions
        .find((decision) => decision.objectId === "ko::watcher::dynamic")
        ?.blockers.includes("dynamic_knowledge_needs_refresh_before_activation")
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

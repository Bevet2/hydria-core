import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExternalKnowledgeExpansionWatcher } from "../services/watchers/externalKnowledgeExpansionWatcher.js";
import { InternalGapWatcher } from "../services/watchers/internalGapWatcher.js";
import { WatcherKernel } from "../services/watchers/watcherKernel.js";
import { WatcherStore } from "../services/watchers/watcherStore.js";
import type { InteractionLearningDigest } from "../types/interactionLearning.js";

function buildDigest(): InteractionLearningDigest {
  return {
    version: "hydria-interaction-learning-v1",
    generatedAt: "2026-05-13T10:00:00.000Z",
    sourceStats: {
      recordsAnalyzed: 3,
      completedRecords: 2,
      acceptedRecords: 0,
      failedRecords: 1,
      answeredRecords: 2,
      qualityPassedRecords: 2,
      qualityFailedRecords: 1,
      byScope: {
        chat_turn: 2,
        benchmark_prompt: 1
      },
      bySource: {
        chat: 2,
        benchmark: 1
      }
    },
    candidates: [
      {
        candidateId: "interaction::repair-context-loss",
        kind: "repair_signal",
        state: "guarded",
        source: "chat",
        scope: "chat_turn",
        mode: "chat",
        category: "mixed_reasoning",
        learned: "Reduce recurring context loss before promotion.",
        conditions: ["issue:context_loss", "source:chat"],
        evidenceRecordIds: ["11111111-1111-4111-8111-111111111111"],
        evidenceCount: 3,
        confidence: 0.68,
        riskLevel: "high",
        recommendedAction: "Improve runtime context injection before training.",
        createdAt: "2026-05-13T10:00:00.000Z"
      },
      {
        candidateId: "interaction::answer-pattern",
        kind: "answer_pattern",
        state: "validating",
        source: "chat",
        scope: "chat_turn",
        mode: "chat",
        category: "technical_explanation",
        learned: "Use concise explanation patterns only when category matches.",
        conditions: ["source:chat"],
        evidenceRecordIds: ["22222222-2222-4222-8222-222222222222"],
        evidenceCount: 2,
        confidence: 0.7,
        riskLevel: "medium",
        recommendedAction: "Use as weak guidance.",
        createdAt: "2026-05-13T10:01:00.000Z"
      }
    ],
    activeHints: []
  };
}

test("internal watcher turns repair signals into guarded control candidates", async () => {
  const watcher = new InternalGapWatcher({
    interactionLearningDigestService: {
      async load() {
        return buildDigest();
      },
      async buildAndPersist() {
        return buildDigest();
      }
    },
    knowledgeObjectStore: {
      async load() {
        return null;
      }
    }
  });

  const run = await watcher.run();

  assert.equal(run.status, "completed");
  assert.equal(run.watcherKind, "internal");
  assert.ok(run.findings.some((finding) => finding.type === "quality_gap"));
  assert.ok(run.candidates.some((candidate) => candidate.candidateType === "gap_repair"));
  assert.ok(run.candidates.every((candidate) => candidate.state !== "active"));
  assert.ok(run.acquisitionTasks.some((task) => task.taskType === "repair_gap"));
});

test("external watcher emits source-plan candidates without network access", async () => {
  const watcher = new ExternalKnowledgeExpansionWatcher({ networkEnabled: false });
  const run = await watcher.run();

  assert.equal(run.status, "completed");
  assert.equal(run.watcherKind, "external");
  assert.equal(run.dryRun, true);
  assert.ok(run.candidates.length >= 4);
  assert.ok(run.candidates.some((candidate) => candidate.freshness === "live"));
  assert.ok(run.candidates.every((candidate) => candidate.state === "candidate"));
  assert.ok(run.acquisitionTasks.some((task) => task.taskType === "collect_sources"));
});

test("watcher kernel persists internal and external runs", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-watchers-"));
  try {
    const store = new WatcherStore(join(tempRoot, "watchers.json"));
    const kernel = new WatcherKernel({
      store,
      internalWatcher: new InternalGapWatcher({
        interactionLearningDigestService: {
          async load() {
            return buildDigest();
          },
          async buildAndPersist() {
            return buildDigest();
          }
        },
        knowledgeObjectStore: {
          async load() {
            return null;
          }
        }
      }),
      externalWatcher: new ExternalKnowledgeExpansionWatcher({ networkEnabled: false })
    });

    const result = await kernel.run({ scope: "all" });
    const persisted = await store.load();

    assert.equal(result.runs.length, 2);
    assert.equal(persisted?.version, "hydria-watchers-v1");
    assert.equal(persisted?.sourceStats.runCount, 2);
    assert.ok((persisted?.sourceStats.candidateCount ?? 0) >= 5);
    assert.ok((persisted?.sourceStats.acquisitionTaskCount ?? 0) >= 5);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

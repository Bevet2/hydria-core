import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KnowledgeConsolidationService } from "../services/knowledgeConsolidationService.js";
import { KnowledgeObjectStore } from "../services/knowledgeObjectStore.js";
import type { InteractionLearningDigest } from "../types/interactionLearning.js";

function buildDigest(): InteractionLearningDigest {
  return {
    version: "hydria-interaction-learning-v1",
    generatedAt: "2026-05-13T10:00:00.000Z",
    sourceStats: {
      recordsAnalyzed: 3,
      completedRecords: 3,
      acceptedRecords: 0,
      failedRecords: 0,
      answeredRecords: 3,
      qualityPassedRecords: 3,
      qualityFailedRecords: 0,
      byScope: {
        chat_turn: 1,
        benchmark_prompt: 1,
        student_analysis: 1
      },
      bySource: {
        chat: 1,
        benchmark: 1,
        student_lab: 1
      }
    },
    candidates: [
      {
        candidateId: "interaction::chat-pattern",
        kind: "answer_pattern",
        state: "active",
        source: "chat",
        scope: "chat_turn",
        mode: "chat",
        category: "technical_explanation",
        learned: "Reuse concise explanation patterns only when category and source match.",
        conditions: ["source:chat", "category:technical_explanation"],
        evidenceRecordIds: ["11111111-1111-4111-8111-111111111111"],
        evidenceCount: 4,
        confidence: 0.88,
        riskLevel: "medium",
        recommendedAction: "Use as weak contextual guidance only.",
        createdAt: "2026-05-13T10:00:00.000Z"
      },
      {
        candidateId: "interaction::tool-signal",
        kind: "tool_routing_signal",
        state: "validating",
        source: "chat",
        scope: "chat_turn",
        mode: "chat",
        category: "other",
        learned: "Preserve verified calculator results in the answer language.",
        conditions: ["tool_used:true"],
        evidenceRecordIds: ["22222222-2222-4222-8222-222222222222"],
        evidenceCount: 1,
        confidence: 0.8,
        riskLevel: "low",
        recommendedAction: "Use as routing evidence.",
        createdAt: "2026-05-13T10:01:00.000Z"
      }
    ],
    activeHints: []
  };
}

test("knowledge consolidation turns interaction learning into canonical objects and markdown vault", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-objects-"));
  try {
    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    const service = new KnowledgeConsolidationService({
      knowledgeObjectStore: store,
      interactionLearningDigestService: {
        async load() {
          return buildDigest();
        },
        async buildAndPersist() {
          return buildDigest();
        }
      },
      watcherStore: {
        async load() {
          return null;
        }
      }
    });

    const result = await service.buildAndPersist();
    const active = await store.listActive({ category: "technical_explanation" });
    const index = await readFile(join(tempRoot, "vault", "index.md"), "utf8");

    assert.equal(result.file.version, "hydria-knowledge-objects-v1");
    assert.equal(result.file.sourceStats.objectCount, 2);
    assert.ok(result.file.objects.some((object) => object.type === "tool_rule"));
    assert.ok(result.file.objects.some((object) => object.state === "active"));
    assert.equal(active.length, 1);
    assert.match(index, /Hydria Knowledge Vault/);
    assert.match(index, /ko-interaction/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("knowledge consolidation keeps watcher candidates governed and non-active", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-watcher-objects-"));
  try {
    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    const service = new KnowledgeConsolidationService({
      knowledgeObjectStore: store,
      interactionLearningDigestService: {
        async load() {
          return buildDigest();
        },
        async buildAndPersist() {
          return buildDigest();
        }
      },
      watcherStore: {
        async load() {
          return {
            version: "hydria-watchers-v1",
            generatedAt: "2026-05-13T11:00:00.000Z",
            sourceStats: {
              runCount: 1,
              findingCount: 1,
              candidateCount: 1,
              acquisitionTaskCount: 1,
              activeCandidateCount: 0,
              guardedCandidateCount: 0,
              byWatcher: {
                "external-knowledge-expansion-v1": 1
              },
              byKind: {
                external: 1
              }
            },
            runs: [],
            findings: [],
            candidates: [
              {
                candidateId: "watcher-candidate::external::ai-release-watch",
                watcherId: "external-knowledge-expansion-v1",
                watcherKind: "external",
                candidateType: "trend_signal",
                state: "candidate",
                domain: "ai",
                category: "technical_explanation",
                title: "AI model release watcher",
                claim: "Track current open-weight model releases before treating new model capabilities as known.",
                summary: "Hydria should acquire fresh model release knowledge from authoritative source streams.",
                sources: [
                  {
                    label: "Hugging Face blog",
                    url: "https://huggingface.co/blog",
                    sourceType: "external_source",
                    retrievedAt: null
                  }
                ],
                evidenceRecordIds: [],
                confidence: 0.42,
                freshness: "live",
                corroborationCount: 0,
                riskLevel: "medium",
                tags: ["external-watcher", "ai"],
                createdAt: "2026-05-13T11:00:00.000Z",
                updatedAt: "2026-05-13T11:00:00.000Z"
              }
            ],
            acquisitionTasks: []
          };
        }
      }
    });

    const result = await service.buildAndPersist();
    const watcherObject = result.file.objects.find((object) => object.sources[0]?.sourceType === "watcher");

    assert.ok(watcherObject);
    assert.equal(watcherObject.state, "candidate");
    assert.equal(watcherObject.knowledgeClass, "dynamic");
    assert.notEqual(watcherObject.state, "active");
    assert.equal(result.watcherState?.sourceStats.candidateCount, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

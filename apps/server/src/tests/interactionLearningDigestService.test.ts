import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InteractionLearningDigestService } from "../services/interactionLearningDigestService.js";
import type { HydriaInteractionRecord } from "../types/interactions.js";

const baseRecord = {
  createdAt: "2026-05-13T10:00:00.000Z",
  mode: "chat",
  status: "completed",
  sessionId: null,
  artifactId: "artifact-1",
  summary: "summary",
  routing: {
    orchestrator: "chat_runtime",
    provider: "ollama",
    model: "qwen2.5:3b",
    category: "technical_explanation",
    toolUsed: false
  },
  quality: {
    passed: true,
    score: 80,
    issues: []
  },
  durationMs: 100,
  payload: null
} satisfies Omit<HydriaInteractionRecord, "id" | "scope" | "source" | "question" | "answer">;

test("interaction learning digest converts stored interactions into governed candidates", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-interaction-learning-"));
  try {
    const records: HydriaInteractionRecord[] = [
      {
        ...baseRecord,
        id: "11111111-1111-4111-8111-111111111111",
        scope: "chat_turn",
        source: "chat",
        question: "Explique la coherence eventuelle.",
        answer: "La coherence eventuelle signifie que les replicas convergent apres un delai."
      },
      {
        ...baseRecord,
        id: "22222222-2222-4222-8222-222222222222",
        scope: "benchmark_prompt",
        source: "benchmark",
        mode: "benchmark",
        artifactId: "bench-1:prompt-1",
        question: "Explain cache invalidation.",
        answer: "Cache invalidation keeps stale entries from being reused."
      },
      {
        ...baseRecord,
        id: "33333333-3333-4333-8333-333333333333",
        scope: "chat_turn",
        source: "chat",
        question: "Combien font 245 + 389 ?",
        answer: "245 + 389 = 634.",
        routing: {
          ...baseRecord.routing,
          category: "other",
          toolUsed: true
        }
      },
      {
        ...baseRecord,
        id: "44444444-4444-4444-8444-444444444444",
        scope: "student_preview",
        source: "student_lab",
        mode: "student_preview",
        status: "failed",
        question: "Qui est le CEO actuel d'OpenAI ?",
        answer: null,
        quality: {
          passed: false,
          score: null,
          issues: ["tool_required_but_not_used"]
        }
      }
    ];
    const service = new InteractionLearningDigestService({
      outputFile: join(tempRoot, "digest.json"),
      interactionLogStore: {
        async listRecent() {
          return records;
        }
      }
    });

    const digest = await service.buildAndPersist();
    const loaded = await service.load();

    assert.equal(digest.sourceStats.recordsAnalyzed, 4);
    assert.equal(digest.sourceStats.qualityFailedRecords, 1);
    assert.ok(digest.candidates.some((candidate) => candidate.kind === "answer_pattern"));
    assert.ok(digest.candidates.some((candidate) => candidate.kind === "reasoning_example"));
    assert.ok(digest.candidates.some((candidate) => candidate.kind === "tool_routing_signal"));
    assert.ok(digest.candidates.some((candidate) => candidate.kind === "repair_signal"));
    assert.ok(digest.activeHints.some((hint) => /tool result/i.test(hint.hint)));
    assert.equal(loaded?.version, "hydria-interaction-learning-v1");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

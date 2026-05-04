import test from "node:test";
import assert from "node:assert/strict";
import {
  studentContrastiveExampleSchema,
  studentCuratedExampleSchema
} from "../types/knowledge.js";
import { LocalStudentTrainingPackService } from "../services/training/localStudentTrainingPackService.js";
import { buildStudentSessionFixture } from "./testFixtures.js";

function buildCuratedExample(overrides: Record<string, unknown> = {}) {
  return studentCuratedExampleSchema.parse({
    datasetVersion: "hydria-student-curated-v1",
    roundId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    createdAt: "2026-05-04T10:00:00.000Z",
    category: "technical_explanation",
    prompt: "Explain eventual consistency with one practical example.",
    targetAnswer:
      "Eventual consistency means replicas may disagree briefly, but they converge after propagation. A shopping cart replicated across regions can show an old item count for a moment before all replicas catch up.",
    targetSource: "synthesizer",
    preferredWinner: "A",
    globalGain: 14,
    refinedAverageScore: 88,
    researchUsed: true,
    selectionScore: 91,
    selectionTier: "gold",
    coachingNotes: ["Add one practical example."],
    winningPatterns: ["Concrete example"],
    antiPatterns: ["Too abstract"],
    strategyNote: "Prefer concise but grounded explanations.",
    ...overrides
  });
}

function buildContrastiveExample(overrides: Record<string, unknown> = {}) {
  return studentContrastiveExampleSchema.parse({
    datasetVersion: "hydria-student-contrast-v1",
    roundId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    createdAt: "2026-05-04T10:00:00.000Z",
    category: "technical_explanation",
    prompt: "Explain eventual consistency with one practical example.",
    sourceAnswer: "It means data is eventually the same everywhere.",
    sourceSource: "initial_A",
    targetAnswer:
      "Eventual consistency means replicas can diverge briefly but converge after propagation, such as a multi-region shopping cart that synchronizes after a short delay.",
    targetSource: "synthesizer",
    preferredWinner: "A",
    globalGain: 11,
    improvedDelta: 16,
    researchUsed: false,
    selectionScore: 82,
    selectionTier: "silver",
    transformationNotes: ["Add concrete example", "State the delay explicitly"],
    antiPatterns: ["Thin definition"],
    strategyNote: "Prefer example-backed explanations.",
    ...overrides
  });
}

test("training pack keeps strong curated and contrastive examples with meaningful weights", () => {
  const service = new LocalStudentTrainingPackService({
    sessionLoader: async () => []
  });

  const result = service.buildFromData({
    curatedExamples: [buildCuratedExample()],
    contrastiveExamples: [buildContrastiveExample()],
    sessions: []
  });

  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.summary.sourceBreakdown.curated_round, 1);
  assert.equal(result.summary.sourceBreakdown.contrastive_round, 1);
  assert.ok(result.accepted.every((entry) => entry.weight >= 1));
});

test("training pack keeps useful tool-safe student sessions", () => {
  const service = new LocalStudentTrainingPackService({
    sessionLoader: async () => []
  });
  const session = buildStudentSessionFixture({
    question: "What is the weather in Paris today?",
    student: {
      ...buildStudentSessionFixture().student,
      final: {
        ...buildStudentSessionFixture().student.final,
        answer:
          "I need the current weather tool result for Paris to answer accurately. If the tool is unavailable, I should say that the live weather could not be retrieved."
      },
      toolApplied: true
    },
    research: {
      ...buildStudentSessionFixture().research,
      used: true
    },
    tooling: {
      ...buildStudentSessionFixture().tooling,
      toolUsed: true,
      toolImpact: "no_reliable_source",
      toolReason: "Live weather needs a tool-backed lookup."
    }
  });

  const result = service.buildFromData({
    curatedExamples: [],
    contrastiveExamples: [],
    sessions: [session]
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]?.taskType, "tool_safe_answer");
  assert.equal(result.summary.toolSafeExamples, 1);
});

test("training pack rejects weak student sessions instead of polluting the first LoRA pack", () => {
  const service = new LocalStudentTrainingPackService({
    sessionLoader: async () => []
  });
  const weakSession = buildStudentSessionFixture({
    judge: {
      ...buildStudentSessionFixture().judge,
      verdict: "needs_work",
      worthIt: "NO"
    },
    progression: {
      ...buildStudentSessionFixture().progression,
      sessionScore: 52,
      deltaOverall: -4
    }
  });

  const result = service.buildFromData({
    curatedExamples: [],
    contrastiveExamples: [],
    sessions: [weakSession]
  });

  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, "negative_outcome");
});

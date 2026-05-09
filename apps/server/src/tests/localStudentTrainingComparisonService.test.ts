import test from "node:test";
import assert from "node:assert/strict";
import { LocalStudentTrainingComparisonService } from "../services/training/localStudentTrainingComparisonService.js";
import { localStudentTrainingBaselineReportSchema } from "../types/training.js";

function buildBaseline(overrides: Partial<ReturnType<typeof localStudentTrainingBaselineReportSchema.parse>>) {
  return localStudentTrainingBaselineReportSchema.parse({
    version: "hydria-local-student-baseline-v1",
    runId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-05-04T10:00:00.000Z",
    variantId: "student-local-base",
    modelName: "qwen2.5:3b",
    temporalReplay: {
      totalCases: 12,
      queryTypeMatchRate: 100,
      researchUsedRate: 50,
      freshnessSatisfiedRate: 80,
      noReliableSourceRate: 20,
      explicitDateAnchoringRate: 70,
      staleAbstentionRate: 85,
      answerChangedRate: 55,
      averageDurationMs: 1200
    },
    toolRouting: {
      total: 9,
      passed: 9,
      accuracyPct: 100
    },
    stability: {
      total: 4,
      strictCount: 3,
      repairedCount: 1,
      fallbackCount: 0,
      errorCount: 0,
      strictRate: 75,
      repairedRate: 25,
      fallbackRate: 0,
      retryRate: 25,
      averageDurationMs: 450,
      items: []
    },
    live: {
      total: 4,
      completed: 4,
      failed: 0,
      averageSessionScore: 78,
      averageDeltaOverall: 9,
      improvedRate: 75,
      worthItRate: 75,
      toolUsedRate: 50,
      positiveToolImpactRate: 50,
      averageDurationMs: 3200,
      items: []
    },
    ...overrides
  });
}

test("local student training comparison promotes a clearly better variant", () => {
  const service = new LocalStudentTrainingComparisonService({} as any);
  const before = buildBaseline({});
  const after = buildBaseline({
    variantId: "student-local-lora-v1",
    modelName: "qwen2.5-3b-student-local-lora-v1",
    temporalReplay: {
      ...before.temporalReplay,
      explicitDateAnchoringRate: 80,
      staleAbstentionRate: 90
    },
    stability: {
      ...before.stability,
      strictRate: 100,
      strictCount: 4,
      repairedRate: 0,
      repairedCount: 0
    },
    live: {
      ...before.live,
      averageSessionScore: 82,
      averageDeltaOverall: 12,
      improvedRate: 100,
      worthItRate: 100,
      positiveToolImpactRate: 75
    }
  });

  const report = service.compareReports(before, after);
  assert.equal(report.decision.action, "promote");
  assert.ok(report.decision.gainScore > report.decision.regressionScore);
});

test("local student training comparison rejects a regressive variant", () => {
  const service = new LocalStudentTrainingComparisonService({} as any);
  const before = buildBaseline({});
  const after = buildBaseline({
    variantId: "student-local-lora-v1",
    modelName: "qwen2.5-3b-student-local-lora-v1",
    stability: {
      ...before.stability,
      strictRate: 25,
      strictCount: 1,
      fallbackRate: 25,
      fallbackCount: 1
    },
    live: {
      ...before.live,
      averageSessionScore: 70,
      improvedRate: 50
    }
  });

  const report = service.compareReports(before, after);
  assert.equal(report.decision.action, "reject");
});

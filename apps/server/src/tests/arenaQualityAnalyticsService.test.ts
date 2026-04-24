import test from "node:test";
import assert from "node:assert/strict";
import { ArenaQualityAnalyticsService } from "../services/arenaQualityAnalyticsService.js";
import { buildArenaRoundFixture } from "./testFixtures.js";

test("arena quality analytics aggregates partial rounds, degradation reasons, roles, and impact", () => {
  const service = new ArenaQualityAnalyticsService();

  const completedRound = buildArenaRoundFixture({
    roundId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workflow: {
      ...buildArenaRoundFixture().workflow,
      status: "completed",
      degradationReasons: []
    },
    outputs: {
      ...buildArenaRoundFixture().outputs,
      judge: {
        ...buildArenaRoundFixture().outputs.judge,
        winner: "A",
        scores: {
          ...buildArenaRoundFixture().outputs.judge.scores,
          A: {
            ...buildArenaRoundFixture().outputs.judge.scores.A,
            overall: 82
          }
        }
      },
      synthesizer: {
        ...buildArenaRoundFixture().outputs.synthesizer,
        improvements_added: ["rollback checkpoints", "shadow traffic"]
      },
      localStudent: {
        ...buildArenaRoundFixture().outputs.localStudent,
        learning_notes: ["keep rollback gates", "prefer phased rollout"]
      }
    }
  });

  const partialTeacherRound = buildArenaRoundFixture({
    roundId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    workflow: {
      ...buildArenaRoundFixture().workflow,
      status: "partial",
      degradationReasons: [
        {
          code: "critical_role_fallback",
          impact: "quality_degraded",
          role: "teacher",
          summary: "teacher completed through a major fallback path."
        }
      ]
    },
    outputs: {
      ...buildArenaRoundFixture().outputs,
      judge: {
        ...buildArenaRoundFixture().outputs.judge,
        winner: "B",
        scores: {
          ...buildArenaRoundFixture().outputs.judge.scores,
          B: {
            ...buildArenaRoundFixture().outputs.judge.scores.B,
            overall: 66
          }
        }
      },
      synthesizer: {
        ...buildArenaRoundFixture().outputs.synthesizer,
        improvements_added: ["kept safer sequencing"]
      },
      localStudent: {
        ...buildArenaRoundFixture().outputs.localStudent,
        learning_notes: ["fallback still preserved rollback advice"]
      }
    }
  });

  const partialResearchRound = buildArenaRoundFixture({
    roundId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    workflow: {
      ...buildArenaRoundFixture().workflow,
      status: "partial",
      degradationReasons: [
        {
          code: "research_failed",
          impact: "grounding_gap",
          role: "research_verifier",
          summary: "Research failed during acquisition or verification."
        }
      ]
    },
    outputs: {
      ...buildArenaRoundFixture().outputs,
      judge: {
        ...buildArenaRoundFixture().outputs.judge,
        winner: "tie"
      }
    }
  });

  const legacyPartialRound = buildArenaRoundFixture({
    roundId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    workflow: {
      ...buildArenaRoundFixture().workflow,
      status: "partial",
      degradationReasons: [],
      outcome: "Legacy arena round loaded before Hydria workflow metadata was recorded."
    }
  });

  const rescuedRespondentRound = buildArenaRoundFixture({
    roundId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    trace: {
      ...buildArenaRoundFixture().trace,
      respondentA: {
        ...buildArenaRoundFixture().trace.respondentA,
        outcome: "static_fallback",
        note:
          "Respondent A continued through a static structured fallback. Failure class=structured_output; stage=repair_retry; detail=invalid JSON."
      }
    },
    workflow: {
      ...buildArenaRoundFixture().workflow,
      status: "partial",
      degradationReasons: [
        {
          code: "critical_role_fallback",
          impact: "quality_degraded",
          role: "respondent",
          summary: "respondent completed through a major fallback path."
        }
      ]
    }
  });

  const respondentFailures = [
    {
      eventId: "f1f1f1f1-1111-4111-8111-111111111111",
      roundId: "f2f2f2f2-2222-4222-8222-222222222222",
      createdAt: "2026-04-18T11:00:00.000Z",
      category: "architecture_design",
      slot: "B" as const,
      requestedModel: "model-b",
      finalModel: "model-b",
      failureClass: "provider_error" as const,
      failureStage: "fallback" as const,
      attemptsCount: 2,
      validationFailures: 0,
      usedRetry: true,
      usedFallback: true,
      failureMessage: "OpenRouter returned 503",
      note: "All respondent attempts failed."
    }
  ];

  const report = service.buildReport([
    legacyPartialRound,
    partialResearchRound,
    completedRound,
    partialTeacherRound,
    rescuedRespondentRound
  ], respondentFailures);

  assert.equal(report.summary.totalRounds, 5);
  assert.equal(report.summary.completedRounds, 1);
  assert.equal(report.summary.partialRounds, 4);
  assert.equal(report.summary.classifiedPartialRounds, 3);
  assert.equal(report.summary.legacyPartialRounds, 1);
  assert.equal(report.summary.partialRatePct, 80);
  assert.equal(report.summary.classifiedPartialRatePct, 60);
  assert.equal(report.summary.legacyPartialRatePct, 20);
  assert.equal(report.summary.topDegradingRole, "respondent");
  assert.equal(report.topDegradationReasons.length, 3);
  assert.equal(report.topDegradationReasons[0]?.count, 1);
  assert.equal(report.roleBreakdown.length, 3);
  assert.equal(report.roleBreakdown[0]?.role, "respondent");
  assert.equal(report.roleBreakdown[0]?.fallbackCount, 1);
  assert.equal(report.roleBreakdown.some((role) => role.groundingGapCount === 1), true);
  assert.equal(report.summary.respondentStageFailureCount, 1);
  assert.equal(report.summary.respondentStaticFallbackCount, 1);
  assert.equal(report.respondentReliability.topFailureCauses.length, 2);
  assert.equal(
    report.respondentReliability.topFailureCauses.some(
      (cause) => cause.failureClass === "provider_error"
    ),
    true
  );
  assert.equal(report.impact.completed.count, 1);
  assert.equal(report.impact.classifiedPartial.count, 3);
  assert.equal(report.impact.legacyPartial.count, 1);
  assert.equal(report.impact.completed.averageSynthesisImprovements, 2);
  assert.equal(report.impact.classifiedPartial.averageLocalLearningNotes, 1);
  assert.equal(report.impact.classifiedPartial.winnerDistribution.B, 1);
  assert.equal(report.impact.classifiedPartial.winnerDistribution.tie, 1);
  assert.equal(report.recentStatuses[0]?.partialKind, "legacy");
});

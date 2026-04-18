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

  const report = service.buildReport([
    legacyPartialRound,
    partialResearchRound,
    completedRound,
    partialTeacherRound
  ]);

  assert.equal(report.summary.totalRounds, 4);
  assert.equal(report.summary.completedRounds, 1);
  assert.equal(report.summary.partialRounds, 3);
  assert.equal(report.summary.classifiedPartialRounds, 2);
  assert.equal(report.summary.legacyPartialRounds, 1);
  assert.equal(report.summary.partialRatePct, 75);
  assert.equal(report.summary.classifiedPartialRatePct, 50);
  assert.equal(report.summary.legacyPartialRatePct, 25);
  assert.equal(report.summary.topDegradingRole, "teacher");
  assert.equal(report.topDegradationReasons.length, 2);
  assert.equal(report.topDegradationReasons[0]?.count, 1);
  assert.equal(report.roleBreakdown.length, 2);
  assert.equal(report.roleBreakdown[0]?.role, "teacher");
  assert.equal(report.roleBreakdown[0]?.fallbackCount, 1);
  assert.equal(report.roleBreakdown[1]?.groundingGapCount, 1);
  assert.equal(report.impact.completed.count, 1);
  assert.equal(report.impact.classifiedPartial.count, 2);
  assert.equal(report.impact.legacyPartial.count, 1);
  assert.equal(report.impact.completed.averageSynthesisImprovements, 2);
  assert.equal(report.impact.classifiedPartial.averageLocalLearningNotes, 1);
  assert.equal(report.impact.classifiedPartial.winnerDistribution.B, 1);
  assert.equal(report.impact.classifiedPartial.winnerDistribution.tie, 1);
  assert.equal(report.recentStatuses[0]?.partialKind, "legacy");
});

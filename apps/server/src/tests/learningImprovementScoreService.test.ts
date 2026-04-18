import test from "node:test";
import assert from "node:assert/strict";
import { ArenaQualityAnalyticsService } from "../services/arenaQualityAnalyticsService.js";
import {
  buildArenaRoundFixture,
  buildKnowledgeLayerFixture,
  buildStudentSessionFixture
} from "./testFixtures.js";
import { LearningImprovementScoreService } from "../services/learningImprovementScoreService.js";
import type { StudentToolImpactFile } from "../services/studentToolImpactTrackerService.js";

function buildToolImpactFixture(): StudentToolImpactFile {
  return {
    version: "hydria-student-tool-impact-v1",
    builtAt: "2026-04-18T10:00:00.000Z",
    sourceStats: {
      studentSessionsAnalyzed: 4,
      toolUsedSessions: 3,
      toolUnusedSessions: 1,
      comparedSessions: 4
    },
    overall: {
      used: {
        observations: 3,
        successRate: 100,
        positiveImpactRate: 66,
        averageJudgeDelta: 7,
        averageGainGlobal: 6,
        averageLengthDeltaWords: 8,
        averageStructureDelta: 3,
        noReliableSourceRate: 20
      },
      unused: {
        observations: 1,
        successRate: 100,
        positiveImpactRate: 0,
        averageJudgeDelta: 2,
        averageGainGlobal: 1,
        averageLengthDeltaWords: 0,
        averageStructureDelta: 0,
        noReliableSourceRate: 0
      },
      averageJudgeDeltaDelta: 5
    },
    contexts: []
  };
}

test("learning improvement score synthesizes a weighted global score from existing Hydria metrics", () => {
  const partialRound = buildArenaRoundFixture({
    workflow: {
      ...buildArenaRoundFixture().workflow,
      status: "partial",
      degradationReasons: [
        {
          code: "critical_role_fallback",
          impact: "quality_degraded",
          role: "local_student",
          summary: "Local student parser fell back."
        }
      ],
      outcome: "Round completed with local observer fallback."
    }
  });
  const completedRound = buildArenaRoundFixture();
  const session = buildStudentSessionFixture({
    lessonsLearned: [
      {
        lessonId: "unsupported-claim-1",
        failureType: "unsupported_claim",
        error: "The answer asserted a fact without proof.",
        correction: "Verify the claim before stating it.",
        rule: "Ground factual claims when they depend on external state.",
        conditions: ["claims"],
        confidence: 0.75,
        evidenceCount: 2
      }
    ]
  });
  const arenaQuality = new ArenaQualityAnalyticsService().buildReport([partialRound, completedRound]);
  const service = new LearningImprovementScoreService();
  const result = service.buildScore({
    rounds: [partialRound, completedRound],
    sessions: [session],
    knowledgeLayer: buildKnowledgeLayerFixture(),
    toolImpact: buildToolImpactFixture(),
    arenaQuality
  });

  assert.ok(result.score.overall > 50);
  assert.ok(result.score.components.researchImpact.score > 55);
  assert.ok(result.score.components.factuality.score < 100);
  assert.equal(result.score.components.stability.observedValue, 50);
});

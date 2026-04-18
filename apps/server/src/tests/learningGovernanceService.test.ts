import test from "node:test";
import assert from "node:assert/strict";
import { ArenaQualityAnalyticsService } from "../services/arenaQualityAnalyticsService.js";
import { LearningGovernanceService } from "../services/learningGovernanceService.js";
import {
  buildArenaRoundFixture,
  buildKnowledgeLayerFixture,
  buildStudentSessionFixture
} from "./testFixtures.js";
import type { StrategyDiscoveryFile } from "../services/studentStrategyDiscoveryService.js";
import type { StudentRuleImpactFile } from "../services/studentRuleImpactTrackerService.js";
import type { StudentStrategyImpactFile } from "../services/studentStrategyImpactTrackerService.js";
import type { StudentToolImpactFile } from "../services/studentToolImpactTrackerService.js";

function buildRuleImpactFixture(): StudentRuleImpactFile {
  return {
    version: "hydria-student-rule-impact-v1",
    builtAt: "2026-04-18T10:00:00.000Z",
    sourceStats: {
      studentSessionsAnalyzed: 4,
      comparedSessions: 4,
      ruleObservations: 5
    },
    rules: [
      {
        ruleId: "rule-example",
        category: "technical_explanation",
        failureType: "missing_examples",
        rule: "Add one practical example to explanatory answers.",
        observations: 3,
        successRate: 100,
        positiveImpactRate: 66,
        averageJudgeDelta: 5,
        averageGainGlobal: 4,
        averageLengthDeltaWords: 10,
        averageStructureDelta: 3,
        empiricalConfidence: 0.82,
        activation: "active",
        contexts: [
          {
            questionType: "explanatory",
            promptLength: "short",
            signals: ["abstraction"],
            observations: 3,
            successRate: 100,
            positiveImpactRate: 66,
            averageJudgeDelta: 5,
            averageGainGlobal: 4,
            averageLengthDeltaWords: 10,
            averageStructureDelta: 3,
            empiricalConfidence: 0.82,
            activation: "active"
          }
        ]
      },
      {
        ruleId: "rule-vague",
        category: "technical_explanation",
        failureType: "too_generic",
        rule: "Use broad abstract framing first.",
        observations: 2,
        successRate: 0,
        positiveImpactRate: 0,
        averageJudgeDelta: -3,
        averageGainGlobal: -2,
        averageLengthDeltaWords: 1,
        averageStructureDelta: -1,
        empiricalConfidence: 0.7,
        activation: "inactive",
        contexts: []
      }
    ]
  };
}

function buildStrategyImpactFixture(): StudentStrategyImpactFile {
  return {
    version: "hydria-student-strategy-impact-v1",
    builtAt: "2026-04-18T10:00:00.000Z",
    sourceStats: {
      studentSessionsAnalyzed: 4,
      comparedSessions: 4,
      strategyObservations: 4
    },
    strategies: [
      {
        strategyId: "explanatory_compact_example",
        observations: 3,
        usageRate: 75,
        successRate: 100,
        positiveImpactRate: 66,
        averageJudgeDelta: 4,
        averageGainGlobal: 4,
        averageLengthDeltaWords: 8,
        averageStructureDelta: 3,
        empiricalConfidence: 0.84,
        activation: "active",
        contexts: []
      },
      {
        strategyId: "open_short",
        observations: 2,
        usageRate: 50,
        successRate: 0,
        positiveImpactRate: 0,
        averageJudgeDelta: -2,
        averageGainGlobal: -2,
        averageLengthDeltaWords: 0,
        averageStructureDelta: -1,
        empiricalConfidence: 0.71,
        activation: "inactive",
        contexts: []
      }
    ]
  };
}

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

function buildDiscoveryFixture(): StrategyDiscoveryFile {
  return {
    version: "hydria-student-strategy-discovery-v1",
    builtAt: "2026-04-18T10:00:00.000Z",
    sourceStats: {
      proposals: 1,
      evaluations: 2,
      adoptedReplacements: 1
    },
    proposals: [],
    evaluations: [],
    adoptions: [
      {
        baseStrategyId: "explanatory_short",
        candidateStrategyId: "explanatory_compact_example",
        category: "technical_explanation",
        context: {
          questionType: "explanatory",
          promptLength: "short",
          signals: ["abstraction"]
        },
        observations: 3,
        winRate: 66,
        averageJudgeDelta: 4,
        averageGainGlobal: 4,
        averageLengthDeltaWords: 8,
        averageAbsoluteLengthDeltaWords: 8,
        averageStructureDelta: 3,
        averageNoiseDelta: 0,
        averageClarityDelta: 1,
        productGuard: {
          passed: true,
          noiseOk: true,
          lengthOk: true,
          clarityOk: true,
          reasons: []
        },
        adoption: "adopted",
        reason: "Compact-example strategy wins in short explanatory contexts."
      }
    ]
  };
}

test("learning governance promotes, guards, and rejects policies using existing Hydria trackers", () => {
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
  const rounds = [partialRound, buildArenaRoundFixture()];
  const sessions = [buildStudentSessionFixture()];
  const arenaQuality = new ArenaQualityAnalyticsService().buildReport(rounds);
  const service = new LearningGovernanceService();
  const report = service.buildReport({
    rounds,
    sessions,
    knowledgeLayer: buildKnowledgeLayerFixture(),
    arenaQuality,
    ruleImpact: buildRuleImpactFixture(),
    strategyImpact: buildStrategyImpactFixture(),
    toolImpact: buildToolImpactFixture(),
    strategyDiscovery: buildDiscoveryFixture()
  });
  const activeMemory = service.buildActiveMemory(report);

  assert.ok(report.hotspots.some((hotspot) => hotspot.kind === "local_student"));
  assert.ok(report.hotspots.some((hotspot) => hotspot.kind === "strategy"));
  assert.equal(report.constitution.version, "hydria-learning-constitution-v1");
  assert.equal(report.constitution.defaultScope, "local_first");
  assert.ok(
    report.policies.some(
      (policy) => policy.target === "student_rule" && policy.state === "active"
    )
  );
  assert.ok(
    report.policies.some(
      (policy) => policy.target === "student_strategy" && policy.state === "rejected"
    )
  );
  assert.ok(
    report.policies.some(
      (policy) =>
        policy.target === "student_strategy" &&
        policy.targetId === "explanatory_compact_example" &&
        policy.state === "active" &&
        /instead of explanatory_short/i.test(policy.learned)
    )
  );
  assert.ok(activeMemory.items.some((item) => item.state === "active"));
});

test("learning governance flags live false positives after promotion and moves active policies to guarded", () => {
  const service = new LearningGovernanceService();
  const previousReport = service.buildReport({
    rounds: [buildArenaRoundFixture()],
    sessions: [buildStudentSessionFixture()],
    knowledgeLayer: buildKnowledgeLayerFixture(),
    arenaQuality: new ArenaQualityAnalyticsService().buildReport([buildArenaRoundFixture()]),
    ruleImpact: buildRuleImpactFixture(),
    strategyImpact: buildStrategyImpactFixture(),
    toolImpact: buildToolImpactFixture(),
    strategyDiscovery: buildDiscoveryFixture()
  });
  const regressingSessions = [1, 2, 3].map((index) =>
    buildStudentSessionFixture({
      sessionId: `77777777-7777-4777-8777-77777777777${index}`,
      createdAt: `2026-04-19T10:0${index}:00.000Z`,
      strategyImpact: {
        ...buildStudentSessionFixture().strategyImpact,
        compared: true,
        strategyId: "explanatory_compact_example",
        metrics: {
          judgeOverallDelta: -4,
          gainGlobal: -4,
          lengthDeltaWords: -10,
          keyPointsDelta: -1,
          assumptionsDelta: 0,
          structureDelta: -2,
          success: false
        }
      }
    })
  );
  const currentReport = service.buildReport({
    rounds: [buildArenaRoundFixture()],
    sessions: regressingSessions,
    knowledgeLayer: buildKnowledgeLayerFixture(),
    arenaQuality: new ArenaQualityAnalyticsService().buildReport([buildArenaRoundFixture()]),
    ruleImpact: buildRuleImpactFixture(),
    strategyImpact: buildStrategyImpactFixture(),
    toolImpact: buildToolImpactFixture(),
    strategyDiscovery: buildDiscoveryFixture(),
    previousReport
  });
  const monitored = currentReport.liveMonitoring.items.find(
    (item) => item.target === "student_strategy" && item.targetId === "explanatory_compact_example"
  );
  const updatedPolicy = currentReport.policies.find(
    (policy) =>
      policy.target === "student_strategy" &&
      policy.targetId === "explanatory_compact_example" &&
      policy.scope.category === null
  );

  assert.equal(monitored?.status, "false_positive_risk");
  assert.equal(currentReport.liveMonitoring.falsePositiveAlerts >= 1, true);
  assert.equal(updatedPolicy?.state, "guarded");
});

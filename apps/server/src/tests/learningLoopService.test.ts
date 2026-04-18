import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LearningGovernanceService } from "../services/learningGovernanceService.js";
import { LearningLoopService } from "../services/learningLoopService.js";
import {
  buildArenaRoundFixture,
  buildKnowledgeLayerFixture,
  buildStudentSessionFixture
} from "./testFixtures.js";
import type { StudentTemporalEvalReport } from "../services/studentTemporalEvalService.js";

function buildRuleImpactFixture() {
  return {
    version: "hydria-student-rule-impact-v1" as const,
    builtAt: "2026-04-18T10:00:00.000Z",
    sourceStats: {
      studentSessionsAnalyzed: 1,
      comparedSessions: 1,
      ruleObservations: 1
    },
    rules: [
      {
        ruleId: "rule-example",
        category: "technical_explanation" as const,
        failureType: "missing_examples",
        rule: "Add one practical example to explanatory answers.",
        observations: 1,
        successRate: 100,
        positiveImpactRate: 100,
        averageJudgeDelta: 5,
        averageGainGlobal: 4,
        averageLengthDeltaWords: 8,
        averageStructureDelta: 3,
        empiricalConfidence: 0.8,
        activation: "active" as const,
        contexts: []
      }
    ]
  };
}

function buildStrategyImpactFixture() {
  return {
    version: "hydria-student-strategy-impact-v1" as const,
    builtAt: "2026-04-18T10:00:00.000Z",
    sourceStats: {
      studentSessionsAnalyzed: 1,
      comparedSessions: 1,
      strategyObservations: 1
    },
    strategies: [
      {
        strategyId: "explanatory_compact_example" as const,
        observations: 1,
        usageRate: 100,
        successRate: 100,
        positiveImpactRate: 100,
        averageJudgeDelta: 4,
        averageGainGlobal: 4,
        averageLengthDeltaWords: 8,
        averageStructureDelta: 3,
        empiricalConfidence: 0.8,
        activation: "active" as const,
        contexts: []
      }
    ]
  };
}

function buildToolImpactFixture() {
  return {
    version: "hydria-student-tool-impact-v1" as const,
    builtAt: "2026-04-18T10:00:00.000Z",
    sourceStats: {
      studentSessionsAnalyzed: 1,
      toolUsedSessions: 1,
      toolUnusedSessions: 0,
      comparedSessions: 1
    },
    overall: {
      used: {
        observations: 1,
        successRate: 100,
        positiveImpactRate: 100,
        averageJudgeDelta: 7,
        averageGainGlobal: 6,
        averageLengthDeltaWords: 8,
        averageStructureDelta: 3,
        noReliableSourceRate: 10
      },
      unused: {
        observations: 0,
        successRate: 0,
        positiveImpactRate: 0,
        averageJudgeDelta: 0,
        averageGainGlobal: 0,
        averageLengthDeltaWords: 0,
        averageStructureDelta: 0,
        noReliableSourceRate: 0
      },
      averageJudgeDeltaDelta: 7
    },
    contexts: []
  };
}

test("learning loop rebuilds governance artifacts and persists active learning memory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hydria-learning-loop-"));

  try {
    const governanceFile = join(tempDir, "governance.json");
    const activeMemoryFile = join(tempDir, "active-memory.json");
    const governanceService = new LearningGovernanceService({
      governanceFile,
      activeMemoryFile
    });

    const loop = new LearningLoopService({
      historyStore: {
        async listRounds() {
          return [buildArenaRoundFixture()];
        }
      },
      async listStudentSessions() {
        return [buildStudentSessionFixture()];
      },
      knowledgeLayerService: {
        async loadKnowledgeLayer() {
          return buildKnowledgeLayerFixture();
        }
      },
      knowledgeMemoryService: {
        async buildAndPersist() {
          return null;
        }
      },
      ruleImpactTrackerService: {
        async buildAndPersist() {
          return buildRuleImpactFixture();
        }
      },
      strategyImpactTrackerService: {
        async buildAndPersist() {
          return buildStrategyImpactFixture();
        }
      },
      toolImpactTrackerService: {
        async buildAndPersist() {
          return buildToolImpactFixture();
        }
      },
      strategyDiscoveryService: {
        async load() {
          return {
            version: "hydria-student-strategy-discovery-v1" as const,
            builtAt: "2026-04-18T10:00:00.000Z",
            sourceStats: {
              proposals: 0,
              evaluations: 0,
              adoptedReplacements: 0
            },
            proposals: [],
            evaluations: [],
            adoptions: []
          };
        }
      },
      learningGovernanceService: governanceService,
      temporalEvalService: {
        async run() {
          return {
            runId: "learning-loop-test",
            createdAt: "2026-04-18T10:00:00.000Z",
            mode: "local_first_preview",
            acquisitionMode: "replay",
            fixtureFile: "fixture.json",
            sourceCacheEnabled: false,
            cases: [],
            results: [],
            summary: {
              totalCases: 2,
              completedCases: 2,
              failedCases: 0,
              queryTypeMatchRate: 100,
              toolTriggerRate: 100,
              researchUsedRate: 50,
              toolAppliedRate: 50,
              freshnessSatisfiedRate: 100,
              noReliableSourceRate: 0,
              explicitDateAnchoringRate: 100,
              staleAbstentionRate: 100,
              answerChangedRate: 50,
              averageResearchSourceCount: 2,
              averageStaleRejectedCount: 0,
              averageDurationMs: 200,
              successByVenue: [],
              successByOrigin: [],
              successByDateSource: [],
              byPrimaryCause: [],
              byQueryType: []
            }
          } satisfies StudentTemporalEvalReport;
        }
      }
    });

    const result = await loop.run({
      validationMode: "temporal_replay",
      validationLimit: 2
    });

    const persistedReport = JSON.parse(await readFile(governanceFile, "utf8"));
    const persistedMemory = JSON.parse(await readFile(activeMemoryFile, "utf8"));

    assert.equal(result.report.validation.mode, "temporal_replay");
    assert.equal(result.report.constitution.version, "hydria-learning-constitution-v1");
    assert.ok(result.report.policies.length > 0);
    assert.ok(result.activeMemory.items.length > 0);
    assert.equal(persistedReport.version, "hydria-learning-governance-v1");
    assert.equal(persistedReport.constitution.defaultScope, "local_first");
    assert.equal(persistedMemory.version, "hydria-learning-active-memory-v1");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

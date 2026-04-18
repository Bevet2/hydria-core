import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KnowledgeMemoryService } from "../services/knowledgeMemoryService.js";
import { PersistenceHealthService } from "../services/storage/persistenceHealthService.js";
import { StudentStrategyAssetService } from "../services/studentStrategyAssetService.js";
import { StudentStrategyDiscoveryService } from "../services/studentStrategyDiscoveryService.js";
import { StudentRuleImpactTrackerService } from "../services/studentRuleImpactTrackerService.js";
import { StudentSessionStore } from "../services/studentSessionStore.js";
import {
  buildKnowledgeLayerFixture,
  buildStudentSessionFixture
} from "./testFixtures.js";

function waitForSqliteRelease() {
  return new Promise((resolve) => setTimeout(resolve, 40));
}

test("student rule impact tracker self-heals from sqlite when projection or impact files are unusable", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-student-tracker-"));
  let store: StudentSessionStore | null = null;
  try {
    const historyFile = join(tempRoot, "student-history.json");
    const datasetFile = join(tempRoot, "student-cycles.jsonl");
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    const impactFile = join(tempRoot, "student-rule-impact.json");

    store = new StudentSessionStore(historyFile, datasetFile, databaseFile);
    (store as any).knowledgeMemoryService = { buildAndPersist: async () => undefined };
    (store as any).studentRuleImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentStrategyImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentToolImpactTrackerService = { buildAndPersist: async () => undefined };
    await store.appendSession(buildStudentSessionFixture());

    await writeFile(historyFile, "{bad json", "utf8");

    const tracker = new StudentRuleImpactTrackerService(historyFile, impactFile, databaseFile);
    const payload = await tracker.load();
    assert.equal(payload?.sourceStats.studentSessionsAnalyzed, 1);
    assert.equal(payload?.sourceStats.comparedSessions, 1);
    assert.equal(payload?.rules.length, 1);

    const persisted = JSON.parse(await readFile(impactFile, "utf8"));
    assert.equal(persisted.sourceStats.studentSessionsAnalyzed, 1);
  } finally {
    await store?.close?.();
    await waitForSqliteRelease();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("knowledge memory service self-heals from sqlite when the session projection is missing", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-student-memory-"));
  let store: StudentSessionStore | null = null;
  try {
    const historyFile = join(tempRoot, "student-history.json");
    const datasetFile = join(tempRoot, "student-cycles.jsonl");
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    const memoryFile = join(tempRoot, "hydria-memory.json");
    const knowledgeLayerFile = join(tempRoot, "hydria-knowledge.json");

    await writeFile(
      knowledgeLayerFile,
      `${JSON.stringify(buildKnowledgeLayerFixture(), null, 2)}\n`,
      "utf8"
    );

    store = new StudentSessionStore(historyFile, datasetFile, databaseFile);
    (store as any).knowledgeMemoryService = { buildAndPersist: async () => undefined };
    (store as any).studentRuleImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentStrategyImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentToolImpactTrackerService = { buildAndPersist: async () => undefined };
    await store.appendSession(buildStudentSessionFixture());

    await unlink(historyFile);

    const memoryService = new KnowledgeMemoryService(
      memoryFile,
      historyFile,
      knowledgeLayerFile,
      databaseFile
    );
    const memory = await memoryService.loadMemory();
    assert.equal(memory?.sourceStats.studentSessionsAnalyzed, 1);
    assert.equal(
      memory?.categories.find((entry) => entry.category === "technical_explanation")?.rules.length,
      4
    );

    const persisted = JSON.parse(await readFile(memoryFile, "utf8"));
    assert.equal(persisted.sourceStats.studentSessionsAnalyzed, 1);
  } finally {
    await store?.close?.();
    await waitForSqliteRelease();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("persistence health reports sqlite counts and projection mismatches without depending on derived artifacts", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-persistence-health-"));
  let store: StudentSessionStore | null = null;
  try {
    const historyFile = join(tempRoot, "student-history.json");
    const datasetFile = join(tempRoot, "student-cycles.jsonl");
    const databaseFile = join(tempRoot, "hydria-state.sqlite");
    const arenaHistoryFile = join(tempRoot, "history.json");
    const knowledgeMemoryFile = join(tempRoot, "hydria-memory.json");
    const studentRuleImpactFile = join(tempRoot, "student-rule-impact.json");
    const studentToolImpactFile = join(tempRoot, "student-tool-impact.json");
    const studentStrategyImpactFile = join(tempRoot, "student-strategy-impact.json");
    const studentStrategyDiscoveryFile = join(tempRoot, "student-strategy-discovery.json");
    const studentStrategyAssetsFile = join(tempRoot, "student-strategy-assets.json");

    await writeFile(arenaHistoryFile, `${JSON.stringify({ rounds: [] }, null, 2)}\n`, "utf8");
    store = new StudentSessionStore(historyFile, datasetFile, databaseFile);
    (store as any).knowledgeMemoryService = { buildAndPersist: async () => undefined };
    (store as any).studentRuleImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentStrategyImpactTrackerService = { buildAndPersist: async () => undefined };
    (store as any).studentToolImpactTrackerService = { buildAndPersist: async () => undefined };
    await store.appendSession(buildStudentSessionFixture());

    await writeFile(historyFile, `${JSON.stringify({ sessions: [] }, null, 2)}\n`, "utf8");

    const healthService = new PersistenceHealthService(
      databaseFile,
      arenaHistoryFile,
      historyFile,
      knowledgeMemoryFile,
      studentRuleImpactFile,
      studentToolImpactFile,
      studentStrategyImpactFile,
      studentStrategyDiscoveryFile,
      studentStrategyAssetsFile
    );
    const report = await healthService.getReport();
    const summary = await healthService.getSummary();

    assert.equal(report.database.studentSessionCount, 1);
    assert.equal(report.projections.studentHistory.status, "count_mismatch");
    assert.equal(report.derivedArtifacts.knowledgeMemory.status, "missing");
    assert.equal(report.derivedArtifacts.knowledgeMemory.rebuildableFromPersistence, true);
    assert.equal(summary.projectionIssues, 1);
    assert.equal(summary.derivedArtifactIssues, 6);
  } finally {
    await store?.close?.();
    await waitForSqliteRelease();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("student strategy asset service rebuilds assets from discovery when the asset file is missing", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-strategy-assets-"));
  try {
    const discoveryFile = join(tempRoot, "student-strategy-discovery.json");
    const assetFile = join(tempRoot, "student-strategy-assets.json");

    await writeFile(
      discoveryFile,
      `${JSON.stringify(
        {
          version: "hydria-student-strategy-discovery-v1",
          builtAt: "2026-04-18T10:00:00.000Z",
          sourceStats: {
            proposals: 1,
            evaluations: 1,
            adoptedReplacements: 1
          },
          proposals: [
            {
              baseStrategyId: "explanatory_short",
              candidateStrategyId: "explanatory_compact_example",
              category: "technical_explanation",
              context: {
                questionType: "explanatory",
                promptLength: "short",
                signals: ["abstraction"]
              },
              currentActivation: "cautious",
              currentAverageJudgeDelta: 0,
              reason: "Compact examples help here."
            }
          ],
          evaluations: [
            {
              question: "Explain eventual consistency.",
              category: "technical_explanation",
              baseStrategyId: "explanatory_short",
              candidateStrategyId: "explanatory_compact_example",
              context: {
                questionType: "explanatory",
                promptLength: "short",
                signals: ["abstraction"]
              },
              judgeDelta: 8,
              gainGlobal: 8,
              success: true,
              lengthDeltaWords: 14,
              structureDelta: 3,
              noiseDelta: 0,
              clarityDelta: 2
            }
          ],
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
              winRate: 100,
              averageJudgeDelta: 8,
              averageGainGlobal: 8,
              averageLengthDeltaWords: 14,
              averageAbsoluteLengthDeltaWords: 14,
              averageStructureDelta: 3,
              averageNoiseDelta: 0,
              averageClarityDelta: 2,
              productGuard: {
                passed: true,
                noiseOk: true,
                lengthOk: true,
                clarityOk: true,
                reasons: []
              },
              adoption: "adopted",
              reason: "Compact examples consistently improve clarity."
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const assetService = new StudentStrategyAssetService(assetFile, discoveryFile);
    const assets = await assetService.load();
    assert.equal(assets?.assets.length, 1);
    assert.equal(assets?.assets[0]?.adoptedStrategyId, "explanatory_compact_example");

    const persisted = JSON.parse(await readFile(assetFile, "utf8"));
    assert.equal(persisted.assets.length, 1);
  } finally {
    await waitForSqliteRelease();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("student strategy discovery service synthesizes discovery state from existing assets when the discovery file is missing", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-strategy-discovery-"));
  try {
    const discoveryFile = join(tempRoot, "student-strategy-discovery.json");
    const assetFile = join(tempRoot, "student-strategy-assets.json");

    await writeFile(
      assetFile,
      `${JSON.stringify(
        {
          version: "hydria-student-strategy-assets-v1",
          builtAt: "2026-04-18T10:00:00.000Z",
          sourceStats: {
            discoveryBuiltAt: "2026-04-18T10:00:00.000Z",
            adoptedAssets: 1
          },
          assets: [
            {
              assetId: "strategy:explanatory_short->explanatory_compact_example:explanatory|short|abstraction",
              assetVersion: 1,
              status: "active",
              category: "technical_explanation",
              baseStrategyId: "explanatory_short",
              adoptedStrategyId: "explanatory_compact_example",
              context: {
                questionType: "explanatory",
                promptLength: "short",
                signals: ["abstraction"]
              },
              trace: {
                proposalReason: "Compact examples help here.",
                adoptionReason: "Compact examples consistently improve clarity.",
                discoveryBuiltAt: "2026-04-18T10:00:00.000Z",
                sampleQuestions: ["Explain eventual consistency."]
              },
              evidence: {
                observations: 3,
                winRate: 100,
                averageJudgeDelta: 8,
                averageGainGlobal: 8,
                averageLengthDeltaWords: 14,
                averageNoiseDelta: 0,
                averageClarityDelta: 2,
                productGuard: {
                  passed: true,
                  noiseOk: true,
                  lengthOk: true,
                  clarityOk: true,
                  reasons: []
                }
              },
              learning: {
                summary: "Prefer explanatory_compact_example over explanatory_short.",
                promptHint: "Define briefly, then anchor immediately with one concrete example and one limit.",
                usageNote: "Compact examples consistently improve clarity."
              }
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const discoveryService = new StudentStrategyDiscoveryService(discoveryFile);
    (discoveryService as any).strategyAssetService = new StudentStrategyAssetService(assetFile, discoveryFile);
    const discovery = await discoveryService.load();

    assert.equal(discovery?.adoptions.length, 1);
    assert.equal(discovery?.sourceStats.adoptedReplacements, 1);
    assert.ok((discovery?.proposals.length ?? 0) >= 1);

    const persisted = JSON.parse(await readFile(discoveryFile, "utf8"));
    assert.equal(persisted.adoptions.length, 1);
  } finally {
    await waitForSqliteRelease();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

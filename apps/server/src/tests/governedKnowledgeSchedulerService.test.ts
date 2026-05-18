import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GovernedKnowledgeSchedulerService } from "../services/governedKnowledgeSchedulerService.js";

function buildScheduler(tempRoot: string, calls: string[]) {
  return new GovernedKnowledgeSchedulerService({
    reportFile: join(tempRoot, "scheduler-report.json"),
    lockFile: join(tempRoot, "scheduler-lock.json"),
    now: () => new Date("2026-05-18T12:00:00.000Z"),
    watcherKernel: {
      async run() {
        calls.push("watchers");
        return {
          scope: "all",
          runs: [{ watcherId: "internal-gap-control-v1" }],
          state: {
            sourceStats: {
              candidateCount: 2,
              acquisitionTaskCount: 5
            }
          }
        } as any;
      }
    },
    sourceAcquisitionService: {
      async run() {
        calls.push("source_acquisition");
        return {
          dryRun: false,
          sourceStats: {
            packCount: 5,
            sourceCount: 10,
            fetchedSourceCount: 10,
            failedSourceCount: 0,
            itemCount: 10,
            corroboratedItemCount: 0,
            guardedItemCount: 2,
            expiredItemCount: 0,
            byPack: {}
          }
        } as any;
      }
    },
    knowledgeQualityGateService: {
      async evaluateAndPersist() {
        calls.push("knowledge_quality_gate");
        return {
          gate: {
            passed: true
          },
          sourceStats: {
            evaluatedItemCount: 10,
            rejectedCount: 2,
            guardedCount: 2,
            promotableCount: 4,
            genericRejectedCount: 2,
            liveGuardedCount: 2
          }
        } as any;
      }
    },
    knowledgeConsolidationService: {
      async buildAndPersist() {
        calls.push("knowledge_consolidation");
        return {
          file: {
            sourceStats: {
              objectCount: 12,
              activeCount: 0,
              guardedCount: 2
            }
          },
          sourceAcquisition: {
            sourceStats: {
              itemCount: 10
            }
          }
        } as any;
      }
    },
    promotionGovernanceService: {
      async evaluateAndPersist() {
        calls.push("promotion_dry_run");
        return {
          gate: {
            passed: true
          },
          sourceStats: {
            activePromotionCount: 0,
            trainingCandidateCount: 4
          },
          trainingQueue: {
            sourceStats: {
              byTarget: {
                retrieval_knowledge: 3
              }
            }
          }
        } as any;
      }
    },
    trainingQueueValidationService: {
      async validateAndPersist() {
        calls.push("training_queue_validation");
        return {
          gate: {
            passed: true
          },
          sourceStats: {
            queueItemCount: 4,
            readyForPackCount: 0
          },
          trainingAuthorization: {
            studentSftAllowed: false
          }
        } as any;
      }
    }
  });
}

test("governed knowledge scheduler runs bounded non-training pipeline", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-scheduler-"));
  const calls: string[] = [];
  try {
    const scheduler = buildScheduler(tempRoot, calls);
    const report = await scheduler.run({
      force: true,
      networkEnabled: true,
      maxPacks: 5,
      maxSourcesPerPack: 2,
      maxItemsPerSource: 1,
      timeoutMs: 7000,
      interactionLimit: 1000,
      minIntervalMinutes: 360,
      maxRuntimeMinutes: 20
    });

    assert.equal(report.status, "completed");
    assert.equal(report.safety.noModelExecution, true);
    assert.equal(report.safety.noTraining, true);
    assert.equal(report.safety.noActivePromotion, true);
    assert.equal(report.options.sourceBudget.maxSourcesPerPack, 2);
    assert.equal(report.sourceStats.failedStepCount, 0);
    assert.deepEqual(calls, [
      "watchers",
      "source_acquisition",
      "knowledge_quality_gate",
      "knowledge_consolidation",
      "promotion_dry_run",
      "training_queue_validation"
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("governed knowledge scheduler cooldown prevents repeated runs", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-scheduler-cooldown-"));
  const calls: string[] = [];
  try {
    const scheduler = buildScheduler(tempRoot, calls);
    await scheduler.run({
      force: true,
      networkEnabled: true,
      minIntervalMinutes: 360
    });
    calls.length = 0;

    const report = await scheduler.run({
      networkEnabled: true,
      minIntervalMinutes: 360
    });

    assert.equal(report.status, "skipped");
    assert.match(report.reason, /Cooldown active/);
    assert.equal(report.lastCompletedRunAt, "2026-05-18T12:00:00.000Z");
    assert.equal(report.steps.length, 0);
    assert.deepEqual(calls, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

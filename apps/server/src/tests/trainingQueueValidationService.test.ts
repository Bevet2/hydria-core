import test from "node:test";
import assert from "node:assert/strict";
import { TrainingQueueValidationService } from "../services/trainingQueueValidationService.js";
import type { KnowledgeObject, KnowledgeObjectFile } from "../types/knowledgeObjects.js";
import type {
  TrainingCandidateQueueFile,
  TrainingCandidateQueueItem
} from "../types/knowledgePromotion.js";
import type { WatcherState } from "../types/watchers.js";

const now = "2026-05-14T10:00:00.000Z";

function object(overrides: Partial<KnowledgeObject>): KnowledgeObject {
  return {
    objectId: "ko::test::base",
    title: "Base object",
    type: "failure_pattern",
    knowledgeClass: "guarded",
    state: "guarded",
    domain: "technical_explanation",
    category: "technical_explanation",
    content: "Repair a recurring failure with a verified concise answer pattern.",
    summary: "Repair recurring failure.",
    tags: ["test"],
    confidence: 0.68,
    riskLevel: "high",
    evidenceCount: 3,
    sources: [
      {
        sourceType: "interaction_learning",
        sourceId: "interaction::test",
        sourceUri: null,
        evidenceRecordIds: ["11111111-1111-4111-8111-111111111111"]
      }
    ],
    relations: [],
    decay: {
      policy: "standard",
      validFrom: now,
      expiresAt: null,
      rationale: "test"
    },
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function queueItem(overrides: Partial<TrainingCandidateQueueItem>): TrainingCandidateQueueItem {
  return {
    queueId: "training-candidate::test",
    sourceObjectId: "ko::test::base",
    sourceType: "interaction_learning",
    target: "student_sft",
    status: "ready",
    priority: "high",
    domain: "technical_explanation",
    category: "technical_explanation",
    objective: "Prepare a supervised repair pack.",
    targetBehavior: "Repair a recurring failure with a verified concise answer pattern.",
    requiredValidation: ["Confirm the failure with benchmark evidence."],
    preTrainChecks: ["Review source evidence."],
    postTrainChecks: ["Run benchmark gates before promotion."],
    blockers: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function queue(items: TrainingCandidateQueueItem[]): TrainingCandidateQueueFile {
  return {
    version: "hydria-training-candidate-queue-v1",
    generatedAt: now,
    sourceStats: {
      itemCount: items.length,
      readyCount: items.filter((item) => item.status === "ready").length,
      queuedCount: items.filter((item) => item.status === "queued").length,
      blockedCount: items.filter((item) => item.status === "blocked").length,
      byTarget: {},
      byDomain: {}
    },
    items
  };
}

function knowledgeFile(objects: KnowledgeObject[]): KnowledgeObjectFile {
  return {
    version: "hydria-knowledge-objects-v1",
    generatedAt: now,
    sourceStats: {
      objectCount: objects.length,
      activeCount: objects.filter((entry) => entry.state === "active").length,
      guardedCount: objects.filter((entry) => entry.state === "guarded").length,
      archivedCount: objects.filter((entry) => entry.state === "archived").length,
      byType: {},
      byClass: {},
      byDomain: {}
    },
    objects
  };
}

function watcherState(): WatcherState {
  return {
    version: "hydria-watchers-v1",
    generatedAt: now,
    sourceStats: {
      runCount: 1,
      findingCount: 1,
      candidateCount: 1,
      acquisitionTaskCount: 1,
      activeCandidateCount: 0,
      guardedCandidateCount: 0,
      byWatcher: {},
      byKind: {}
    },
    runs: [],
    findings: [],
    candidates: [
      {
        candidateId: "watcher-candidate::external::ai",
        watcherId: "external-knowledge-expansion-v1",
        watcherKind: "external",
        candidateType: "dynamic_knowledge",
        state: "candidate",
        domain: "ai",
        category: "technical_explanation",
        title: "AI model release watcher",
        claim: "Track model releases from current sources.",
        summary: "External dynamic candidate.",
        sources: [
          {
            label: "Hugging Face blog",
            url: "https://huggingface.co/blog",
            sourceType: "external_source",
            retrievedAt: null
          }
        ],
        evidenceRecordIds: [],
        confidence: 0.42,
        freshness: "live",
        corroborationCount: 0,
        riskLevel: "medium",
        tags: ["external-watcher", "live"],
        createdAt: now,
        updatedAt: now
      }
    ],
    acquisitionTasks: []
  };
}

test("training queue validation blocks uncorroborated external retrieval knowledge", () => {
  const service = new TrainingQueueValidationService({ minSftReadyItems: 2 });
  const report = service.buildReport({
    queue: queue([
      queueItem({
        queueId: "training-candidate::retrieval",
        sourceObjectId: "ko::watcher::ai",
        sourceType: "watcher",
        target: "retrieval_knowledge",
        status: "blocked",
        domain: "ai",
        targetBehavior: "Track model releases from current sources.",
        blockers: ["watcher_candidate_needs_corroboration"]
      })
    ]),
    knowledgeFile: knowledgeFile([
      object({
        objectId: "ko::watcher::ai",
        type: "fact",
        knowledgeClass: "dynamic",
        state: "candidate",
        domain: "ai",
        confidence: 0.42,
        evidenceCount: 0,
        riskLevel: "medium",
        sources: [
          {
            sourceType: "watcher",
            sourceId: "watcher-candidate::external::ai",
            sourceUri: "storage/learning/hydria-watchers-v1.json",
            evidenceRecordIds: []
          }
        ],
        decay: {
          policy: "fast",
          validFrom: now,
          expiresAt: null,
          rationale: "dynamic"
        }
      })
    ]),
    watcherState: watcherState()
  });

  assert.equal(report.decisions[0]?.validationStatus, "blocked");
  assert.ok(report.decisions[0]?.blockers.includes("retrieval-has-corroborated-sources"));
  assert.equal(report.sourceStats.retrievalReadyForPackCount, 0);
});

test("training queue validation can mark SFT item ready but blocks training below threshold", () => {
  const service = new TrainingQueueValidationService({ minSftReadyItems: 2 });
  const report = service.buildReport({
    queue: queue([queueItem({})]),
    knowledgeFile: knowledgeFile([object({})]),
    watcherState: null
  });

  assert.equal(report.decisions[0]?.validationStatus, "ready_for_pack");
  assert.equal(report.trainingAuthorization.studentSftAllowed, false);
  assert.equal(report.gate.passed, false);
  assert.equal(report.sourceStats.sftReadyForPackCount, 1);
});

test("training queue validation keeps inherited blockers from becoming ready", () => {
  const service = new TrainingQueueValidationService({ minSftReadyItems: 2 });
  const report = service.buildReport({
    queue: queue([
      queueItem({
        blockers: ["confidence_below_validation_threshold"]
      })
    ]),
    knowledgeFile: knowledgeFile([object({})]),
    watcherState: null
  });

  assert.equal(report.decisions[0]?.validationStatus, "blocked");
  assert.equal(report.decisions[0]?.packEligible, false);
  assert.equal(report.sourceStats.sftReadyForPackCount, 0);
  assert.equal(report.gate.passed, true);
});

test("training queue validation accepts stable validated runtime memory", () => {
  const service = new TrainingQueueValidationService({ minSftReadyItems: 2 });
  const report = service.buildReport({
    queue: queue([
      queueItem({
        queueId: "training-candidate::runtime-memory",
        sourceObjectId: "ko::runtime::validated",
        target: "runtime_memory",
        status: "queued",
        priority: "medium",
        domain: "incident_response",
        category: "incident_response",
        targetBehavior: "Use a stable incident response triage pattern with rollback guardrails.",
        blockers: []
      })
    ]),
    knowledgeFile: knowledgeFile([
      object({
        objectId: "ko::runtime::validated",
        type: "pattern",
        knowledgeClass: "stable",
        state: "validated",
        domain: "incident_response",
        category: "incident_response",
        confidence: 0.82,
        riskLevel: "low",
        evidenceCount: 3,
        content: "Use a stable incident response triage pattern with rollback guardrails.",
        decay: {
          policy: "slow",
          validFrom: now,
          expiresAt: null,
          rationale: "stable"
        }
      })
    ]),
    watcherState: null
  });

  assert.equal(report.decisions[0]?.validationStatus, "ready_for_pack");
  assert.equal(report.sourceStats.runtimeMemoryReadyForPackCount, 1);
  assert.equal(report.gate.passed, true);
});

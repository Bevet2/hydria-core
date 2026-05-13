import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { KnowledgeObject, KnowledgeObjectFile } from "../types/knowledgeObjects.js";
import type {
  TrainingCandidateQueueFile,
  TrainingCandidateQueueItem
} from "../types/knowledgePromotion.js";
import {
  trainingQueueValidationDecisionSchema,
  trainingQueueValidationReportSchema,
  type TrainingQueueValidationCheck,
  type TrainingQueueValidationDecision,
  type TrainingQueueValidationReport
} from "../types/trainingQueueValidation.js";
import type { WatcherKnowledgeCandidate, WatcherState } from "../types/watchers.js";
import { env } from "../utils/env.js";
import { KnowledgeObjectStore } from "./knowledgeObjectStore.js";
import { KnowledgePromotionGovernanceService } from "./knowledgePromotionGovernanceService.js";
import { WatcherStore } from "./watchers/watcherStore.js";

type TrainingQueueValidationServiceOptions = {
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "load">;
  promotionGovernanceService?: Pick<KnowledgePromotionGovernanceService, "loadTrainingQueue">;
  watcherStore?: Pick<WatcherStore, "load">;
  reportFile?: string;
  minSftReadyItems?: number;
};

type EvidenceContext = {
  object: KnowledgeObject | null;
  watcherCandidate: WatcherKnowledgeCandidate | null;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function check(
  checkId: string,
  passed: boolean,
  summary: string,
  blocking = true
): TrainingQueueValidationCheck {
  return {
    checkId,
    passed,
    blocking,
    summary
  };
}

function buildStats(decisions: TrainingQueueValidationDecision[], queueItemCount: number) {
  const byTarget: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const decision of decisions) {
    increment(byTarget, decision.target);
    increment(byDomain, decision.domain);
  }

  return {
    queueItemCount,
    decisionCount: decisions.length,
    readyForPackCount: decisions.filter((decision) => decision.validationStatus === "ready_for_pack").length,
    blockedCount: decisions.filter((decision) => decision.validationStatus === "blocked").length,
    rejectedCount: decisions.filter((decision) => decision.validationStatus === "rejected").length,
    sftCandidateCount: decisions.filter((decision) => decision.target === "student_sft").length,
    sftReadyForPackCount: decisions.filter(
      (decision) => decision.target === "student_sft" && decision.validationStatus === "ready_for_pack"
    ).length,
    retrievalReadyForPackCount: decisions.filter(
      (decision) => decision.target === "retrieval_knowledge" && decision.validationStatus === "ready_for_pack"
    ).length,
    runtimeMemoryReadyForPackCount: decisions.filter(
      (decision) => decision.target === "runtime_memory" && decision.validationStatus === "ready_for_pack"
    ).length,
    toolPolicyReadyForPackCount: decisions.filter(
      (decision) => decision.target === "tool_or_research_policy" && decision.validationStatus === "ready_for_pack"
    ).length,
    byTarget,
    byDomain
  };
}

function objectById(file: KnowledgeObjectFile | null) {
  return new Map((file?.objects ?? []).map((object) => [object.objectId, object]));
}

function watcherCandidateById(state: WatcherState | null) {
  return new Map((state?.candidates ?? []).map((candidate) => [candidate.candidateId, candidate]));
}

function sourceWatcherCandidateId(object: KnowledgeObject | null) {
  return object?.sources.find((source) => source.sourceType === "watcher")?.sourceId ?? null;
}

function evidenceScore(item: TrainingCandidateQueueItem, context: EvidenceContext) {
  const object = context.object;
  if (!object) {
    return 0;
  }

  const sourceScore =
    context.watcherCandidate && context.watcherCandidate.sources.length > 0
      ? clamp(context.watcherCandidate.corroborationCount / 3, 0, 1) * 30
      : 0;
  const objectEvidenceScore = clamp(object.evidenceCount / 4, 0, 1) * 35;
  const confidenceScore = object.confidence * 25;
  const queueScore = item.status === "ready" ? 10 : item.status === "queued" ? 5 : 0;

  return Number((sourceScore + objectEvidenceScore + confidenceScore + queueScore).toFixed(1));
}

function blockingFailures(checks: TrainingQueueValidationCheck[]) {
  return checks
    .filter((entry) => entry.blocking && !entry.passed)
    .map((entry) => entry.checkId);
}

export class TrainingQueueValidationService {
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "load">;
  private readonly promotionGovernanceService: Pick<
    KnowledgePromotionGovernanceService,
    "loadTrainingQueue"
  >;
  private readonly watcherStore: Pick<WatcherStore, "load">;
  private readonly reportFile: string;
  private readonly minSftReadyItems: number;

  constructor(options: TrainingQueueValidationServiceOptions = {}) {
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
    this.promotionGovernanceService =
      options.promotionGovernanceService ?? new KnowledgePromotionGovernanceService();
    this.watcherStore = options.watcherStore ?? new WatcherStore();
    this.reportFile = options.reportFile ?? env.TRAINING_QUEUE_VALIDATION_FILE;
    this.minSftReadyItems = options.minSftReadyItems ?? env.TRAINING_QUEUE_MIN_SFT_READY_ITEMS;
  }

  async validateAndPersist() {
    const [queue, knowledgeFile, watcherState] = await Promise.all([
      this.promotionGovernanceService.loadTrainingQueue(),
      this.knowledgeObjectStore.load(),
      this.watcherStore.load()
    ]);
    const report = this.buildReport({
      queue,
      knowledgeFile,
      watcherState
    });

    await mkdir(dirname(this.reportFile), { recursive: true });
    await writeFile(this.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  async loadReport() {
    try {
      const raw = await readFile(this.reportFile, "utf8");
      return trainingQueueValidationReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  buildReport(args: {
    queue: TrainingCandidateQueueFile | null;
    knowledgeFile: KnowledgeObjectFile | null;
    watcherState: WatcherState | null;
  }): TrainingQueueValidationReport {
    const items = args.queue?.items ?? [];
    const objects = objectById(args.knowledgeFile);
    const watchers = watcherCandidateById(args.watcherState);
    const decisions = items.map((item) => {
      const object = objects.get(item.sourceObjectId) ?? null;
      const watcherId = sourceWatcherCandidateId(object);
      return this.validateItem(item, {
        object,
        watcherCandidate: watcherId ? watchers.get(watcherId) ?? null : null
      });
    });
    const stats = buildStats(decisions, items.length);
    const trainingAuthorization = this.buildTrainingAuthorization(stats.sftReadyForPackCount);
    const gate = this.buildGate(decisions, trainingAuthorization);

    return trainingQueueValidationReportSchema.parse({
      version: "hydria-training-queue-validation-v1",
      generatedAt: new Date().toISOString(),
      sourceStats: stats,
      trainingAuthorization,
      gate,
      decisions
    });
  }

  private validateItem(
    item: TrainingCandidateQueueItem,
    context: EvidenceContext
  ): TrainingQueueValidationDecision {
    const targetChecks = this.targetChecks(item, context);
    const commonChecks = this.commonChecks(item, context);
    const checks = [...commonChecks, ...targetChecks];
    const blockers = [...new Set([...item.blockers, ...blockingFailures(checks)])].slice(0, 12);
    const score = evidenceScore(item, context);
    const validationStatus = this.statusFor(item, context, checks, score, blockers);
    const packEligible = validationStatus === "ready_for_pack";

    return trainingQueueValidationDecisionSchema.parse({
      queueId: item.queueId,
      sourceObjectId: item.sourceObjectId,
      sourceType: item.sourceType,
      target: item.target,
      originalStatus: item.status,
      validationStatus,
      priority: item.priority,
      domain: item.domain,
      category: item.category,
      evidenceScore: score,
      packEligible,
      checks,
      blockers,
      requiredNextSteps: this.nextStepsFor(item, context, validationStatus, blockers),
      reason: this.reasonFor(item, validationStatus, blockers)
    });
  }

  private commonChecks(item: TrainingCandidateQueueItem, context: EvidenceContext) {
    const object = context.object;
    return [
      check("source-object-present", Boolean(object), "Source Knowledge Object must exist."),
      check(
        "source-object-not-archived",
        object?.state !== "archived",
        "Archived knowledge cannot feed training or activation."
      ),
      check(
        "target-behavior-present",
        item.targetBehavior.trim().length >= 24,
        "Candidate must include a concrete target behavior."
      ),
      check(
        "queue-not-rejected-or-trained",
        item.status !== "rejected" && item.status !== "trained",
        "Rejected or already trained queue items are not eligible."
      )
    ];
  }

  private targetChecks(item: TrainingCandidateQueueItem, context: EvidenceContext) {
    switch (item.target) {
      case "student_sft":
        return this.studentSftChecks(item, context);
      case "retrieval_knowledge":
        return this.retrievalChecks(context);
      case "runtime_memory":
        return this.runtimeMemoryChecks(context);
      case "tool_or_research_policy":
        return this.toolPolicyChecks(context);
      default:
        return [
          check("known-target", false, "Unknown queue target.")
        ];
    }
  }

  private studentSftChecks(item: TrainingCandidateQueueItem, context: EvidenceContext) {
    const object = context.object;
    return [
      check(
        "sft-target-is-failure-or-guarded",
        object?.type === "failure_pattern" || object?.knowledgeClass === "guarded",
        "SFT candidates must come from failure patterns or guarded repair knowledge."
      ),
      check(
        "sft-has-repeated-evidence",
        (object?.evidenceCount ?? 0) >= 2,
        "SFT candidates require at least two evidence records."
      ),
      check(
        "sft-queue-ready-or-queued",
        item.status === "ready" || item.status === "queued",
        "SFT item must be queued or ready before pack validation."
      ),
      check(
        "sft-needs-post-train-gates",
        item.postTrainChecks.some((entry) => /benchmark|gate|compare/i.test(entry)),
        "SFT candidates must declare post-training benchmark and comparison gates."
      )
    ];
  }

  private retrievalChecks(context: EvidenceContext) {
    const object = context.object;
    const watcher = context.watcherCandidate;
    const corroboratedSources = watcher?.sources.filter((source) => source.retrievedAt !== null).length ?? 0;
    const watcherSource = object?.sources.some((source) => source.sourceType === "watcher") === true;

    return [
      check(
        "retrieval-has-source-evidence",
        watcherSource ? Boolean(watcher) : (object?.evidenceCount ?? 0) >= 2,
        "Retrieval knowledge needs source or object evidence."
      ),
      check(
        "retrieval-has-corroborated-sources",
        watcherSource ? corroboratedSources >= 2 : (object?.evidenceCount ?? 0) >= 2,
        "Watcher retrieval knowledge needs at least two corroborated source checks."
      ),
      check(
        "retrieval-not-high-risk",
        object?.riskLevel !== "high",
        "High-risk knowledge cannot enter retrieval without guarded review."
      )
    ];
  }

  private runtimeMemoryChecks(context: EvidenceContext) {
    const object = context.object;
    const dynamic = object?.knowledgeClass === "dynamic" || object?.decay.policy === "fast";
    return [
      check(
        "runtime-memory-validated",
        object?.state === "validated" || object?.state === "active",
        "Runtime memory requires a validated or already active Knowledge Object."
      ),
      check(
        "runtime-memory-confidence",
        (object?.confidence ?? 0) >= 0.7,
        "Runtime memory requires confidence >= 0.7."
      ),
      check(
        "runtime-memory-not-dynamic",
        !dynamic,
        "Dynamic watcher knowledge cannot become runtime memory without refresh policy."
      ),
      check(
        "runtime-memory-evidence",
        (object?.evidenceCount ?? 0) >= 2,
        "Runtime memory requires repeated evidence."
      )
    ];
  }

  private toolPolicyChecks(context: EvidenceContext) {
    const object = context.object;
    return [
      check(
        "tool-policy-source-type",
        object?.type === "tool_rule" || object?.type === "decision_rule",
        "Tool/research policy must come from tool or decision rule knowledge."
      ),
      check(
        "tool-policy-evidence",
        (object?.evidenceCount ?? 0) >= 2,
        "Tool/research policy needs repeated routing or benchmark evidence."
      ),
      check(
        "tool-policy-not-high-risk",
        object?.riskLevel !== "high",
        "High-risk tool or research policy needs manual review before packing."
      )
    ];
  }

  private statusFor(
    item: TrainingCandidateQueueItem,
    context: EvidenceContext,
    checks: TrainingQueueValidationCheck[],
    score: number,
    blockers: string[]
  ): TrainingQueueValidationDecision["validationStatus"] {
    if (item.status === "rejected" || item.status === "trained") {
      return "rejected";
    }
    if (context.object?.confidence !== undefined && context.object.confidence < 0.25) {
      return "rejected";
    }
    if (blockingFailures(checks).length > 0) {
      return "blocked";
    }
    if (blockers.length > 0) {
      return "blocked";
    }
    if (score >= 50) {
      return "ready_for_pack";
    }

    return "blocked";
  }

  private nextStepsFor(
    item: TrainingCandidateQueueItem,
    context: EvidenceContext,
    validationStatus: TrainingQueueValidationDecision["validationStatus"],
    blockers: string[]
  ) {
    if (validationStatus === "ready_for_pack") {
      return item.preTrainChecks.slice(0, 6);
    }

    const nextSteps = [
      ...blockers.map((blocker) => `Resolve blocker: ${blocker}.`),
      ...item.requiredValidation,
      ...item.preTrainChecks
    ];

    if (item.target === "retrieval_knowledge" && context.watcherCandidate) {
      nextSteps.unshift("Fetch and corroborate at least two watcher sources.");
    }
    if (item.target === "student_sft") {
      nextSteps.unshift("Collect teacher-validated repair examples for this failure pattern.");
    }

    return [...new Set(nextSteps.map((step) => compact(step, 200)))].slice(0, 12);
  }

  private reasonFor(
    item: TrainingCandidateQueueItem,
    status: TrainingQueueValidationDecision["validationStatus"],
    blockers: string[]
  ) {
    if (status === "ready_for_pack") {
      return compact(`${item.target} candidate has enough evidence for a validated pack entry.`);
    }
    if (status === "rejected") {
      return compact(`${item.target} candidate is rejected because it is no longer eligible.`);
    }

    return compact(
      blockers.length > 0
        ? `${item.target} candidate is blocked: ${blockers.join(", ")}.`
        : `${item.target} candidate needs more evidence before packing.`
    );
  }

  private buildTrainingAuthorization(readySftItems: number) {
    const studentSftAllowed = readySftItems >= this.minSftReadyItems;
    return {
      studentSftAllowed,
      minSftReadyItems: this.minSftReadyItems,
      readySftItems,
      reason: studentSftAllowed
        ? `SFT queue has ${readySftItems} ready items, meeting the threshold.`
        : `SFT queue has ${readySftItems} ready items; minimum is ${this.minSftReadyItems}. Do not train yet.`
    };
  }

  private buildGate(
    decisions: TrainingQueueValidationDecision[],
    trainingAuthorization: TrainingQueueValidationReport["trainingAuthorization"]
  ) {
    const ready = decisions.filter((decision) => decision.validationStatus === "ready_for_pack");
    const unsafeReady = ready.filter((decision) => decision.blockers.length > 0);
    const dynamicRetrievalReady = ready.filter(
      (decision) =>
        decision.target === "retrieval_knowledge" &&
        decision.checks.some(
          (entry) => entry.checkId === "retrieval-has-corroborated-sources" && entry.passed === false
        )
    );
    const readySft = ready.filter((decision) => decision.target === "student_sft");
    const checks = [
      check(
        "ready-items-have-no-blockers",
        unsafeReady.length === 0,
        "No ready_for_pack item may have unresolved blockers."
      ),
      check(
        "dynamic-retrieval-corroborated",
        dynamicRetrievalReady.length === 0,
        "External dynamic retrieval candidates must be source-corroborated."
      ),
      check(
        "student-sft-threshold",
        readySft.length === 0 || trainingAuthorization.studentSftAllowed,
        trainingAuthorization.reason
      ),
      check(
        "validation-does-not-train",
        true,
        "This gate validates queue entries only; it does not run SFT or change model weights."
      )
    ];

    return {
      passed: checks.every((entry) => !entry.blocking || entry.passed),
      checks
    };
  }
}

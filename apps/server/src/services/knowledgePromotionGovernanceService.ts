import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  KnowledgeObject,
  KnowledgeObjectFile,
  KnowledgeObjectState
} from "../types/knowledgeObjects.js";
import {
  knowledgePromotionReportSchema,
  trainingCandidateQueueFileSchema,
  type KnowledgePromotionDecision,
  type KnowledgePromotionMode,
  type KnowledgePromotionReport,
  type KnowledgePromotionValidationMode,
  type TrainingCandidateQueueFile,
  type TrainingCandidateQueueItem
} from "../types/knowledgePromotion.js";
import { env } from "../utils/env.js";
import { KnowledgeObjectStore } from "./knowledgeObjectStore.js";

type KnowledgePromotionGovernanceOptions = {
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "load" | "save">;
  reportFile?: string;
  trainingQueueFile?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function primarySourceType(object: KnowledgeObject) {
  return object.sources[0]?.sourceType ?? "unknown";
}

function isWatcherObject(object: KnowledgeObject) {
  return object.sources.some((source) => source.sourceType === "watcher");
}

function isExternalSourcePack(object: KnowledgeObject) {
  return isWatcherObject(object) && object.tags.includes("source-pack");
}

function isSourceAcquisitionObject(object: KnowledgeObject) {
  return object.sources.some((source) => source.sourceType === "source_acquisition");
}

function isDynamicOrLive(object: KnowledgeObject) {
  return (
    object.knowledgeClass === "dynamic" ||
    object.tags.includes("live") ||
    object.decay.policy === "fast"
  );
}

function isTrainingCandidate(object: KnowledgeObject) {
  if (object.type === "failure_pattern" || object.knowledgeClass === "guarded") {
    return true;
  }

  return isWatcherObject(object) && (object.state === "guarded" || object.riskLevel === "high");
}

function activeEligible(
  object: KnowledgeObject,
  validationMode: KnowledgePromotionValidationMode
) {
  return (
    validationMode === "passed" &&
    object.state === "validated" &&
    object.confidence >= 0.78 &&
    object.evidenceCount >= 3 &&
    object.riskLevel !== "high" &&
    !isDynamicOrLive(object)
  );
}

function validationFor(object: KnowledgeObject) {
  const checks = [
    "Run production smoke before activation.",
    "Run relevant domain benchmark before activation."
  ];

  if (isWatcherObject(object)) {
    checks.push("Corroborate watcher source evidence before activation.");
  }
  if (object.type === "failure_pattern" || object.knowledgeClass === "guarded") {
    checks.push("Confirm the failure pattern with teacher or benchmark evidence.");
  }
  if (isDynamicOrLive(object)) {
    checks.push("Refresh and corroborate dynamic source facts before any runtime use.");
  }

  return checks.slice(0, 12);
}

function targetForTraining(object: KnowledgeObject): TrainingCandidateQueueItem["target"] {
  if (isExternalSourcePack(object) || isSourceAcquisitionObject(object)) {
    return "retrieval_knowledge";
  }
  if (object.type === "tool_rule") {
    return "tool_or_research_policy";
  }
  if (object.type === "fact" && object.knowledgeClass === "dynamic") {
    return "retrieval_knowledge";
  }
  if (object.type === "failure_pattern" || object.knowledgeClass === "guarded") {
    return "student_sft";
  }
  return "runtime_memory";
}

function priorityFor(object: KnowledgeObject): TrainingCandidateQueueItem["priority"] {
  if (object.riskLevel === "high" || object.type === "failure_pattern") {
    return object.evidenceCount >= 3 ? "critical" : "high";
  }
  if (object.knowledgeClass === "dynamic") {
    return "medium";
  }
  return "low";
}

function queueStatusFor(object: KnowledgeObject, decision: KnowledgePromotionDecision) {
  if (decision.blockers.length > 0 && object.type !== "failure_pattern") {
    return "blocked" as const;
  }
  if (object.type === "failure_pattern" && object.evidenceCount >= 2) {
    return "ready" as const;
  }
  return "queued" as const;
}

function buildQueueStats(items: TrainingCandidateQueueItem[]) {
  const byTarget: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const item of items) {
    increment(byTarget, item.target);
    increment(byDomain, item.domain);
  }

  return {
    itemCount: items.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    queuedCount: items.filter((item) => item.status === "queued").length,
    blockedCount: items.filter((item) => item.status === "blocked").length,
    byTarget,
    byDomain
  };
}

function buildEmptyQueue(now: string): TrainingCandidateQueueFile {
  return trainingCandidateQueueFileSchema.parse({
    version: "hydria-training-candidate-queue-v1",
    generatedAt: now,
    sourceStats: {
      itemCount: 0,
      readyCount: 0,
      queuedCount: 0,
      blockedCount: 0,
      byTarget: {},
      byDomain: {}
    },
    items: []
  });
}

export class KnowledgePromotionGovernanceService {
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "load" | "save">;
  private readonly reportFile: string;
  private readonly trainingQueueFile: string;

  constructor(options: KnowledgePromotionGovernanceOptions = {}) {
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
    this.reportFile = options.reportFile ?? env.KNOWLEDGE_PROMOTION_FILE;
    this.trainingQueueFile = options.trainingQueueFile ?? env.TRAINING_CANDIDATE_QUEUE_FILE;
  }

  async evaluateAndPersist(args: {
    mode?: KnowledgePromotionMode;
    validationMode?: KnowledgePromotionValidationMode;
  } = {}) {
    const mode = args.mode ?? "dry_run";
    const validationMode = args.validationMode ?? "none";
    const knowledgeFile = await this.knowledgeObjectStore.load();
    const report = await this.buildReport({
      knowledgeFile,
      mode,
      validationMode
    });

    let appliedChangeCount = 0;
    if (mode === "apply" && report.gate.passed && knowledgeFile) {
      const applied = this.applyDecisions(knowledgeFile.objects, report.decisions);
      appliedChangeCount = applied.changedCount;
      if (applied.changedCount > 0) {
        await this.knowledgeObjectStore.save(applied.objects);
      }
    }

    const finalReport =
      appliedChangeCount === report.sourceStats.appliedChangeCount
        ? report
        : knowledgePromotionReportSchema.parse({
            ...report,
            sourceStats: {
              ...report.sourceStats,
              appliedChangeCount
            }
          });

    await this.persistReport(finalReport);
    await this.persistTrainingQueue(finalReport.trainingQueue);

    return finalReport;
  }

  async loadReport() {
    try {
      const raw = await readFile(this.reportFile, "utf8");
      return knowledgePromotionReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async loadTrainingQueue() {
    try {
      const raw = await readFile(this.trainingQueueFile, "utf8");
      return trainingCandidateQueueFileSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async buildReport(args: {
    knowledgeFile: KnowledgeObjectFile | null;
    mode: KnowledgePromotionMode;
    validationMode: KnowledgePromotionValidationMode;
  }): Promise<KnowledgePromotionReport> {
    const now = new Date().toISOString();
    const objects = args.knowledgeFile?.objects ?? [];
    const decisions = objects.map((object) =>
      this.evaluateObject(object, args.validationMode)
    );
    const trainingQueue = this.buildTrainingQueue(decisions, objects, now);
    const gate = this.buildGate(decisions, args.validationMode);

    return knowledgePromotionReportSchema.parse({
      version: "hydria-knowledge-promotion-v1",
      generatedAt: now,
      mode: args.mode,
      validationMode: args.validationMode,
      sourceStats: {
        objectCount: objects.length,
        decisionCount: decisions.length,
        blockedCount: decisions.filter((decision) => decision.action === "block").length,
        validatedPromotionCount: decisions.filter(
          (decision) => decision.action === "promote_to_validated"
        ).length,
        activePromotionCount: decisions.filter(
          (decision) => decision.action === "promote_to_active"
        ).length,
        trainingCandidateCount: decisions.filter((decision) => decision.trainingCandidate).length,
        appliedChangeCount: 0
      },
      gate,
      decisions,
      trainingQueue
    });
  }

  private evaluateObject(
    object: KnowledgeObject,
    validationMode: KnowledgePromotionValidationMode
  ): KnowledgePromotionDecision {
    const blockers = this.blockersFor(object);
    const requiredValidation = validationFor(object);
    let action: KnowledgePromotionDecision["action"] = "keep";
    let recommendedState: KnowledgeObjectState = object.state;
    let reason = "Knowledge object remains in its current lifecycle state.";

    if (object.state === "archived") {
      action = "archive";
      reason = "Archived knowledge stays out of runtime and training promotion.";
    } else if (blockers.length > 0 && object.state === "candidate") {
      action = "block";
      reason = `Candidate is blocked by governance: ${blockers.join(", ")}.`;
    } else if (
      (object.state === "candidate" || object.state === "guarded") &&
      object.confidence >= 0.58 &&
      object.evidenceCount >= 1 &&
      !isDynamicOrLive(object)
    ) {
      action = "promote_to_validated";
      recommendedState = "validated";
      reason = "Candidate has enough stable evidence for validation, but not runtime activation.";
    } else if (activeEligible(object, validationMode)) {
      action = "promote_to_active";
      recommendedState = "active";
      reason = "Validated object passed the explicit non-regression validation gate.";
    } else if (object.state === "validated" && validationMode !== "passed") {
      reason = "Validated object is waiting for an explicit passed non-regression gate before activation.";
    } else if (object.riskLevel === "high" && object.state !== "guarded") {
      action = "guard";
      recommendedState = "guarded";
      reason = "High-risk knowledge is moved to guarded until repeated evidence clears it.";
    }

    return {
      objectId: object.objectId,
      title: object.title,
      sourceType: primarySourceType(object),
      type: object.type,
      knowledgeClass: object.knowledgeClass,
      currentState: object.state,
      recommendedState,
      action,
      domain: object.domain,
      category: object.category,
      confidence: object.confidence,
      evidenceCount: object.evidenceCount,
      riskLevel: object.riskLevel,
      blockers,
      requiredValidation,
      trainingCandidate: isTrainingCandidate(object),
      reason: compact(reason)
    };
  }

  private blockersFor(object: KnowledgeObject) {
    const blockers: string[] = [];
    if (object.confidence < 0.55) {
      blockers.push("confidence_below_validation_threshold");
    }
    if (object.evidenceCount < 1) {
      blockers.push("missing_evidence");
    }
    if (isWatcherObject(object) && object.evidenceCount < 2) {
      blockers.push("watcher_candidate_needs_corroboration");
    }
    if (isDynamicOrLive(object)) {
      blockers.push("dynamic_knowledge_needs_refresh_before_activation");
    }
    if (object.riskLevel === "high") {
      blockers.push("high_risk_requires_teacher_or_benchmark_validation");
    }

    return blockers.slice(0, 12);
  }

  private buildTrainingQueue(
    decisions: KnowledgePromotionDecision[],
    objects: KnowledgeObject[],
    now: string
  ): TrainingCandidateQueueFile {
    const objectById = new Map(objects.map((object) => [object.objectId, object]));
    const maybeItems: Array<TrainingCandidateQueueItem | null> = decisions
      .filter((decision) => decision.trainingCandidate || decision.blockers.length > 0)
      .map((decision) => {
        const object = objectById.get(decision.objectId);
        if (!object) {
          return null;
        }

        const target = targetForTraining(object);
        const status = queueStatusFor(object, decision);
        const priority = priorityFor(object);
        return {
          queueId: `training-candidate::${stableShortHash(decision.objectId)}`,
          sourceObjectId: object.objectId,
          sourceType: primarySourceType(object),
          target,
          status,
          priority,
          domain: object.domain,
          category: object.category,
          objective: compact(
            target === "student_sft"
              ? `Prepare a supervised repair pack for ${object.domain}.`
              : target === "retrieval_knowledge"
                ? `Collect and validate retrieval knowledge for ${object.domain}.`
                : `Validate runtime memory for ${object.domain}.`,
            280
          ),
          targetBehavior: compact(object.content, 500),
          requiredValidation: decision.requiredValidation,
          preTrainChecks: [
            "Review source evidence and remove uncorroborated claims.",
            "Confirm the candidate does not encode private or unsafe data.",
            "Run the relevant benchmark slice before training or activation."
          ],
          postTrainChecks: [
            "Compare against the active baseline variant.",
            "Run benchmark 350 and tool/research gates before promotion.",
            "Keep broken, short, wrong-language, and toolRequiredButNotUsed regressions at zero."
          ],
          blockers: decision.blockers,
          createdAt: now,
          updatedAt: now
        } satisfies TrainingCandidateQueueItem;
      });
    const items = maybeItems
      .filter((item): item is TrainingCandidateQueueItem => item !== null)
      .sort(
        (left, right) =>
          Number(right.status === "ready") - Number(left.status === "ready") ||
          right.priority.localeCompare(left.priority) ||
          left.queueId.localeCompare(right.queueId)
      );

    if (items.length === 0) {
      return buildEmptyQueue(now);
    }

    return trainingCandidateQueueFileSchema.parse({
      version: "hydria-training-candidate-queue-v1",
      generatedAt: now,
      sourceStats: buildQueueStats(items),
      items
    });
  }

  private buildGate(
    decisions: KnowledgePromotionDecision[],
    validationMode: KnowledgePromotionValidationMode
  ) {
    const activePromotions = decisions.filter((decision) => decision.action === "promote_to_active");
    const checks = [
      {
        checkId: "explicit-non-regression-validation",
        passed: activePromotions.length === 0 || validationMode === "passed",
        blocking: true,
        summary:
          activePromotions.length === 0
            ? "No active promotion requested."
            : "Active promotion requires --validation=passed after benchmark gates."
      },
      {
        checkId: "no-dynamic-active-promotion",
        passed: activePromotions.every((decision) => decision.knowledgeClass !== "dynamic"),
        blocking: true,
        summary: "Dynamic watcher knowledge cannot become active without a refresh policy."
      },
      {
        checkId: "no-high-risk-active-promotion",
        passed: activePromotions.every((decision) => decision.riskLevel !== "high"),
        blocking: true,
        summary: "High-risk repair signals must queue for training or stay guarded."
      },
      {
        checkId: "training-is-queued-not-executed",
        passed: true,
        blocking: true,
        summary: "This governance layer builds training candidates but does not run SFT."
      }
    ];

    return {
      passed: checks.every((check) => !check.blocking || check.passed),
      checks
    };
  }

  private applyDecisions(objects: KnowledgeObject[], decisions: KnowledgePromotionDecision[]) {
    const decisionById = new Map(decisions.map((decision) => [decision.objectId, decision]));
    const now = new Date().toISOString();
    let changedCount = 0;
    const updated = objects.map((object) => {
      const decision = decisionById.get(object.objectId);
      if (!decision || decision.recommendedState === object.state) {
        return object;
      }

      changedCount += 1;
      return {
        ...object,
        state: decision.recommendedState,
        confidence: Number(
          clamp(
            decision.recommendedState === "active" ? object.confidence : object.confidence * 0.98,
            0,
            0.98
          ).toFixed(3)
        ),
        tags: [...new Set([...object.tags, "promotion-governed"])].slice(0, 16),
        updatedAt: now
      };
    });

    return {
      objects: updated,
      changedCount
    };
  }

  private async persistReport(report: KnowledgePromotionReport) {
    await mkdir(dirname(this.reportFile), { recursive: true });
    await writeFile(this.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  private async persistTrainingQueue(queue: TrainingCandidateQueueFile) {
    await mkdir(dirname(this.trainingQueueFile), { recursive: true });
    await writeFile(this.trainingQueueFile, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  }
}

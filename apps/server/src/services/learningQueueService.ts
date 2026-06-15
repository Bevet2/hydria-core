import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChatMessageResponse } from "../types/chat.js";
import type { HydriaInteractionRecord } from "../types/interactions.js";
import {
  learningQueueFileSchema,
  learningQueueGateDecisionSchema,
  learningQueueGateReportSchema,
  type LearningQueueCandidate,
  type LearningQueueCandidateKind,
  type LearningQueueFile,
  type LearningQueueGateCheck,
  type LearningQueueGateDecision,
  type LearningQueueGateReport,
  type LearningQueueRecommendedAction
} from "../types/learningQueue.js";
import type { TrainingCandidateQueueItem } from "../types/knowledgePromotion.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

type LearningQueueServiceOptions = {
  queueFile?: string;
  gateReportFile?: string;
  maxCandidates?: number;
};

type CandidateSeed = {
  kind: LearningQueueCandidateKind;
  signals: string[];
  recommendedAction: LearningQueueRecommendedAction;
  priority: LearningQueueCandidate["priority"];
  riskLevel: LearningQueueCandidate["riskLevel"];
  trainingTarget: LearningQueueCandidate["trainingTarget"];
  doNotTrainReason: string | null;
};

function compact(value: string, maxChars = 1200) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 3) {
    return normalized.slice(0, maxChars);
  }
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function nowIso() {
  return new Date().toISOString();
}

function emptyQueue(): LearningQueueFile {
  return learningQueueFileSchema.parse({
    version: "hydria-learning-queue-v1",
    updatedAt: nowIso(),
    sourceStats: buildQueueStats([]),
    candidates: []
  });
}

function buildQueueStats(candidates: LearningQueueCandidate[]) {
  const byKind: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  for (const candidate of candidates) {
    increment(byKind, candidate.kind);
    increment(byAction, candidate.recommendedAction);
    increment(byModel, candidate.model ?? "none");
  }

  return {
    candidateCount: candidates.length,
    readyCount: candidates.filter((candidate) => candidate.status === "ready").length,
    guardedCount: candidates.filter((candidate) => candidate.status === "guarded").length,
    rawCount: candidates.filter((candidate) => candidate.status === "raw").length,
    rejectedCount: candidates.filter((candidate) => candidate.status === "rejected").length,
    byKind,
    byAction,
    byModel
  };
}

function buildFile(candidates: LearningQueueCandidate[]) {
  return learningQueueFileSchema.parse({
    version: "hydria-learning-queue-v1",
    updatedAt: nowIso(),
    sourceStats: buildQueueStats(candidates),
    candidates
  });
}

function normalizedStatus(candidate: LearningQueueCandidate): LearningQueueCandidate["status"] {
  if (candidate.status === "rejected") {
    return "rejected";
  }
  if (candidate.doNotTrainReason || candidate.riskLevel !== "low" || candidate.trainingTarget === "student_sft") {
    return "guarded";
  }
  return candidate.status;
}

function includesAny(values: string[], patterns: RegExp[]) {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function candidateStatus(seed: CandidateSeed): LearningQueueCandidate["status"] {
  if (seed.recommendedAction === "ignore") {
    return "rejected";
  }
  if (seed.doNotTrainReason || seed.riskLevel !== "low" || seed.trainingTarget === "student_sft") {
    return "guarded";
  }
  return "raw";
}

function check(
  checkId: string,
  passed: boolean,
  summary: string,
  blocking = true
): LearningQueueGateCheck {
  return {
    checkId,
    passed,
    blocking,
    summary
  };
}

function blockingFailures(checks: LearningQueueGateCheck[]) {
  return checks
    .filter((entry) => entry.blocking && !entry.passed)
    .map((entry) => entry.checkId);
}

function hasQuestionAndAnswer(candidate: LearningQueueCandidate) {
  return candidate.question.trim().length >= 8 && candidate.answerPreview.trim().length >= 2;
}

function buildTrainingAuthorization(decisions: LearningQueueGateDecision[]) {
  const readyStudentSftItems = decisions.filter(
    (decision) => decision.trainingTarget === "student_sft" && decision.packEligible
  ).length;
  return {
    studentSftAllowed: false,
    readyStudentSftItems,
    reason:
      readyStudentSftItems > 0
        ? `${readyStudentSftItems} student SFT candidate(s) are pack-eligible, but Learning Queue v1 never starts training automatically.`
        : "No student SFT candidate is pack-eligible yet. Learning Queue v1 only validates candidates."
  };
}

function buildReportStats(decisions: LearningQueueGateDecision[], candidates: LearningQueueCandidate[]) {
  const byKind: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  for (const candidate of candidates) {
    increment(byKind, candidate.kind);
    increment(byAction, candidate.recommendedAction);
  }

  return {
    candidateCount: candidates.length,
    decisionCount: decisions.length,
    readyCount: candidates.filter((candidate) => candidate.status === "ready").length,
    guardedCount: candidates.filter((candidate) => candidate.status === "guarded").length,
    rejectedCount: candidates.filter((candidate) => candidate.status === "rejected").length,
    packEligibleCount: decisions.filter((decision) => decision.packEligible).length,
    studentSftCandidateCount: candidates.filter((candidate) => candidate.trainingTarget === "student_sft").length,
    byKind,
    byAction
  };
}

export class LearningQueueService {
  private readonly queueFile: string;
  private readonly gateReportFile: string;
  private readonly maxCandidates: number;
  private writeQueue = Promise.resolve();

  constructor(options: LearningQueueServiceOptions = {}) {
    this.queueFile = options.queueFile ?? env.LEARNING_QUEUE_FILE;
    this.gateReportFile = options.gateReportFile ?? env.LEARNING_QUEUE_GATE_FILE;
    this.maxCandidates = options.maxCandidates ?? 1000;
  }

  async safeCaptureChatResponse(args: {
    response: ChatMessageResponse;
    interactionRecord?: HydriaInteractionRecord | null;
  }) {
    try {
      return await this.captureChatResponse(args);
    } catch (error) {
      logger.warn("Learning queue capture failed", {
        sessionId: args.response.sessionId,
        error: String(error)
      });
      return [];
    }
  }

  async captureChatResponse(args: {
    response: ChatMessageResponse;
    interactionRecord?: HydriaInteractionRecord | null;
  }) {
    const candidates = this.buildChatCandidates(args.response, args.interactionRecord ?? null);
    if (candidates.length === 0) {
      return [];
    }

    await this.runExclusive(async () => {
      const current = await this.loadQueue();
      const merged = new Map(current.candidates.map((candidate) => [candidate.candidateId, candidate]));
      for (const candidate of candidates) {
        const existing = merged.get(candidate.candidateId);
        merged.set(candidate.candidateId, existing ? { ...existing, ...candidate, createdAt: existing.createdAt } : candidate);
      }
      const sorted = [...merged.values()]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, this.maxCandidates);
      await this.writeQueueFile(buildFile(sorted));
    });

    return candidates;
  }

  async loadQueue() {
    try {
      const raw = await readFile(this.queueFile, "utf8");
      const parsed = learningQueueFileSchema.parse(JSON.parse(raw));
      return buildFile(
        parsed.candidates.map((candidate) => ({
          ...candidate,
          status: normalizedStatus(candidate)
        }))
      );
    } catch {
      return emptyQueue();
    }
  }

  async loadGateReport() {
    try {
      const raw = await readFile(this.gateReportFile, "utf8");
      return learningQueueGateReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async validateAndPersist() {
    const queue = await this.loadQueue();
    await this.writeQueueFile(queue);
    const report = this.buildGateReport(queue);
    await mkdir(dirname(this.gateReportFile), { recursive: true });
    await writeFile(this.gateReportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  buildGateReport(queue: LearningQueueFile): LearningQueueGateReport {
    const decisions = queue.candidates.map((candidate) => this.validateCandidate(candidate));
    const trainingAuthorization = buildTrainingAuthorization(decisions);
    const gateChecks = [
      check(
        "gate-does-not-train",
        true,
        "Learning Queue v1 captures and validates candidates only; it never starts SFT or changes model weights."
      ),
      check(
        "ready-items-have-no-blockers",
        decisions.every((decision) => !decision.packEligible || decision.blockers.length === 0),
        "Pack-eligible candidates must have no unresolved blockers."
      ),
      check(
        "source-backed-before-training",
        decisions.every(
          (decision) =>
            decision.trainingTarget !== "student_sft" ||
            !decision.packEligible ||
            decision.checks.some((entry) => entry.checkId === "human-review-required" && entry.passed)
        ),
        "Student SFT candidates require review evidence before training pack usage."
      ),
      check(
        "unsafe-candidates-guarded",
        queue.candidates.every((candidate) => candidate.riskLevel !== "high" || candidate.status === "guarded"),
        "High-risk candidates must remain guarded."
      )
    ];

    return learningQueueGateReportSchema.parse({
      version: "hydria-learning-queue-gate-v1",
      generatedAt: nowIso(),
      sourceStats: buildReportStats(decisions, queue.candidates),
      trainingAuthorization,
      gate: {
        passed: gateChecks.every((entry) => !entry.blocking || entry.passed),
        checks: gateChecks
      },
      decisions
    });
  }

  private buildChatCandidates(
    response: ChatMessageResponse,
    interactionRecord: HydriaInteractionRecord | null
  ): LearningQueueCandidate[] {
    const qualityIssues = response.conversationQuality.issues;
    const validationIssues = response.generation.validationIssues;
    const seeds: CandidateSeed[] = [];

    if (response.generation.provider === "fallback" || response.generation.usedStaticFallback) {
      seeds.push({
        kind: "model_fallback",
        signals: ["model_static_fallback", ...validationIssues],
        recommendedAction: "model_ops_review",
        priority: "high",
        riskLevel: "medium",
        trainingTarget: null,
        doNotTrainReason: "A model fallback is an ops/routing signal first; do not train from it without a teacher-approved answer."
      });
    }

    if (
      response.generation.provider === "tool" &&
      response.generation.model === "knowledge_retrieval" &&
      response.usedRetry
    ) {
      seeds.push({
        kind: "model_fallback",
        signals: ["deterministic_knowledge_fallback", "local_generation_unreliable"],
        recommendedAction: "model_ops_review",
        priority: "medium",
        riskLevel: "medium",
        trainingTarget: null,
        doNotTrainReason: "Source-backed deterministic fallback should be reviewed before becoming a supervised example."
      });
    }

    if (!response.conversationQuality.passed || qualityIssues.length > 0) {
      const isLanguage = includesAny(qualityIssues, [/wrong_language/i, /language/i, /langue/i]);
      seeds.push({
        kind: isLanguage ? "language_mismatch" : "quality_repair",
        signals: qualityIssues.length > 0 ? qualityIssues : ["quality_gate_warning"],
        recommendedAction: isLanguage ? "dataset_candidate" : "prompt_patch",
        priority: isLanguage ? "high" : "medium",
        riskLevel: includesAny(qualityIssues, [/prompt|policy|system|injection/i]) ? "high" : "medium",
        trainingTarget: isLanguage ? "student_sft" : null,
        doNotTrainReason: isLanguage
          ? null
          : "Quality repair signals need repeated evidence or teacher correction before becoming training data."
      });
    }

    if (response.tooling.routing.toolRequired && !response.tooling.used) {
      seeds.push({
        kind: "tool_routing_gap",
        signals: [
          "tool_required_not_used",
          response.tooling.routing.toolType,
          response.tooling.routing.intent,
          response.tooling.failureReason ?? "no_tool_result"
        ],
        recommendedAction: "tool_gap",
        priority: "critical",
        riskLevel: "high",
        trainingTarget: "tool_or_research_policy",
        doNotTrainReason: "Required-tool failures must be fixed in routing/tool execution before model SFT."
      });
    } else if (response.tooling.route === "recommended_not_executed") {
      seeds.push({
        kind: "tool_routing_gap",
        signals: [
          "tool_recommended_not_executed",
          response.tooling.routing.toolType,
          response.tooling.routing.intent
        ],
        recommendedAction: "routing_patch",
        priority: "low",
        riskLevel: "low",
        trainingTarget: "tool_or_research_policy",
        doNotTrainReason: null
      });
    }

    if (
      response.knowledgeRetrieval.route === "no_match" &&
      (response.tooling.routing.toolRecommended || response.generation.provider === "fallback")
    ) {
      seeds.push({
        kind: "retrieval_gap",
        signals: ["knowledge_no_match", response.tooling.routing.intent],
        recommendedAction: "retrieval_patch",
        priority: "medium",
        riskLevel: "medium",
        trainingTarget: "retrieval_knowledge",
        doNotTrainReason: "Missing retrieval coverage needs source acquisition or knowledge validation, not direct SFT."
      });
    }

    if (
      response.tooling.routing.toolRequired &&
      !response.tooling.used &&
      response.knowledgeRetrieval.route !== "used"
    ) {
      seeds.push({
        kind: "source_grounding_gap",
        signals: ["external_grounding_required_without_verified_source"],
        recommendedAction: "routing_patch",
        priority: "critical",
        riskLevel: "high",
        trainingTarget: null,
        doNotTrainReason: "Live or external-data gaps must be grounded by tools or sources before any training use."
      });
    }

    const unique = new Map<string, CandidateSeed>();
    for (const seed of seeds) {
      unique.set(`${seed.kind}:${seed.recommendedAction}:${seed.signals[0]}`, seed);
    }

    const createdAt = nowIso();
    return [...unique.values()].map((seed) => {
      const baseId = [
        interactionRecord?.id ?? response.assistantMessage.id,
        seed.kind,
        seed.recommendedAction,
        response.category
      ].join("::");
      const status = candidateStatus(seed);
      return {
        candidateId: `learning::${stableShortHash(baseId)}`,
        kind: seed.kind,
        status,
        priority: seed.priority,
        source: "chat",
        scope: "chat_turn",
        sourceRecordId: interactionRecord?.id ?? null,
        sessionId: response.sessionId,
        artifactId: response.assistantMessage.id,
        category: response.category,
        provider: response.generation.provider,
        model: response.generation.model,
        specialistRole: response.generation.specialist?.role ?? null,
        question: compact(response.userMessage.content),
        answerPreview: compact(response.assistantMessage.content),
        signals: [...new Set(seed.signals.filter(Boolean).map((signal) => compact(signal, 160)))].slice(0, 16),
        qualityIssues: qualityIssues.slice(0, 16),
        validationIssues: validationIssues.slice(0, 16),
        tool: {
          required: response.tooling.routing.toolRequired,
          recommended: response.tooling.routing.toolRecommended,
          used: response.tooling.used,
          route: response.tooling.route,
          type: response.tooling.routing.toolType,
          intent: response.tooling.routing.intent
        },
        knowledge: {
          route: response.knowledgeRetrieval.route,
          used: response.knowledgeRetrieval.used,
          hitCount: response.knowledgeRetrieval.hitCount
        },
        retryUsed: response.usedRetry,
        recommendedAction: seed.recommendedAction,
        trainingTarget: seed.trainingTarget,
        riskLevel: seed.riskLevel,
        requiresHumanReview: seed.riskLevel !== "low" || seed.trainingTarget === "student_sft",
        doNotTrainReason: seed.doNotTrainReason,
        createdAt,
        updatedAt: createdAt
      } satisfies LearningQueueCandidate;
    });
  }

  private validateCandidate(candidate: LearningQueueCandidate): LearningQueueGateDecision {
    const checks = [
      check("question-and-answer-present", hasQuestionAndAnswer(candidate), "Candidate must preserve question and answer preview."),
      check("signals-present", candidate.signals.length > 0, "Candidate must include concrete failure or learning signals."),
      check(
        "dangerous-data-not-ready",
        !(candidate.riskLevel === "high" && candidate.status === "ready"),
        "High-risk candidates cannot be marked ready."
      ),
      check(
        "training-has-target",
        candidate.recommendedAction !== "dataset_candidate" || candidate.trainingTarget !== null,
        "Dataset candidates must declare a training target."
      ),
      check(
        "tool-gaps-not-student-sft",
        candidate.kind !== "tool_routing_gap" || candidate.trainingTarget !== "student_sft",
        "Tool routing gaps must be routed to tool/research policy, not student SFT."
      ),
      check(
        "human-review-required",
        !candidate.requiresHumanReview,
        "Medium/high risk candidates require human or teacher review before training use.",
        candidate.trainingTarget === "student_sft"
      ),
      check(
        "do-not-train-respected",
        candidate.doNotTrainReason === null || candidate.trainingTarget !== "student_sft",
        "Candidates carrying a do-not-train reason cannot enter student SFT."
      )
    ];
    const blockers = blockingFailures(checks);
    const packEligible =
      candidate.status === "ready" &&
      candidate.trainingTarget !== null &&
      candidate.doNotTrainReason === null &&
      blockers.length === 0;

    return learningQueueGateDecisionSchema.parse({
      candidateId: candidate.candidateId,
      kind: candidate.kind,
      status: candidate.status,
      recommendedAction: candidate.recommendedAction,
      trainingTarget: candidate.trainingTarget,
      priority: candidate.priority,
      packEligible,
      checks,
      blockers,
      requiredNextSteps: this.nextStepsFor(candidate, blockers, packEligible),
      reason: this.reasonFor(candidate, blockers, packEligible)
    });
  }

  private nextStepsFor(candidate: LearningQueueCandidate, blockers: string[], packEligible: boolean) {
    if (packEligible) {
      return [
        "Review candidate manually before training pack inclusion.",
        "Compare against hidden gate cases before any model promotion.",
        "Keep v9/v10 baseline available for rollback."
      ];
    }

    const steps = blockers.map((blocker) => `Resolve blocker: ${blocker}.`);
    if (candidate.kind === "model_fallback") {
      steps.push("Inspect model ops telemetry and timeout path for this model.");
    }
    if (candidate.kind === "language_mismatch") {
      steps.push("Collect corrected same-language answer before adding to a student dataset.");
    }
    if (candidate.kind === "tool_routing_gap") {
      steps.push("Patch routing or tool execution; do not solve this through SFT first.");
    }
    if (candidate.kind === "retrieval_gap" || candidate.kind === "source_grounding_gap") {
      steps.push("Acquire or validate sources before creating retrieval/runtime memory.");
    }
    if (candidate.doNotTrainReason) {
      steps.push(candidate.doNotTrainReason);
    }

    return [...new Set(steps)].slice(0, 12);
  }

  private reasonFor(candidate: LearningQueueCandidate, blockers: string[], packEligible: boolean) {
    if (packEligible) {
      return `${candidate.kind} is ready for a reviewed learning pack entry, but training remains manual.`;
    }
    if (candidate.status === "rejected") {
      return `${candidate.kind} was rejected by the queue policy.`;
    }
    if (blockers.length > 0) {
      return `${candidate.kind} is blocked by ${blockers.join(", ")}.`;
    }
    return `${candidate.kind} is captured for observation and needs more evidence or review.`;
  }

  private async writeQueueFile(queue: LearningQueueFile) {
    await mkdir(dirname(this.queueFile), { recursive: true });
    await writeFile(this.queueFile, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  }

  private async runExclusive<T>(task: () => Promise<T>) {
    const pending = this.writeQueue.then(task, task);
    this.writeQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }
}

export function learningQueueItemFromCandidate(candidate: LearningQueueCandidate): TrainingCandidateQueueItem | null {
  if (!candidate.trainingTarget) {
    return null;
  }
  const timestamp = candidate.updatedAt;
  return {
    queueId: candidate.candidateId,
    sourceObjectId: candidate.sourceRecordId ?? candidate.artifactId ?? candidate.candidateId,
    sourceType: `learning_queue:${candidate.kind}`,
    target: candidate.trainingTarget,
    status: candidate.status === "ready" ? "queued" : candidate.status === "rejected" ? "rejected" : "blocked",
    priority: candidate.priority,
    domain: candidate.category ?? "general",
    category: candidate.category,
    objective: compact(candidate.recommendedAction.replaceAll("_", " "), 280),
    targetBehavior: compact(candidate.signals.join("; "), 500),
    requiredValidation: candidate.requiresHumanReview ? ["Manual review required."] : [],
    preTrainChecks: ["Run learning:queue-gate.", "Run hidden quality gate before training."],
    postTrainChecks: ["Run A/B comparison against active baseline.", "Run production smoke and routing gates."],
    blockers: candidate.doNotTrainReason ? [candidate.doNotTrainReason] : [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}
